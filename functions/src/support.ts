import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';

import {
  describeItems, itemsOf, notifyUser, photoOf, sellerAmountOf, sellerItemsOf, stageOf,
} from './notifications';
import { defaultRuntime, handleCors, isBootstrapAdminEmail, methodNotAllowed, requireAuthenticated } from './shared/http';
import { appUrl, escapeHtml, mailParagraph, mailQuote, mailShell, sendMail } from './shared/mail';

/**
 * "Fale com a Vineon": atendimento por protocolo.
 * ----------------------------------------------------------------------------
 * `supportTickets/{id}` (+ `replies/` e `notes/`). O cliente só LÊ; quem cria
 * atendimento, grava mensagem e muda o status são as duas funções abaixo, que
 * validam, limitam abuso, numeram e avisam. Assim a regra do Firestore fica
 * pequena e ninguém consegue se passar pela equipe (`senderRole` é do servidor).
 *
 * Os limites e a lista de assuntos espelham `src/app/core/support-config.ts` e
 * `support-topics.ts`. Mudou lá, mude aqui.
 */

type Status = 'waiting_staff' | 'waiting_customer' | 'resolved' | 'closed';
type Actor = 'user' | 'staff';

const LIMITS = {
  subjectMin: 3,
  subjectMax: 120,
  messageMin: 20,
  messageMax: 2000,
  replyMax: 2000,
  attachments: 3,
  fileBytes: 5 * 1024 * 1024,
  maxOpen: 5,
  createCooldownMs: 20_000,
  replyCooldownMs: 2_000,
  maxReplies: 100,
  reopenMs: 7 * 24 * 60 * 60 * 1000,
} as const;

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Meta de 1ª resposta em horas úteis (a promessa mostrada ao cliente é mais folgada). */
const TARGET_HOURS = { normal: 24, high: 8 } as const;

const TOPICS: Record<string, { label: string; priority: 'normal' | 'high' }> = {
  'pedido-atraso': { label: 'Pedido não chegou ou atrasou', priority: 'high' },
  'pedido-problema': { label: 'Pedido errado, faltando ou danificado', priority: 'normal' },
  pagamento: { label: 'Pagamento ou cobrança', priority: 'high' },
  devolucao: { label: 'Devolução e arrependimento', priority: 'normal' },
  'produto-vendedor': { label: 'Dúvida sobre produto ou vendedor', priority: 'normal' },
  conta: { label: 'Minha conta e acesso', priority: 'normal' },
  seguranca: { label: 'Segurança: conta invadida ou denúncia', priority: 'high' },
  privacidade: { label: 'Meus dados pessoais (LGPD)', priority: 'high' },
  anuncio: { label: 'Anúncio reprovado ou fora do ar', priority: 'normal' },
  'venda-envio': { label: 'Vendas e envio', priority: 'normal' },
  repasse: { label: 'Repasse e taxa', priority: 'normal' },
  'nota-fiscal': { label: 'Nota fiscal', priority: 'normal' },
  loja: { label: 'Minha loja e vitrine', priority: 'normal' },
  moderacao: { label: 'Contestar suspensão ou moderação', priority: 'high' },
  outro: { label: 'Outro assunto', priority: 'normal' },
};

/** Erro com código HTTP: o handler devolve `message` ao app. */
class SupportError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// ------------------------------------------------------------------ helpers

const BRT_MS = -3 * 60 * 60 * 1000;

/**
 * Soma horas contando só dias úteis (seg–sex, horário de Brasília). Sábado e
 * domingo não andam: o prazo de um chamado de sexta à noite vence na segunda.
 */
export function addWorkingHours(from: Date, hours: number): Date {
  let t = from.getTime() + BRT_MS;
  let remaining = hours * 60 * 60 * 1000;
  while (remaining > 0) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (dow === 0 ? 1 : 2));
      continue;
    }
    const endOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const room = endOfDay - t;
    if (remaining <= room) {
      t += remaining;
      remaining = 0;
    } else {
      remaining -= room;
      t = endOfDay;
    }
  }
  return new Date(t - BRT_MS);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Texto de usuário: quebras normalizadas, sem caracteres de controle, no limite. */
function cleanText(value: unknown, max: number): string {
  return str(value)
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function clipText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

interface StoredAttachment {
  path: string;
  name: string;
  contentType: string;
  size: number;
}

/**
 * Confere os anexos já enviados ao Storage: o caminho tem que ser da pasta
 * deste atendimento e o arquivo existe. Tipo e tamanho vêm dos metadados reais
 * do arquivo, não do que o app disse.
 */
async function checkAttachments(raw: unknown, prefix: string): Promise<StoredAttachment[]> {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > LIMITS.attachments) {
    throw new SupportError(400, `Envie no máximo ${LIMITS.attachments} anexos.`);
  }

  const bucket = getStorage().bucket();
  const out: StoredAttachment[] = [];
  for (const item of raw) {
    const path = str(item?.path);
    if (!path.startsWith(prefix) || path.includes('..') || path.length > 300) {
      throw new SupportError(400, 'Anexo inválido.');
    }
    let metadata: { contentType?: string; size?: string | number };
    try {
      [metadata] = await bucket.file(path).getMetadata();
    } catch {
      throw new SupportError(400, 'Um dos anexos não foi enviado por completo. Tente anexar de novo.');
    }
    const contentType = String(metadata.contentType || '');
    const size = Number(metadata.size) || 0;
    if (!FILE_TYPES.includes(contentType)) throw new SupportError(400, 'Só aceitamos fotos (JPG, PNG, WebP) e PDF.');
    if (size <= 0 || size > LIMITS.fileBytes) throw new SupportError(400, 'Cada anexo pode ter até 5 MB.');
    out.push({ path, name: cleanText(item?.name, 120) || 'anexo', contentType, size });
  }
  return out;
}

async function nextProtocol(): Promise<string> {
  const db = getFirestore();
  const year = new Date(Date.now() + BRT_MS).getUTCFullYear();
  const ref = db.doc(`supportCounters/${year}`);
  const seq = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? Number(snap.get('seq')) || 0 : 0) + 1;
    tx.set(ref, { seq: next, updatedAt: FieldValue.serverTimestamp() });
    return next;
  });
  return `VN-${year}-${String(seq).padStart(6, '0')}`;
}

async function profileOf(uid: string, tokenEmail?: string): Promise<{ name: string; email: string | null }> {
  const snap = await getFirestore().doc(`users/${uid}`).get();
  let email: string | null = null;
  const fromDoc = snap.get('email');
  if (typeof fromDoc === 'string' && fromDoc.includes('@')) email = fromDoc;
  else if (tokenEmail) email = tokenEmail;
  else email = (await getAuth().getUser(uid).catch(() => null))?.email ?? null;

  const name = String(snap.get('displayName') || '').trim() || (email ? email.split('@')[0] : 'Cliente');
  return { name, email };
}

/** Caixa que recebe o aviso de atendimento novo (a equipe responde pelo painel). */
function inboxAddress(): string | null {
  return process.env.SUPPORT_INBOX || process.env.SMTP_USER || null;
}

/** E-mail é um aviso a mais: falha não derruba o atendimento já gravado. */
async function tryMail(label: string, input: Parameters<typeof sendMail>[0]): Promise<void> {
  try {
    await sendMail(input);
  } catch (error) {
    logger.warn(`[atendimento] e-mail não enviado (${label})`, { message: (error as Error).message });
  }
}

function isOpen(status: unknown): boolean {
  return status === 'waiting_staff' || status === 'waiting_customer';
}

function fail(res: { status(code: number): { json(body: unknown): void } }, error: unknown, fallback: string): void {
  if (error instanceof SupportError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error('[atendimento] falha inesperada', { message: (error as Error)?.message, stack: (error as Error)?.stack });
  res.status(500).json({ error: fallback });
}

// ----------------------------------------------------------------- abrir

/**
 * Abre um atendimento. O app gera o `ticketId` (id automático do Firestore) e
 * já envia os anexos para `support/{uid}/{ticketId}/`; repetir a chamada com o
 * mesmo `ticketId` devolve o atendimento que já existe (duplo toque, rede ruim).
 */
export const createSupportTicket = onRequest({ ...defaultRuntime, maxInstances: 2 }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const db = getFirestore();
    const uid = auth.uid;

    const ticketId = str(body['ticketId']);
    if (!/^[A-Za-z0-9]{20}$/.test(ticketId)) throw new SupportError(400, 'Atendimento inválido.');

    const topicId = str(body['topic']);
    const topic = TOPICS[topicId];
    if (!topic) throw new SupportError(400, 'Escolha o assunto do atendimento.');

    const subject = cleanText(body['subject'], LIMITS.subjectMax).replace(/\s+/g, ' ');
    if (subject.length < LIMITS.subjectMin) throw new SupportError(400, 'Dê um título ao atendimento.');

    const message = cleanText(body['message'], LIMITS.messageMax);
    if (message.length < LIMITS.messageMin) {
      throw new SupportError(400, `Conte um pouco mais: a mensagem precisa ter pelo menos ${LIMITS.messageMin} caracteres.`);
    }

    const ticketRef = db.doc(`supportTickets/${ticketId}`);
    const existing = await ticketRef.get();
    if (existing.exists) {
      if (existing.get('userId') !== uid) throw new SupportError(409, 'Atendimento inválido.');
      res.status(200).json({ ok: true, id: ticketId, protocol: existing.get('protocol'), duplicate: true });
      return;
    }

    // Limites: poucos abertos ao mesmo tempo e um respiro entre um e outro.
    const recent = await db.collection('supportTickets')
      .where('userId', '==', uid)
      .orderBy('updatedAt', 'desc')
      .limit(30)
      .get();
    const now = Timestamp.now();
    const openCount = recent.docs.filter(d => isOpen(d.get('status'))).length;
    if (openCount >= LIMITS.maxOpen) {
      throw new SupportError(429, `Você já tem ${LIMITS.maxOpen} atendimentos em aberto. Aguarde a resposta ou marque algum como resolvido.`);
    }
    const lastCreated = recent.docs
      .map(d => (d.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    if (now.toMillis() - lastCreated < LIMITS.createCooldownMs) {
      throw new SupportError(429, 'Aguarde alguns segundos antes de abrir outro atendimento.');
    }

    const attachments = await checkAttachments(body['attachments'], `support/${uid}/${ticketId}/`);

    // Pedido: precisa ser da pessoa (compra ou venda). O resumo fica gravado,
    // assim a equipe vê o pedido como estava na hora do contato.
    let role: 'buyer' | 'seller' = body['role'] === 'seller' ? 'seller' : 'buyer';
    const orderId = str(body['orderId']);
    let linkedOrderId: string | null = null;
    let orderSnapshot: Record<string, unknown> | null = null;
    if (orderId) {
      const orderSnap = await db.doc(`orders/${orderId}`).get();
      const order = orderSnap.data();
      const isBuyer = order?.['userId'] === uid;
      const isSeller = Array.isArray(order?.['sellerIds']) && order?.['sellerIds'].includes(uid);
      if (!order || (!isBuyer && !isSeller)) throw new SupportError(404, 'Pedido não encontrado.');

      const items = isBuyer ? itemsOf(order) : sellerItemsOf(order, uid);
      role = isBuyer ? 'buyer' : 'seller';
      linkedOrderId = orderId;
      orderSnapshot = {
        shortId: orderId.substring(0, 8).toUpperCase(),
        stage: stageOf(order),
        items: describeItems(items),
        photo: photoOf(items),
        // O vendedor não vê o total do comprador: só o que é da loja.
        total: isBuyer ? Number(order['total']) || 0 : sellerAmountOf(items),
        asRole: role,
      };
    }

    const { name, email } = await profileOf(uid, auth.email);
    const protocol = await nextProtocol();
    const priority = topic.priority;
    const dueAt = addWorkingHours(now.toDate(), TARGET_HOURS[priority]);

    const ticket: Record<string, unknown> = {
      protocol,
      userId: uid,
      userName: name,
      userEmail: email,
      userRole: role,
      topic: topicId,
      topicLabel: topic.label,
      subject,
      orderId: linkedOrderId,
      orderSnapshot,
      fromHelpArticle: str(body['fromHelpArticle']).slice(0, 80) || null,
      relatedTicketId: str(body['relatedTicketId']).slice(0, 40) || null,
      status: 'waiting_staff' as Status,
      priority,
      assigneeId: null,
      assigneeName: null,
      channel: 'app',
      createdAt: now,
      updatedAt: now,
      lastReplyAt: now,
      lastReplyBy: 'user',
      replyCount: 1,
      firstResponseDueAt: Timestamp.fromDate(dueAt),
      firstResponseAt: null,
      userUnread: false,
      staffUnread: true,
    };

    const batch = db.batch();
    batch.set(ticketRef, ticket);
    batch.set(ticketRef.collection('replies').doc(), {
      senderId: uid,
      senderRole: 'user',
      senderName: name,
      text: message,
      attachments,
      createdAt: now,
    });
    await batch.commit();
    logger.info('[atendimento] aberto', { id: ticketId, protocol, topic: topicId, priority });

    const link = `${appUrl()}/support/${ticketId}`;
    const jobs: Promise<void>[] = [];
    if (email) {
      jobs.push(tryMail('confirmação', {
        to: email,
        subject: `Recebemos seu atendimento ${protocol} — Vineon`,
        text: [
          `Olá, ${name.split(' ')[0]}!`,
          '',
          `Recebemos seu atendimento sobre "${topic.label}". O protocolo é ${protocol}.`,
          'A resposta da Vineon chega por aqui, no app, e também por e-mail.',
          '',
          `Acompanhe: ${link}`,
        ].join('\n'),
        html: mailShell({
          eyebrow: `Atendimento ${protocol}`,
          body: mailParagraph(`Olá, ${escapeHtml(name.split(' ')[0])}!`)
            + mailParagraph(`Recebemos seu atendimento sobre <b style="color:#0B1623;">${escapeHtml(topic.label)}</b>. O protocolo é <b style="color:#0B1623;">${protocol}</b>.`)
            + mailParagraph('A resposta da Vineon chega no app e também por e-mail.')
            + mailQuote(`${subject}\n\n${clipText(message, 400)}`),
          cta: { label: 'Acompanhar atendimento', url: link },
          footer: 'Guarde o número do protocolo. Você pode abrir o atendimento a qualquer momento em Minha conta › Fale com a Vineon.',
        }),
      }));
    }
    const inbox = inboxAddress();
    if (inbox) {
      jobs.push(tryMail('aviso à equipe', {
        to: inbox,
        replyTo: email || undefined,
        subject: `[Atendimento] ${protocol} · ${topic.label}${priority === 'high' ? ' · PRIORIDADE ALTA' : ''}`,
        text: `${name} <${email ?? 'sem e-mail'}>\n${subject}\n\n${clipText(message, 600)}\n\n${appUrl()}/admin/support?ticket=${ticketId}`,
        html: mailShell({
          eyebrow: `Novo atendimento ${protocol}`,
          body: mailParagraph(`<b style="color:#0B1623;">${escapeHtml(name)}</b> (${escapeHtml(email ?? 'sem e-mail')}) · ${escapeHtml(topic.label)}`)
            + mailQuote(`${subject}\n\n${clipText(message, 600)}`),
          cta: { label: 'Abrir no painel', url: `${appUrl()}/admin/support?ticket=${ticketId}` },
        }),
      }));
    }
    await Promise.allSettled(jobs);

    res.status(200).json({ ok: true, id: ticketId, protocol, firstResponseDueAt: dueAt.toISOString() });
  } catch (error) {
    fail(res, error, 'Não foi possível abrir o atendimento agora. Tente de novo em instantes.');
  }
});

// -------------------------------------------------------------- responder

/**
 * Responde e/ou muda o status. Serve a pessoa e a equipe:
 * - quem é dono do atendimento age como `user`; quem tem o claim `admin`, como `staff`;
 * - mensagem de cliente põe o atendimento na fila da Vineon (e reabre um
 *   resolvido, até 7 dias depois); mensagem da equipe passa a bola ao cliente;
 * - `status: 'resolved'` fecha o caso (cliente ou equipe); `closed` e
 *   `waiting_staff` são só da equipe; atendimento encerrado não recebe nada.
 */
export const replySupportTicket = onRequest({ ...defaultRuntime, maxInstances: 2 }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const db = getFirestore();

    const ticketId = str(body['ticketId']);
    if (!/^[A-Za-z0-9]{20}$/.test(ticketId)) throw new SupportError(400, 'Atendimento inválido.');

    const ticketRef = db.doc(`supportTickets/${ticketId}`);
    const first = await ticketRef.get();
    const preview = first.data();
    const isStaffToken = auth.isTokenAdmin === true || isBootstrapAdminEmail(auth.email);
    const actor: Actor | null = !preview ? null : preview['userId'] === auth.uid ? 'user' : isStaffToken ? 'staff' : null;
    // Não confirma que o atendimento existe para quem não é parte dele.
    if (!preview || !actor) throw new SupportError(404, 'Atendimento não encontrado.');

    const message = cleanText(body['message'], LIMITS.replyMax);
    const attachments = await checkAttachments(body['attachments'], `support/${preview['userId']}/${ticketId}/`);
    const hasContent = message.length > 0 || attachments.length > 0;

    const requested = str(body['status']) as Status | '';
    const allowed: Status[] = actor === 'staff' ? ['waiting_customer', 'waiting_staff', 'resolved', 'closed'] : ['resolved'];
    if (requested && !allowed.includes(requested)) throw new SupportError(400, 'Esta ação não está disponível.');
    if (!hasContent && !requested) throw new SupportError(400, 'Escreva a mensagem.');

    const staff = actor === 'staff' ? await profileOf(auth.uid, auth.email) : null;
    const staffName = staff ? `${staff.name.split(' ')[0]} · Vineon` : null;

    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(ticketRef);
      const ticket = snap.data();
      if (!ticket) throw new SupportError(404, 'Atendimento não encontrado.');

      const current = ticket['status'] as Status;
      if (current === 'closed') throw new SupportError(409, 'Este atendimento foi encerrado. Abra um novo atendimento se precisar.');

      const now = Timestamp.now();
      let next: Status;
      let reopened = false;

      if (actor === 'user') {
        if (Number(ticket['replyCount']) >= LIMITS.maxReplies) {
          throw new SupportError(429, 'Este atendimento chegou ao limite de mensagens. Aguarde a resposta da equipe.');
        }
        const last = ticket['lastReplyAt'] as Timestamp | undefined;
        if (hasContent && ticket['lastReplyBy'] === 'user' && last && now.toMillis() - last.toMillis() < LIMITS.replyCooldownMs) {
          throw new SupportError(429, 'Calma: aguarde um instante antes de enviar outra mensagem.');
        }

        if (requested === 'resolved') {
          if (current === 'resolved') throw new SupportError(409, 'Este atendimento já está resolvido.');
          next = 'resolved';
        } else {
          if (current === 'resolved') {
            const resolvedAt = ticket['resolvedAt'] as Timestamp | undefined;
            if (resolvedAt && now.toMillis() - resolvedAt.toMillis() > LIMITS.reopenMs) {
              throw new SupportError(409, 'O prazo para reabrir passou. Abra um novo atendimento.');
            }
            reopened = true;
          }
          next = 'waiting_staff';
        }
      } else {
        next = requested || 'waiting_customer';
        if (current === 'resolved' && next !== 'resolved' && next !== 'closed') reopened = true;
        if (next === current && !hasContent) throw new SupportError(409, 'O atendimento já está neste status.');
      }

      const update: Record<string, unknown> = { status: next, updatedAt: now };

      if (hasContent) {
        update['lastReplyAt'] = now;
        update['lastReplyBy'] = actor;
        update['replyCount'] = FieldValue.increment(1);
      }
      // Quem não escreveu é quem precisa ver.
      update['userUnread'] = actor === 'staff';
      update['staffUnread'] = actor === 'user';

      if (actor === 'staff') {
        if (hasContent && !ticket['firstResponseAt']) update['firstResponseAt'] = now;
        if (!ticket['assigneeId']) {
          update['assigneeId'] = auth.uid;
          update['assigneeName'] = staff?.name.split(' ')[0] ?? null;
        }
      }

      if (next === 'resolved') {
        update['resolvedAt'] = now;
        update['resolvedBy'] = actor;
      } else if (current === 'resolved' && next !== 'closed') {
        update['resolvedAt'] = FieldValue.delete();
        update['resolvedBy'] = FieldValue.delete();
        update['reopenCount'] = FieldValue.increment(1);
      }
      if (next === 'closed') update['closedAt'] = now;

      tx.update(ticketRef, update);

      const replies = ticketRef.collection('replies');
      if (hasContent) {
        tx.set(replies.doc(), {
          senderId: auth.uid,
          senderRole: actor,
          senderName: actor === 'staff' ? staffName : String(ticket['userName'] || 'Cliente'),
          text: message,
          attachments,
          createdAt: now,
        });
      }
      const event = next === 'resolved' ? 'resolved' : next === 'closed' ? 'closed' : reopened ? 'reopened' : null;
      if (event) {
        tx.set(replies.doc(), {
          senderId: auth.uid,
          senderRole: 'system',
          senderName: 'Vineon',
          text: '',
          event,
          eventBy: actor,
          attachments: [],
          createdAt: Timestamp.fromMillis(now.toMillis() + 1),
        });
      }

      return { ticket, next, event };
    });

    const { ticket, next, event } = result;
    const protocol = String(ticket['protocol']);
    const link = `${appUrl()}/support/${ticketId}`;
    const jobs: Promise<void>[] = [];

    if (actor === 'staff') {
      const title = next === 'resolved' ? 'Seu atendimento foi resolvido' : next === 'closed' ? 'Atendimento encerrado' : 'A Vineon respondeu seu atendimento';
      const bodyText = hasContent ? (message || 'A equipe enviou um anexo.') : `Atendimento ${protocol}.`;
      jobs.push(notifyUser(String(ticket['userId']), `support-${ticketId}`, {
        kind: 'support', icon: 'help',
        title, body: bodyText, link: `/support/${ticketId}`, tag: `support-${ticketId}`,
      }, { upsert: true }));

      const to = typeof ticket['userEmail'] === 'string' ? ticket['userEmail'] : '';
      if (to && next !== 'closed') {
        const first = String(ticket['userName'] || '').split(' ')[0];
        jobs.push(tryMail('resposta ao cliente', {
          to,
          subject: `${title} — ${protocol}`,
          text: [
            `Olá${first ? `, ${first}` : ''}!`,
            '',
            hasContent ? `${staffName} respondeu seu atendimento ${protocol}:` : `Seu atendimento ${protocol} foi marcado como resolvido.`,
            hasContent ? `\n${message || '(anexo)'}\n` : '',
            next === 'resolved' ? 'Se ainda precisar de ajuda, responda no app em até 7 dias.' : '',
            `Ver no app: ${link}`,
          ].filter(Boolean).join('\n'),
          html: mailShell({
            eyebrow: `Atendimento ${protocol}`,
            body: mailParagraph(`Olá${first ? `, ${escapeHtml(first)}` : ''}!`)
              + mailParagraph(hasContent
                ? `<b style="color:#0B1623;">${escapeHtml(staffName ?? 'A Vineon')}</b> respondeu seu atendimento sobre <b style="color:#0B1623;">${escapeHtml(String(ticket['topicLabel'] || 'sua dúvida'))}</b>:`
                : 'Seu atendimento foi marcado como resolvido.')
              + (message ? mailQuote(message) : '')
              + (next === 'resolved' ? mailParagraph('Se ainda precisar de ajuda, é só responder no app em até 7 dias.') : ''),
            cta: { label: 'Ver no app', url: link },
            footer: 'Responda pelo app para a conversa ficar guardada no seu protocolo.',
          }),
        }));
      }
    } else if (hasContent) {
      const inbox = inboxAddress();
      if (inbox) {
        jobs.push(tryMail('resposta do cliente', {
          to: inbox,
          replyTo: typeof ticket['userEmail'] === 'string' ? ticket['userEmail'] : undefined,
          subject: `[Atendimento] ${protocol} · ${event === 'reopened' ? 'reaberto · ' : ''}resposta do cliente`,
          text: `${ticket['userName']}: ${clipText(message, 600)}\n\n${appUrl()}/admin/support?ticket=${ticketId}`,
          html: mailShell({
            eyebrow: `Atendimento ${protocol}`,
            body: mailParagraph(`<b style="color:#0B1623;">${escapeHtml(String(ticket['userName'] || 'Cliente'))}</b> respondeu${event === 'reopened' ? ' e reabriu o atendimento' : ''}:`)
              + mailQuote(message || '(anexo)'),
            cta: { label: 'Abrir no painel', url: `${appUrl()}/admin/support?ticket=${ticketId}` },
          }),
        }));
      }
    }
    await Promise.allSettled(jobs);

    logger.info('[atendimento] atualizado', { id: ticketId, actor, status: next, event });
    res.status(200).json({ ok: true, status: next });
  } catch (error) {
    fail(res, error, 'Não foi possível enviar agora. Tente de novo em instantes.');
  }
});
