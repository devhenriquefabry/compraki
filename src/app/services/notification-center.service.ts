import { Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore, collection, doc, getFirestore, limit, onSnapshot, query, serverTimestamp, where, writeBatch,
} from 'firebase/firestore';
import { ModalController } from '@ionic/angular';
import { filter } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { onAuthUserChanged } from '../core/auth-state';
import { isNativeApp, isStandalone, setAppBadge } from '../core/pwa';

const INVITE_KEY = 'vn_push_invite_at';
const INVITE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

interface UnreadEntry {
  id: string;
  link: string;
}

/**
 * Contador de avisos não lidos (menu, sino do site, ícone do app instalado) e
 * a ponte entre o toque na notificação do celular e a tela certa.
 *
 * Fica no bundle inicial — por isso só escuta os NÃO lidos (consulta de um
 * campo, sem índice composto). A lista completa é da tela Notificações.
 */
@Injectable({ providedIn: 'root' })
export class NotificationCenterService {
  private readonly router = inject(Router);
  private readonly modalCtrl = inject(ModalController);
  private readonly db: Firestore;

  /** Avisos não lidos da conta atual (até 99). */
  readonly unread = signal(0);

  private uid: string | null = null;
  private entries: UnreadEntry[] = [];
  private started = false;

  constructor() {
    const app = getApps().length ? getApp() : initializeApp(environment.firebase);
    this.db = getFirestore(app);
  }

  /** Chamado uma vez pelo AppComponent. */
  start(): void {
    if (this.started) return;
    this.started = true;

    let stop: (() => void) | undefined;
    onAuthUserChanged(user => {
      stop?.();
      stop = undefined;
      this.uid = user?.uid ?? null;
      this.entries = [];
      this.unread.set(0);
      if (!user) {
        setAppBadge(0);
        return;
      }

      const q = query(
        collection(this.db, `users/${user.uid}/notifications`),
        where('read', '==', false),
        limit(99)
      );
      stop = onSnapshot(q, snap => {
        this.entries = snap.docs.map(d => ({ id: d.id, link: String(d.get('link') || '') }));
        this.unread.set(snap.size);
        setAppBadge(snap.size);
        this.markReadForUrl(this.router.url);
      }, err => console.warn('[avisos] contador parou', err));

      if (!isNativeApp() && isStandalone() && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          void import('../core/push').then(m => m.syncPushSubscription(user.uid))
            .catch(err => console.warn('[avisos] inscrição de push não sincronizada', err));
        } else if (Notification.permission === 'default') {
          // Já deixa o service worker pronto para o toque em "Ativar".
          void import('../core/push').then(m => m.preparePush()).catch(() => undefined);
          this.scheduleInvite(user.uid);
        }
      }
    });

    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(e => {
      this.handleAvisoParam(e.urlAfterRedirects);
      this.markReadForUrl(e.urlAfterRedirects);
    });

    // Toque na notificação com o app já aberto: o service worker manda a rota.
    if (!isNativeApp() && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        const data = event.data || {};
        if (data.type !== 'vn-open' || typeof data.url !== 'string') return;
        if (data.id) void this.markRead([data.id]);
        void this.router.navigateByUrl(data.url);
      });
    }
  }

  /**
   * Convite para ativar o push, no app instalado: alguns segundos depois de
   * abrir, uma vez; "Agora não" adia 7 dias. Não aparece por cima de outra
   * janela nem nas telas de entrada ou na própria tela Notificações (que já
   * tem o botão de ativar).
   */
  private scheduleInvite(uid: string): void {
    try {
      const last = Number(localStorage.getItem(INVITE_KEY) || 0);
      if (Date.now() - last < INVITE_SNOOZE_MS) return;
    } catch { /* sem storage: convida mesmo assim */ }

    setTimeout(async () => {
      if (this.uid !== uid || Notification.permission !== 'default') return;
      if (/^\/(login|sign-in|forgot-password|password-recovery|tabs\/notifications|notifications)/.test(this.router.url)) return;
      if (await this.modalCtrl.getTop()) return;
      try { localStorage.setItem(INVITE_KEY, String(Date.now())); } catch { /* idem */ }

      const { PushInviteComponent } = await import('../components/push-invite/push-invite.component');
      const modal = await this.modalCtrl.create({
        component: PushInviteComponent,
        componentProps: { uid },
        cssClass: 'vn-push-invite',
      });
      await modal.present();
    }, 6000);
  }

  /** Marca como lidos (ignora os que já estão). */
  async markRead(ids: string[]): Promise<void> {
    const uid = this.uid;
    if (!uid || !ids.length) return;
    const batch = writeBatch(this.db);
    for (const id of ids.slice(0, 450)) {
      batch.update(doc(this.db, `users/${uid}/notifications/${id}`), { read: true, readAt: serverTimestamp() });
    }
    await batch.commit().catch(err => console.warn('[avisos] não marcou como lido', err));
  }

  /** Todos os não lidos da conta (mais os que a tela tiver carregado). */
  async markAllRead(extra: string[] = []): Promise<void> {
    await this.markRead([...new Set([...this.entries.map(e => e.id), ...extra])]);
  }

  /**
   * Abriu a tela de que o aviso falava (a conversa, a venda): o aviso já
   * cumpriu o papel, vira lido. Rotas genéricas (abas de pedidos) não contam.
   */
  private markReadForUrl(url: string): void {
    const path = url.split('?')[0];
    if (!/^\/(chat-details|sale-details)\//.test(path)) return;
    const ids = this.entries.filter(e => e.link === path).map(e => e.id);
    if (ids.length) void this.markRead(ids);
  }

  /** `?aviso=<id>` vem do toque na notificação com o app fechado. */
  private handleAvisoParam(url: string): void {
    if (!url.includes('aviso=')) return;
    const tree = this.router.parseUrl(url);
    const id = tree.queryParams['aviso'];
    if (!id) return;
    // A sessão pode ainda estar sendo restaurada na abertura do app.
    let tries = 0;
    const retry = () => {
      if (this.uid) void this.markRead([id]);
      else if (tries++ < 10) setTimeout(retry, 1000);
    };
    retry();
    delete tree.queryParams['aviso'];
    void this.router.navigateByUrl(tree, { replaceUrl: true });
  }
}
