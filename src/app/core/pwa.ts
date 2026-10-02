import { Capacitor } from '@capacitor/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { deleteDoc, doc, getFirestore } from 'firebase/firestore';

import { environment } from 'src/environments/environment';

/**
 * Site instalado como app (PWA) — o mínimo que precisa estar no bundle inicial.
 * ----------------------------------------------------------------------------
 * Notificação push SÓ existe no app instalado: no iPhone é a única forma
 * (Safari libera push apenas para site "Adicionado à Tela de Início", iOS
 * 16.4+), e no Android foi uma escolha do produto — quem só navega pelo site
 * vê os avisos na tela Notificações, sem push.
 *
 * A parte pesada (pedir permissão, inscrever, gravar no Firestore) mora em
 * `core/push.ts`, carregada sob demanda.
 */

export type DevicePlatform = 'ios' | 'android' | 'desktop';

/** App nativo (APK do Capacitor): nada de service worker nem Web Push. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Aberto pelo ícone na tela inicial (PWA instalado), não no navegador. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || (navigator as any).standalone === true;
}

export function devicePlatform(): DevicePlatform {
  const ua = navigator.userAgent || '';
  // iPad com iPadOS se apresenta como Mac; o toque denuncia.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

// ------------------------------------------------------------ "Instalar app"

let installEvent: any = null;
const installListeners = new Set<() => void>();

/** O Android/Chrome ofereceu instalar (evento guardado para o botão "Instalar"). */
export function canPromptInstall(): boolean {
  return !!installEvent;
}

export function onInstallAvailabilityChange(listener: () => void): () => void {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

/** Abre o diálogo nativo de instalação. Precisa vir de um toque. */
export async function promptInstall(): Promise<boolean> {
  const event = installEvent;
  if (!event) return false;
  installEvent = null;
  installListeners.forEach(fn => fn());
  event.prompt();
  const choice = await event.userChoice.catch(() => null);
  return choice?.outcome === 'accepted';
}

/**
 * Registra o service worker (`/sw.js`) e guarda o convite de instalação do
 * Android. Chamado uma vez na abertura do app.
 */
export function setupPwa(): void {
  if (isNativeApp() || typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault();
    installEvent = event;
    installListeners.forEach(fn => fn());
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    installListeners.forEach(fn => fn());
  });

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .catch(err => console.warn('[pwa] service worker não registrado', err));
  // Depois do load: não disputa banda com a abertura do app.
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

// --------------------------------------------------------- aparelho atual

/** Onde o app lembra qual inscrição de push é deste aparelho. */
export const PUSH_DEVICE_KEY = 'vn_push_device';

export interface PushDeviceRecord {
  uid: string;
  id: string;
  endpoint: string;
  savedAt: number;
}

export function readPushDevice(): PushDeviceRecord | null {
  try {
    const raw = localStorage.getItem(PUSH_DEVICE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Antes do logout: tira este aparelho da conta, para os avisos dela não
 * continuarem chegando num celular onde ela não está mais logada. Tem que
 * rodar ANTES do `signOut` (depois as regras já não deixam apagar).
 */
export async function forgetPushDevice(): Promise<void> {
  const saved = readPushDevice();
  if (!saved) return;
  try {
    localStorage.removeItem(PUSH_DEVICE_KEY);
    const app = getApps().length ? getApp() : initializeApp(environment.firebase);
    await deleteDoc(doc(getFirestore(app), `users/${saved.uid}/pushSubscriptions/${saved.id}`));
  } catch (err) {
    console.warn('[pwa] não deu para remover a inscrição de push', err);
  }
}

/** Número no ícone do app instalado (iOS 16.4+, Android). */
export function setAppBadge(count: number): void {
  const nav = navigator as any;
  if (!isStandalone() || typeof nav.setAppBadge !== 'function') return;
  (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => undefined);
}
