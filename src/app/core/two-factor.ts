import { User, onIdTokenChanged } from 'firebase/auth';
import { environment } from 'src/environments/environment';
import { getFirebaseAuth } from './auth-state';

/**
 * Verificação em duas etapas por e-mail (opcional), lado do app.
 *
 * Quem decide é o servidor: `functions/src/two-factor.ts`, `isSignedIn()` nas
 * regras e `requireAuthenticated`. Aqui só se conduz a pessoa. Sessão pendente
 * = o token diz que a conta usa a verificação, mas o `auth_time` desta sessão
 * ainda não foi confirmado.
 */

export type TwoFactorPurpose = 'login' | 'enable' | 'disable';

export class TwoFactorError extends Error {
  constructor(message: string, readonly code?: string, readonly retryAfter?: number) {
    super(message);
  }
}

async function call<T>(user: User, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${environment.functionsBaseUrl}/twoFactor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new TwoFactorError('Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* resposta sem JSON */ }
  if (!response.ok) throw new TwoFactorError(data?.error || 'Não foi possível concluir agora.', data?.code, data?.retryAfter);
  return data as T;
}

export async function isSecondFactorPending(user: User, forceRefresh = false): Promise<boolean> {
  const { claims } = await user.getIdTokenResult(forceRefresh);
  if (claims['tfa'] !== true) return false;
  const sessions = claims['tfaSessions'];
  return !(Array.isArray(sessions) && sessions.includes(claims['auth_time']));
}

export async function twoFactorEnabled(user: User): Promise<boolean> {
  return (await call<{ enabled: boolean }>(user, 'status')).enabled;
}

export function requestTwoFactorCode(user: User, purpose: TwoFactorPurpose) {
  return call<{ sent: boolean; email: string; retryAfter: number }>(user, 'requestCode', { purpose });
}

/** Cada uma destas troca claims: o token novo é buscado antes de devolver. */
export async function verifyLoginCode(user: User, code: string): Promise<void> {
  await call(user, 'verifyLogin', { code });
  await user.getIdToken(true);
}

export async function enableTwoFactor(user: User, code: string): Promise<void> {
  await call(user, 'enable', { code });
  await user.getIdToken(true);
}

export async function disableTwoFactor(user: User, code: string): Promise<void> {
  await call(user, 'disable', { code });
  await user.getIdToken(true);
}

/** Admin, a pedido de quem perdeu o acesso ao e-mail. Ver Gerenciar usuários. */
export async function adminResetTwoFactor(admin: User, uid: string, reason: string): Promise<void> {
  await call(admin, 'adminReset', { uid, reason });
}

let keepingSession = 0;

/**
 * Para operações que reautenticam (trocar senha, excluir conta): o login novo
 * muda o `auth_time` e a sessão ficaria pendente no meio do caminho. Leva a
 * confirmação do token anterior para o novo, sem pedir outro código.
 */
export async function keepSessionVerified<T>(user: User, operation: () => Promise<T>): Promise<T> {
  const before = await user.getIdTokenResult();
  if (before.claims['tfa'] !== true) return operation();

  keepingSession++;
  try {
    const result = await operation();
    if (await isSecondFactorPending(user, true)) {
      await call(user, 'rebindSession', { previousToken: before.token });
      await user.getIdToken(true);
    }
    return result;
  } finally {
    keepingSession--;
  }
}

/**
 * Avisa quando a sessão fica pendente: app aberto com sessão não confirmada, ou
 * a verificação ligada em outro aparelho (o claim chega na renovação do token).
 */
export function watchSecondFactor(onPending: () => void): () => void {
  return onIdTokenChanged(getFirebaseAuth(), async user => {
    if (!user || keepingSession > 0) return;
    if (await isSecondFactorPending(user).catch(() => false)) onPending();
  });
}
