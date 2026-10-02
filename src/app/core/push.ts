import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { deleteDoc, doc, getFirestore, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { environment } from 'src/environments/environment';
import { PUSH_DEVICE_KEY, PushDeviceRecord, devicePlatform, isNativeApp, isStandalone, readPushDevice } from './pwa';

/**
 * Web Push no app instalado. Carregado sob demanda (tela Notificações, convite
 * de ativação e sincronização na abertura) — fora do bundle inicial.
 *
 * Fluxo: permissão do sistema → `pushManager.subscribe` com a chave VAPID →
 * inscrição gravada em `users/{uid}/pushSubscriptions/{hash do endpoint}` →
 * a Cloud Function (functions/src/notifications.ts) manda para ela.
 */

export type PushStatus =
  /** Computador, app nativo ou navegador sem Push API. */
  | 'unsupported'
  /** Celular no navegador: precisa instalar o app para ter push. */
  | 'needs-install'
  /** App instalado, mas o iPhone é anterior ao iOS 16.4. */
  | 'ios-too-old'
  /** App instalado, ainda não perguntamos. */
  | 'default'
  /** Ativado neste aparelho. */
  | 'granted'
  /** A pessoa negou (só volta pelos ajustes do sistema). */
  | 'denied';

export function pushStatus(): PushStatus {
  if (isNativeApp()) return 'unsupported';
  const platform = devicePlatform();
  if (platform === 'desktop') return 'unsupported';
  if (!isStandalone()) return 'needs-install';

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return platform === 'ios' ? 'ios-too-old' : 'unsupported';

  const permission = Notification.permission;
  if (permission === 'granted') return 'granted';
  if (permission === 'denied') return 'denied';
  return 'default';
}

/** Falha numa etapa da ativação — o nome da etapa vai para a tela e para o diagnóstico. */
export class PushStepError extends Error {
  constructor(readonly step: string, message: string) {
    super(message);
  }
}

/** Corta a espera: no iPhone, promessa de push que nunca respondia deixava o botão em "Ativando…". */
function step<T>(name: string, promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PushStepError(name, 'tempo esgotado')), ms);
  });
  return Promise.race([promise, timeout])
    .catch(err => {
      throw err instanceof PushStepError ? err : new PushStepError(name, `${err?.name || 'Erro'}: ${err?.message || err}`);
    })
    .finally(() => clearTimeout(timer));
}

let preparing: Promise<ServiceWorkerRegistration | null> | null = null;
let prepared: ServiceWorkerRegistration | null = null;

/**
 * Deixa o service worker ativo ANTES do toque em "Ativar". Assim o toque chama
 * `pushManager.subscribe` na hora, ainda dentro do gesto — é o que o Safari
 * exige (e o próprio subscribe já mostra o pedido de permissão).
 */
export function preparePush(): Promise<ServiceWorkerRegistration | null> {
  if (!preparing) {
    preparing = step('service worker', swRegistration(), 20_000)
      .then(reg => (prepared = reg))
      .catch(err => {
        console.warn('[push] service worker não ficou pronto', err);
        preparing = null;
        return null;
      });
  }
  return preparing;
}

/**
 * Pede a permissão e inscreve o aparelho.
 *
 * TEM que ser chamada direto do toque no botão, sem `await` antes: o Safari
 * só mostra o pedido de permissão com o gesto do usuário ainda "quente".
 * Chame `preparePush()` antes (ao mostrar o botão).
 */
export async function enablePush(uid: string): Promise<PushStatus> {
  try {
    const reg = prepared;
    if (reg?.active) {
      // Dentro do gesto, sem nada antes: o subscribe pede a permissão sozinho.
      const pending = reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() });
      try {
        await step('inscrição', pending, 60_000);
      } catch (err) {
        if (Notification.permission === 'denied') return 'denied';
        if (Notification.permission === 'default') return 'default';
        throw err;
      }
    } else {
      const permission = await step('permissão', Notification.requestPermission(), 60_000);
      if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';
    }
    await syncPushSubscription(uid, true);
    void reportPush(uid, { ok: true });
    return 'granted';
  } catch (err: any) {
    void reportPush(uid, { ok: false, step: err?.step || '?', error: String(err?.message || err) });
    throw err;
  }
}

/**
 * Garante que a inscrição deste aparelho está gravada na conta atual.
 * Chamada na abertura do app; só escreve no Firestore quando algo mudou (ou
 * uma vez por semana, para o `lastSeenAt` dizer quais aparelhos estão vivos).
 */
export async function syncPushSubscription(uid: string, force = false): Promise<boolean> {
  if (pushStatus() !== 'granted') return false;

  const registration = await step('service worker', swRegistration(), 20_000);
  if (!registration) throw new PushStepError('service worker', 'navegador sem service worker');

  const key = vapidKey();
  let subscription = await step('inscrição atual', registration.pushManager.getSubscription(), 10_000);

  // Inscrição feita com outra chave VAPID (par trocado): refaz.
  if (subscription && !sameKey(subscription.options?.applicationServerKey, key)) {
    await subscription.unsubscribe().catch(() => undefined);
    subscription = null;
  }
  if (!subscription) {
    subscription = await step('inscrição',
      registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), 30_000);
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint || subscription.endpoint;
  const id = await hashEndpoint(endpoint);
  const saved = readPushDevice();
  const fresh = saved && saved.uid === uid && saved.id === id && Date.now() - saved.savedAt < 7 * 24 * 60 * 60 * 1000;
  if (fresh && !force) return true;

  // Troca de conta no mesmo aparelho: o logout (`forgetPushDevice`) já tirou
  // a inscrição da conta anterior; aqui ela só é gravada na atual.
  await step('salvar', setDoc(doc(db(), `users/${uid}/pushSubscriptions/${id}`), {
    endpoint,
    keys: { p256dh: json.keys?.['p256dh'] || '', auth: json.keys?.['auth'] || '' },
    platform: devicePlatform(),
    userAgent: navigator.userAgent.slice(0, 300),
    lastSeenAt: serverTimestamp(),
    ...(saved?.id === id && saved.uid === uid ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true }), 20_000);

  const record: PushDeviceRecord = { uid, id, endpoint, savedAt: Date.now() };
  try { localStorage.setItem(PUSH_DEVICE_KEY, JSON.stringify(record)); } catch { /* modo privado */ }
  return true;
}

/**
 * Última tentativa de ativar, gravada em `users/{uid}.pushSetup` — para
 * descobrir à distância em que etapa um celular falhou.
 */
async function reportPush(uid: string, result: { ok: boolean; step?: string; error?: string }): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    await updateDoc(doc(db(), `users/${uid}`), {
      pushSetup: {
        ...result,
        permission: 'Notification' in window ? Notification.permission : 'n/a',
        sw: reg ? (reg.active ? 'active' : reg.waiting ? 'waiting' : reg.installing ? 'installing' : 'none') : 'unregistered',
        controlled: !!navigator.serviceWorker?.controller,
        prepared: !!prepared,
        platform: devicePlatform(),
        userAgent: navigator.userAgent.slice(0, 200),
        at: serverTimestamp(),
      },
    });
  } catch { /* diagnóstico nunca atrapalha */ }
}

/** "Desativar neste aparelho": cancela a inscrição e apaga da conta. */
export async function disablePush(uid: string): Promise<void> {
  const registration = await step('service worker', swRegistration(), 10_000).catch(() => null);
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    const id = await hashEndpoint(subscription.endpoint);
    await deleteDoc(doc(db(), `users/${uid}/pushSubscriptions/${id}`)).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  }
  try { localStorage.removeItem(PUSH_DEVICE_KEY); } catch { /* modo privado */ }
}

/** Este aparelho tem inscrição ativa (permissão concedida não basta). */
export async function hasActiveSubscription(): Promise<boolean> {
  const registration = await step('service worker', swRegistration(), 10_000).catch(() => null);
  if (!registration) return false;
  return !!(await step('inscrição atual', registration.pushManager.getSubscription(), 10_000).catch(() => null));
}

/** Dispara a notificação de teste da própria conta (Cloud Function). */
export async function sendTestNotification(): Promise<{ devices: number }> {
  const user = getAuth(app()).currentUser;
  if (!user) throw new Error('Entre na sua conta para testar.');
  const token = await user.getIdToken();
  const res = await fetch(`${environment.functionsBaseUrl}/sendTestNotification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Não deu para enviar o teste agora.');
  return { devices: Number(body?.devices) || 0 };
}

// ------------------------------------------------------------------ apoio

function app() {
  return getApps().length ? getApp() : initializeApp(environment.firebase);
}

function db() {
  return getFirestore(app());
}

async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = (await navigator.serviceWorker.getRegistration('/'))
    ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
  return waitActive(reg);
}

/**
 * Espera o worker ficar ativo olhando a própria registration — sem
 * `navigator.serviceWorker.ready`, que pode nunca responder no iPhone.
 */
function waitActive(reg: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (reg.active) return Promise.resolve(reg);
  const worker = reg.installing || reg.waiting;
  if (!worker) return Promise.reject(new PushStepError('service worker', 'registro sem worker'));
  return new Promise((resolve, reject) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve(reg);
      else if (worker.state === 'redundant') reject(new PushStepError('service worker', 'worker descartado'));
    });
  });
}

async function hashEndpoint(endpoint: string): Promise<string> {
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

function vapidKey(): Uint8Array<ArrayBuffer> {
  return urlBase64ToUint8Array(environment.vapidPublicKey);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!current) return true; // Navegador que não expõe a chave: confia.
  const a = new Uint8Array(current);
  if (a.length !== expected.length) return false;
  return a.every((byte, i) => byte === expected[i]);
}
