import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { environment } from 'src/environments/environment';

/**
 * Estado de autenticação compartilhado.
 *
 * Antes, cada guard montava uma Promise em volta de `onAuthStateChanged` e
 * desinscrevia no primeiro evento — em toda troca de rota. Aqui o listener é
 * único e o resultado fica em memória, então a segunda navegação em diante é
 * síncrona.
 *
 * Na Fase 2 isto vira um `AuthStore` com signals; a assinatura de
 * `waitForAuthUser()` e `isCurrentUserAdmin()` foi pensada para sobreviver a
 * essa troca sem mexer nos chamadores.
 */

let resolvedUser: User | null = null;
let hasResolvedOnce = false;
let pending: Promise<User | null> | null = null;

/** Cache do claim `admin`, invalidado quando o usuário muda. */
let cachedAdminUid: string | null = null;
let cachedIsAdmin = false;

export function getFirebaseAuth() {
  const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
  return getAuth(app);
}

/**
 * Resolve o usuário atual. Aguarda o primeiro `onAuthStateChanged` apenas na
 * primeira chamada; depois disso devolve o valor já conhecido.
 */
export function waitForAuthUser(): Promise<User | null> {
  if (hasResolvedOnce) {
    return Promise.resolve(resolvedUser);
  }

  if (pending) return pending;

  const auth = getFirebaseAuth();

  pending = new Promise<User | null>((resolve) => {
    // Listener permanente: mantém `resolvedUser` em dia e invalida o cache de
    // claim quando a conta troca (login/logout/troca de usuário).
    onAuthStateChanged(auth, (user) => {
      if (user?.uid !== resolvedUser?.uid) {
        cachedAdminUid = null;
        cachedIsAdmin = false;
      }

      resolvedUser = user;

      if (!hasResolvedOnce) {
        hasResolvedOnce = true;
        resolve(user);
      }
    });
  });

  return pending;
}

/** Usuário atual, sem esperar. `null` também significa "ainda não resolveu". */
export function getCurrentUser(): User | null {
  return resolvedUser;
}

/**
 * Observa mudanças de sessão (login, logout, troca de conta).
 *
 * Use isto em vez de `setInterval` chamando `getUser()`: o Firebase avisa
 * quando algo muda, não é preciso perguntar de tempos em tempos.
 *
 * @returns função para cancelar a inscrição.
 */
export function onAuthUserChanged(callback: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth();

  // Garante que o listener compartilhado está de pé antes de registrar o seu.
  void waitForAuthUser();

  return onAuthStateChanged(auth, callback);
}

/**
 * Verifica o custom claim `admin` no ID token.
 *
 * Esta é a ÚNICA fonte de verdade de privilégio administrativo no cliente.
 * Não ler `isAdmin` / `super_admin` / `role` do documento do usuário: esses
 * campos são graváveis pelo próprio dono e não valem como autorização.
 *
 * @param forceRefresh força a busca de um token novo. Necessário logo após
 *   `setAdminClaim`, já que o claim só entra no token na próxima renovação.
 */
export async function isCurrentUserAdmin(forceRefresh = false): Promise<boolean> {
  const user = await waitForAuthUser();
  if (!user) return false;

  if (!forceRefresh && cachedAdminUid === user.uid) {
    return cachedIsAdmin;
  }

  try {
    const token = await user.getIdTokenResult(forceRefresh);
    cachedAdminUid = user.uid;
    cachedIsAdmin = token.claims['admin'] === true;
    return cachedIsAdmin;
  } catch (error) {
    console.error('Falha ao ler os claims do ID token:', error);
    return false;
  }
}
