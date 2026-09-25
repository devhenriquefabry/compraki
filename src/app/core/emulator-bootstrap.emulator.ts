import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

// Import direto (e não `environments/environment`): este arquivo também é
// checado pelo tsc nos builds normais, onde `environment` não tem `emulators`.
// No build `emulator` os dois caminhos são o mesmo módulo.
import { environment } from 'src/environments/environment.emulator';

/**
 * Versão do build `emulator` de `emulator-bootstrap.ts`. Nunca vai para
 * produção: só entra no bundle pela troca de arquivo em angular.json.
 *
 * 1. Liga Auth, Firestore, Realtime Database e Storage nos emuladores. Tem que
 *    ser antes de qualquer service chamar `getAuth()`/`getFirestore()`, por
 *    isso roda no main.ts antes do Angular subir. Os services pegam a mesma
 *    instância e herdam a conexão.
 * 2. Login de teste sem senha: `?testUser=admin|vendedor|atelie|comprador` em qualquer
 *    URL entra com a conta criada pelo seed (npm run emulators:seed). Usa um
 *    custom token sem assinatura, que só o emulador de Auth aceita — em
 *    produção o mesmo token é recusado.
 *
 * Ver docs/testes-com-emulador.md.
 */

export const TEST_USERS = {
  admin: 'test-admin',
  vendedor: 'test-vendedor',
  atelie: 'test-atelie',
  comprador: 'test-comprador'
} as const;

type TestRole = keyof typeof TEST_USERS;

export async function prepareFirebase(): Promise<void> {
  const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
  const { host, auth: authPort, firestore, database, storage } = environment.emulators;

  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(getFirestore(app), host, firestore);
  connectDatabaseEmulator(getDatabase(app), host, database);
  connectStorageEmulator(getStorage(app), host, storage);

  // Para scripts e para o console do navegador: `vineonTest.loginAs('vendedor')`.
  (window as unknown as Record<string, unknown>)['vineonTest'] = {
    users: TEST_USERS,
    loginAs: async (role: TestRole) => {
      await loginAs(role);
      location.reload();
    },
    logout: async () => {
      await signOut(auth);
      location.reload();
    }
  };

  const params = new URLSearchParams(location.search);
  const requested = params.get('testUser');

  if (requested) {
    // Tira o parâmetro da URL antes do router ler, para não logar de novo a
    // cada navegação nem aparecer em redirects.
    params.delete('testUser');
    const query = params.toString();
    history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : '') + location.hash);

    if (requested === 'none') {
      await signOut(auth);
    } else if (isTestRole(requested)) {
      await loginAs(requested);
    } else {
      console.warn(`[emulador] testUser desconhecido: "${requested}". Use admin, vendedor, atelie, comprador ou none.`);
    }
  }

  // Espera o Auth restaurar a sessão salva: sem isso os guards podem ver
  // `null` por um instante e mandar para /login.
  await auth.authStateReady();
  showEmulatorBadge(auth.currentUser?.uid ?? null);
}

function isTestRole(value: string): value is TestRole {
  return Object.prototype.hasOwnProperty.call(TEST_USERS, value);
}

/**
 * Sempre refaz o login, mesmo que já seja a mesma conta: depois de um novo
 * seed a sessão salva no navegador aponta para um usuário que foi apagado e
 * recriado, com token e claims antigos.
 */
async function loginAs(role: TestRole): Promise<void> {
  const auth = getAuth();
  await auth.authStateReady();
  if (auth.currentUser) await signOut(auth);
  await signInWithCustomToken(auth, unsignedCustomToken(TEST_USERS[role]));
}

/**
 * Custom token com `alg: none`. O emulador de Auth não confere assinatura;
 * o Firebase de verdade recusa. As claims (`admin`) vêm do usuário gravado
 * pelo seed, não daqui.
 */
function unsignedCustomToken(uid: string): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

  const header = encode({ alg: 'none', typ: 'JWT' });
  const payload = encode({
    iss: 'firebase-auth-emulator@example.com',
    sub: 'firebase-auth-emulator@example.com',
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid
  });

  return `${header}.${payload}.`;
}

/** Selo fixo na tela: impossível confundir o ambiente local com o site real. */
function showEmulatorBadge(uid: string | null): void {
  const role = (Object.keys(TEST_USERS) as TestRole[]).find(key => TEST_USERS[key] === uid);
  const badge = document.createElement('div');
  badge.textContent = `EMULADOR · ${role ?? (uid ? 'outra conta' : 'sem login')}`;
  badge.setAttribute('aria-hidden', 'true');
  badge.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:8px', 'z-index:2147483647',
    'padding:2px 8px', 'border-radius:4px', 'font:600 11px/18px system-ui,sans-serif',
    'background:#b45309', 'color:#fff', 'pointer-events:none', 'opacity:.9'
  ].join(';');
  document.body.appendChild(badge);
}
