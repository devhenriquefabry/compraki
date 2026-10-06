/**
 * Excluir conta: conversa com a Cloud Function `deleteMyAccount`
 * (functions/src/account-deletion.ts), que faz tudo no servidor — o app não
 * tem permissão (nem deve ter) para apagar pedidos alheios, anonimizar
 * conversas ou remover o login.
 */

import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import {
  EmailAuthProvider, GoogleAuthProvider, User, reauthenticateWithCredential, reauthenticateWithPopup,
} from 'firebase/auth';

import { environment } from '../../environments/environment';

export interface DeletionBlocker {
  kind: 'purchase' | 'sale';
  orderId: string;
  reason: string;
}

export interface DeletionSummary {
  products: number;
  addresses: number;
  savedProducts: number;
  chats: number;
  tickets: number;
  reviews: number;
  ordersKept: number;
  salesKept: number;
}

export interface DeletionCheck {
  ok: boolean;
  blockers: DeletionBlocker[];
  summary: DeletionSummary;
}

export class AccountDeletionError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

async function call(user: User, dryRun: boolean): Promise<DeletionCheck> {
  const token = await user.getIdToken(true);
  let response: Response;
  try {
    response = await fetch(`${environment.functionsBaseUrl}/deleteMyAccount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ dryRun }),
    });
  } catch {
    throw new AccountDeletionError('Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* resposta sem JSON */ }
  if (response.status === 409) return data as DeletionCheck;
  if (!response.ok) throw new AccountDeletionError(data?.error || 'Não foi possível concluir agora.', data?.code);
  return data as DeletionCheck;
}

/** Confere o que impede a exclusão e o que vai ser apagado. Não apaga nada. */
export function checkAccountDeletion(user: User): Promise<DeletionCheck> {
  return call(user, true);
}

/** Apaga a conta. Exige login recente — use `confirmIdentity` antes. */
export function deleteAccount(user: User): Promise<DeletionCheck> {
  return call(user, false);
}

/** Como a pessoa entra: com senha, com Google ou com os dois. */
export function signInMethods(user: User): { password: boolean; google: boolean } {
  const ids = user.providerData.map(p => p.providerId);
  return { password: ids.includes('password'), google: ids.includes('google.com') };
}

/**
 * Confirma que é a própria pessoa (login recente), pela senha ou pelo Google.
 * A conta do Google escolhida precisa ser a mesma da Vineon.
 */
export async function confirmIdentity(user: User, password?: string): Promise<void> {
  try {
    if (password) {
      if (!user.email) throw new AccountDeletionError('Esta conta não tem e-mail para confirmar com senha.');
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      return;
    }
    if (Capacitor.isNativePlatform()) {
      const googleUser = await GoogleAuth.signIn();
      const idToken = googleUser.authentication?.idToken;
      if (!idToken) throw new AccountDeletionError('O Google não confirmou a conta.');
      await reauthenticateWithCredential(user, GoogleAuthProvider.credential(idToken));
    } else {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
    }
  } catch (error) {
    if (error instanceof AccountDeletionError) throw error;
    const code = (error as { code?: string })?.code || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') throw new AccountDeletionError('Senha incorreta.');
    if (code === 'auth/user-mismatch') throw new AccountDeletionError('Escolha a mesma conta do Google que você usa na Vineon.');
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') throw new AccountDeletionError('Confirmação cancelada.');
    if (code === 'auth/too-many-requests') throw new AccountDeletionError('Muitas tentativas. Espere alguns minutos.');
    throw new AccountDeletionError('Não foi possível confirmar sua identidade.');
  }
}
