import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { deleteDoc, doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';

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

/**
 * Pede a permissão e inscreve o aparelho.
 *
 * TEM que ser chamada direto do toque no botão, sem `await` antes: o Safari
 * só mostra o pedido de permissão com o gesto do usuário ainda "quente".
 */
export async function enablePush(uid: string): Promise<PushStatus> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';
  await syncPushSubscription(uid, true);
  return 'granted';
}

/**
 * Garante que a inscrição deste aparelho está gravada na conta atual.
 * Chamada na abertura do app; só escreve no Firestore quando algo mudou (ou
 * uma vez por semana, para o `lastSeenAt` dizer quais aparelhos estão vivos).
 */
export async function syncPushSubscription(uid: string, force = false): Promise<boolean> {
  if (pushStatus() !== 'granted') return false;

  const registration = await swRegistration();
  if (!registration) return false;

  const key = urlBase64ToUint8Array(environment.vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();

  // Inscrição feita com outra chave VAPID (par trocado): refaz.
  if (subscription && !sameKey(subscription.options?.applicationServerKey, key)) {
    await subscription.unsubscribe().catch(() => undefined);
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint || subscription.endpoint;
  const id = await hashEndpoint(endpoint);
  const saved = readPushDevice();
  const fresh = saved && saved.uid === uid && saved.id === id && Date.now() - saved.savedAt < 7 * 24 * 60 * 60 * 1000;
  if (fresh && !force) return true;

  // Troca de conta no mesmo aparelho: o logout (`forgetPushDevice`) já tirou
  // a inscrição da conta anterior; aqui ela só é gravada na atual.
  await setDoc(doc(db(), `users/${uid}/pushSubscriptions/${id}`), {
    endpoint,
    keys: { p256dh: json.keys?.['p256dh'] || '', auth: json.keys?.['auth'] || '' },
    platform: devicePlatform(),
    userAgent: navigator.userAgent.slice(0, 300),
    lastSeenAt: serverTimestamp(),
    ...(saved?.id === id && saved.uid === uid ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true });

  const record: PushDeviceRecord = { uid, id, endpoint, savedAt: Date.now() };
  try { localStorage.setItem(PUSH_DEVICE_KEY, JSON.stringify(record)); } catch { /* modo privado */ }
  return true;
}

/** "Desativar neste aparelho": cancela a inscrição e apaga da conta. */
export async function disablePush(uid: string): Promise<void> {
  const registration = await swRegistration();
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
  const registration = await swRegistration();
  return !!(await registration?.pushManager.getSubscription());
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
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return navigator.serviceWorker.ready;
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

async function hashEndpoint(endpoint: string): Promise<string> {
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
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
