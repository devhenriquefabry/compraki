import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';

import {
  type AuthenticatedRequest, type HttpResponse, defaultRuntime, handleCors, methodNotAllowed,
  requireAdmin, requireAuthenticated,
} from './shared/http';
import { appUrl, escapeHtml, isEmulator, mailParagraph, mailShell, sendMail } from './shared/mail';

/**
 * Verificação em duas etapas por e-mail (opcional). Desenho em
 * docs/superpowers/specs/2026-11-04-verificacao-duas-etapas.md.
 *
 * Custom claims `tfa` e `tfaSessions` marcam quais sessões (`auth_time`) já
 * confirmaram o código. `isSignedIn()` nas regras e `requireAuthenticated` nas
 * functions recusam as demais: quem só tem a senha recebe um token que não abre
 * nada. O documento `twoFactor/{uid}` não tem regra: só o Admin SDK lê.
 *
 * Uma function só, com `action`, porque cada function é um serviço no Cloud Run
 * e disputa a cota de CPU da região.
 */

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60 * 1000;
/** Aparelhos que continuam confirmados ao mesmo tempo. O teto do claim é 1000 bytes. */
const SESSIONS_KEPT = 10;

type Purpose = 'login' | 'enable' | 'disable';

interface StoredCode {
  hash: string;
  purpose: Purpose;
  /** Sessão que pediu: o código só vale nela. */
  authTime: number;
  expiresAt: number;
  attempts: number;
}

interface TwoFactorDoc {
  enabled?: boolean;
  /** Para onde vão os códigos. Fixado na ativação, não segue o e-mail do Auth. */
  email?: string;
  code?: StoredCode | null;
  sendCount?: number;
  windowStartedAt?: number;
  lastSentAt?: number;
}

const docRef = (uid: string) => getFirestore().doc(`twoFactor/${uid}`);

function fail(res: HttpResponse, status: number, code: string, error: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ error, code, ...extra });
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function hashCode(uid: string, purpose: Purpose, code: string): string {
  return sha256(`${uid}:${purpose}:${code}`);
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function generateCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => randomInt(10)).join('');
}

async function setClaims(uid: string, change: { tfa: true; tfaSessions: number[] } | null): Promise<void> {
  const record = await getAuth().getUser(uid);
  const { tfa: _tfa, tfaSessions: _sessions, ...others } = record.customClaims ?? {};
  await getAuth().setCustomUserClaims(uid, change ? { ...others, ...change } : others);
}

/** Confirma a sessão, mantendo as mais recentes dos outros aparelhos. */
async function addSession(uid: string, authTime: number): Promise<void> {
  const record = await getAuth().getUser(uid);
  const claims = record.customClaims ?? {};
  const current = Array.isArray(claims['tfaSessions']) ? (claims['tfaSessions'] as number[]) : [];
  const sessions = [...current.filter(value => value !== authTime), authTime].slice(-SESSIONS_KEPT);
  await setClaims(uid, { tfa: true, tfaSessions: sessions });
}

function logEvent(uid: string, type: string, details: Record<string, unknown> = {}): Promise<unknown> {
  return getFirestore().collection('twoFactorEvents').add({ uid, type, at: FieldValue.serverTimestamp(), ...details })
    .catch(error => logger.error('Falha ao registrar evento de 2FA', { uid, type, error }));
}

function codeMail(code: string, purpose: Purpose): { subject: string; text: string; html: string } {
  const action: Record<Purpose, string> = {
    login: 'entrar na sua conta',
    enable: 'ativar a verificação em duas etapas',
    disable: 'desativar a verificação em duas etapas',
  };
  const warning = purpose === 'login'
    ? 'Se não foi você, alguém sabe a sua senha: troque-a agora. Sem este código, essa pessoa não entra.'
    : 'Se não foi você, troque sua senha agora e não compartilhe este código.';
  const body = [
    mailParagraph(`Use este código para ${escapeHtml(action[purpose])}. Ele vale por 10 minutos.`),
    `<div style="margin:6px 0 16px;padding:14px 18px;background:#0B1623;border-radius:12px;color:#D8F51F;font-size:30px;font-weight:800;letter-spacing:8px;text-align:center;">${code}</div>`,
    mailParagraph('A Vineon nunca pede este código por telefone, WhatsApp ou chat.'),
    mailParagraph(escapeHtml(warning)),
  ].join('');
  return {
    subject: 'Seu código de verificação da Vineon',
    text: `Código para ${action[purpose]}: ${code}\nVale por 10 minutos.\nA Vineon nunca pede este código por telefone, WhatsApp ou chat.\n${warning}`,
    html: mailShell({ eyebrow: 'Verificação em duas etapas', body }),
  };
}

/** Aviso de mudança na segurança da conta. Falha aqui não desfaz a operação. */
async function notify(email: string | undefined, title: string, message: string): Promise<void> {
  if (!email) return;
  const warning = 'Se não foi você, troque sua senha e fale com o atendimento da Vineon.';
  try {
    await sendMail({
      to: email,
      subject: `Vineon: ${title.toLowerCase()}`,
      text: `${title}\n${message}\n${warning}`,
      html: mailShell({
        eyebrow: 'Segurança da conta',
        body: mailParagraph(`<strong>${escapeHtml(title)}</strong>`) + mailParagraph(escapeHtml(message)) + mailParagraph(escapeHtml(warning)),
        cta: { label: 'Abrir minha conta', url: `${appUrl()}/tabs/my-account` },
      }),
    });
  } catch (error) {
    logger.error('Falha ao enviar aviso de 2FA', { title, error });
  }
}

async function accountEmail(uid: string): Promise<string | undefined> {
  return (await getAuth().getUser(uid)).email;
}

async function requestCode(user: AuthenticatedRequest, purpose: Purpose, res: HttpResponse): Promise<void> {
  const ref = docRef(user.uid);
  const snap = await ref.get();
  const data = (snap.data() ?? {}) as TwoFactorDoc;

  if (purpose === 'enable' ? data.enabled === true : data.enabled !== true) {
    return fail(res, 409, 'wrong-state', data.enabled ? 'A verificação em duas etapas já está ativa.' : 'A verificação em duas etapas não está ativa.');
  }
  const to = purpose === 'enable' ? await accountEmail(user.uid) : data.email;
  if (!to) return fail(res, 409, 'no-email', 'Esta conta não tem e-mail para receber o código.');

  const now = Date.now();
  const waitMs = (data.lastSentAt ?? 0) + RESEND_COOLDOWN_MS - now;
  if (waitMs > 0) {
    return fail(res, 429, 'cooldown', 'Espere um pouco para pedir outro código.', { retryAfter: Math.ceil(waitMs / 1000) });
  }
  const windowOpen = now - (data.windowStartedAt ?? 0) < SEND_WINDOW_MS;
  const sendCount = windowOpen ? data.sendCount ?? 0 : 0;
  if (sendCount >= MAX_SENDS_PER_WINDOW) {
    return fail(res, 429, 'too-many', 'Muitos códigos pedidos. Tente de novo em uma hora.');
  }

  const code = generateCode();
  const stored: StoredCode = {
    hash: hashCode(user.uid, purpose, code),
    purpose,
    authTime: user.authTime ?? 0,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
  };
  await ref.set({
    code: stored,
    sendCount: sendCount + 1,
    windowStartedAt: windowOpen ? data.windowStartedAt : now,
    lastSentAt: now,
    // Só no emulador: é por aqui que os testes leem o código.
    ...(isEmulator() ? { debugCode: code } : {}),
  }, { merge: true });

  try {
    await sendMail({ to, ...codeMail(code, purpose) });
  } catch (error) {
    logger.error('Falha ao enviar código de 2FA', { uid: user.uid, error });
    await ref.set({ code: null, lastSentAt: 0, sendCount }, { merge: true });
    return fail(res, 502, 'mail-failed', 'Não conseguimos enviar o e-mail agora. Tente de novo em instantes.');
  }

  res.status(200).json({ sent: true, email: maskEmail(to), retryAfter: RESEND_COOLDOWN_MS / 1000 });
}

/** `f***@gmail.com`: mostra para onde foi sem expor o endereço a quem só tem a senha. */
function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

/**
 * Confere e consome o código. Numa transação: duas tentativas ao mesmo tempo
 * não podem contar como uma só, e o código certo só vale uma vez.
 */
async function consumeCode(user: AuthenticatedRequest, purpose: Purpose, code: unknown): Promise<string | null> {
  const ref = docRef(user.uid);
  const provided = String(code ?? '').trim();
  return getFirestore().runTransaction(async transaction => {
    const stored = ((await transaction.get(ref)).data() as TwoFactorDoc | undefined)?.code;
    if (!stored || stored.purpose !== purpose || stored.authTime !== user.authTime) return 'Peça um código novo.';
    if (stored.expiresAt < Date.now()) {
      transaction.set(ref, { code: null }, { merge: true });
      return 'Este código expirou. Peça um novo.';
    }
    if (!sameHash(stored.hash, hashCode(user.uid, purpose, provided))) {
      const attempts = stored.attempts + 1;
      if (attempts >= CODE_MAX_ATTEMPTS) {
        transaction.set(ref, { code: null }, { merge: true });
        return 'Muitas tentativas. Peça um código novo.';
      }
      transaction.set(ref, { code: { ...stored, attempts } }, { merge: true });
      return 'Código incorreto.';
    }
    transaction.set(ref, { code: null, lastSentAt: 0, debugCode: FieldValue.delete() }, { merge: true });
    return null;
  });
}

async function enable(user: AuthenticatedRequest, code: unknown, res: HttpResponse): Promise<void> {
  const problem = await consumeCode(user, 'enable', code);
  if (problem) return fail(res, 400, 'invalid-code', problem);

  const email = await accountEmail(user.uid);
  await docRef(user.uid).set({
    enabled: true,
    email,
    enabledAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await setClaims(user.uid, { tfa: true, tfaSessions: [user.authTime ?? 0] });
  await logEvent(user.uid, 'enabled');
  await notify(email, 'Verificação em duas etapas ativada', 'A partir de agora, enviaremos um código para este e-mail a cada novo login.');
  res.status(200).json({ enabled: true });
}

/** Desliga de vez. Quem chama já confirmou que a pessoa pode fazer isso. */
async function turnOff(uid: string): Promise<string | undefined> {
  const ref = docRef(uid);
  const email = ((await ref.get()).data() as TwoFactorDoc | undefined)?.email;
  await setClaims(uid, null);
  await ref.delete();
  return email;
}

async function disable(user: AuthenticatedRequest, code: unknown, res: HttpResponse): Promise<void> {
  const problem = await consumeCode(user, 'disable', code);
  if (problem) return fail(res, 400, 'invalid-code', problem);

  const email = await turnOff(user.uid);
  await logEvent(user.uid, 'disabled');
  await notify(email, 'Verificação em duas etapas desativada', 'Sua conta volta a pedir só a senha ou o Google para entrar.');
  res.status(200).json({ enabled: false });
}

async function verifyLogin(user: AuthenticatedRequest, code: unknown, res: HttpResponse): Promise<void> {
  const problem = await consumeCode(user, 'login', code);
  if (problem) return fail(res, 400, 'invalid-code', problem);

  await addSession(user.uid, user.authTime ?? 0);
  res.status(200).json({ verified: true });
}

/**
 * Reautenticar (trocar senha, excluir conta) muda o `auth_time`. Quem apresenta
 * um token anterior da mesma conta, de sessão já confirmada, leva a confirmação
 * para a sessão nova sem pedir outro código.
 */
async function rebindSession(user: AuthenticatedRequest, previousToken: unknown, res: HttpResponse): Promise<void> {
  if (!user.twoFactorPending) {
    res.status(200).json({ verified: true });
    return;
  }
  let previousAuthTime: number;
  try {
    const decoded = await getAuth().verifyIdToken(String(previousToken ?? ''));
    if (decoded.uid !== user.uid) throw new Error('Outra conta');
    previousAuthTime = decoded.auth_time;
  } catch {
    return fail(res, 403, 'two-factor-required', 'Confirme o código de verificação para continuar.');
  }
  const sessions = (await getAuth().getUser(user.uid)).customClaims?.['tfaSessions'];
  if (!Array.isArray(sessions) || !sessions.includes(previousAuthTime)) {
    return fail(res, 403, 'two-factor-required', 'Confirme o código de verificação para continuar.');
  }
  await addSession(user.uid, user.authTime ?? 0);
  res.status(200).json({ verified: true });
}

/** Único caminho para quem perdeu o e-mail: o atendimento confirma quem é e desliga. */
async function adminReset(req: Parameters<typeof requireAdmin>[0], res: HttpResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { uid, reason } = (req.body ?? {}) as { uid?: unknown; reason?: unknown };
  const target = typeof uid === 'string' ? uid.trim() : '';
  const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  if (!target) return fail(res, 400, 'invalid', 'Informe a conta.');
  if (!why) return fail(res, 400, 'invalid', 'Informe o motivo.');

  const snap = await docRef(target).get();
  if ((snap.data() as TwoFactorDoc | undefined)?.enabled !== true) {
    return fail(res, 409, 'wrong-state', 'Esta conta não tem a verificação em duas etapas ativa.');
  }
  const email = await turnOff(target);
  await logEvent(target, 'admin_reset', { by: admin.uid, reason: why });
  await notify(email, 'Verificação em duas etapas desativada pelo atendimento', 'O atendimento da Vineon desativou a verificação a seu pedido. Ative de novo em Minha conta.');
  logger.info('2FA desativado por admin', { target, by: admin.uid });
  res.status(200).json({ enabled: false });
}

export const twoFactor = onRequest({ ...defaultRuntime }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = String(body['action'] ?? '');

  try {
    if (action === 'adminReset') return await adminReset(req, res);

    const user = await requireAuthenticated(req, res, { allowPendingTwoFactor: true });
    if (!user) return;

    const pending = user.twoFactorPending === true;
    const blocked = () => fail(res, 403, 'wrong-state', 'Esta ação não vale para a situação da sua sessão.');

    switch (action) {
      case 'status': {
        const data = (await docRef(user.uid).get()).data() as TwoFactorDoc | undefined;
        res.status(200).json({ enabled: data?.enabled === true, pending });
        return;
      }
      case 'requestCode': {
        const purpose = String(body['purpose'] ?? '') as Purpose;
        if (!['login', 'enable', 'disable'].includes(purpose)) return fail(res, 400, 'invalid', 'Pedido inválido.');
        // Sessão pendente só pede o código de login, e só ela pede esse.
        if ((purpose === 'login') !== pending) return blocked();
        return await requestCode(user, purpose, res);
      }
      case 'verifyLogin': return pending ? await verifyLogin(user, body['code'], res) : blocked();
      case 'rebindSession': return await rebindSession(user, body['previousToken'], res);
      case 'enable': return pending ? blocked() : await enable(user, body['code'], res);
      case 'disable': return pending ? blocked() : await disable(user, body['code'], res);
      default: return fail(res, 400, 'invalid', 'Ação desconhecida.');
    }
  } catch (error) {
    logger.error('Falha na verificação em duas etapas', { action, error });
    fail(res, 500, 'internal', 'Não foi possível concluir agora. Tente de novo.');
  }
});
