import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule, NavController, ToastController } from '@ionic/angular';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore, collection, deleteDoc, doc, getDoc, getFirestore, limit, onSnapshot, orderBy, query, updateDoc,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { onAuthUserChanged } from '../../core/auth-state';
import { toDate } from '../../core/order-stage';
import {
  PushStatus, disablePush, enablePush, hasActiveSubscription, pushStatus, sendTestNotification, syncPushSubscription,
} from '../../core/push';
import { canPromptInstall, devicePlatform, onInstallAvailabilityChange, promptInstall } from '../../core/pwa';
import { VN_ICONS, VnIconName } from '../../core/vn-icons';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { AppNotification, NotificationKind, NotificationPrefs } from '../../interfaces/notifications';
import { NotificationCenterService } from '../../services/notification-center.service';

type Filter = 'all' | 'orders' | 'sales' | 'messages';

interface DayGroup {
  label: string;
  items: AppNotification[];
}

const FILTERS: { id: Filter; label: string; kinds: NotificationKind[] | null }[] = [
  { id: 'all', label: 'Tudo', kinds: null },
  { id: 'orders', label: 'Compras', kinds: ['order'] },
  { id: 'sales', label: 'Vendas', kinds: ['sale', 'review'] },
  { id: 'messages', label: 'Mensagens', kinds: ['message'] },
];

const PAGE = 40;
const INSTALL_HINT_KEY = 'vn_install_hint_closed_at';
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * Notificações: os avisos da conta (pedidos, vendas, mensagens, avaliações)
 * em tempo real, e o controle do push neste aparelho.
 *
 * Push só existe no app instalado (PWA). No celular pelo navegador a tela
 * ensina a instalar; no computador o cartão de push nem aparece.
 */
@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: true,
  imports: [IonicModule, VnIconComponent],
})
export class NotificationsPage {
  private readonly db: Firestore;
  private readonly center = inject(NotificationCenterService);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly toastCtrl = inject(ToastController);
  private readonly destroyRef = inject(DestroyRef);

  readonly filters = FILTERS;
  readonly platform = devicePlatform();

  readonly uid = signal<string | null>(null);
  readonly items = signal<AppNotification[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly pageSize = signal(PAGE);
  readonly hasMore = signal(false);
  readonly filter = signal<Filter>('all');

  readonly push = signal<PushStatus>(pushStatus());
  readonly pushBusy = signal(false);
  readonly testing = signal(false);
  readonly showPrefs = signal(false);
  readonly prefs = signal<NotificationPrefs>({ orders: true, sales: true, messages: true, reviews: true });
  readonly installReady = signal(canPromptInstall());
  readonly installHintClosed = signal(this.readInstallHintClosed());

  readonly unread = computed(() => this.items().filter(n => !n.read).length);

  readonly unreadBy = computed<Record<Filter, number>>(() => {
    const counts: Record<Filter, number> = { all: 0, orders: 0, sales: 0, messages: 0 };
    for (const n of this.items()) {
      if (n.read) continue;
      counts.all++;
      for (const f of FILTERS) if (f.kinds?.includes(n.kind)) counts[f.id]++;
    }
    return counts;
  });

  readonly visible = computed(() => {
    const kinds = FILTERS.find(f => f.id === this.filter())?.kinds;
    return kinds ? this.items().filter(n => kinds.includes(n.kind)) : this.items();
  });

  readonly groups = computed<DayGroup[]>(() => {
    const today = startOfDay(new Date());
    const yesterday = today - 86_400_000;
    const weekAgo = today - 6 * 86_400_000;
    const buckets: DayGroup[] = [
      { label: 'Hoje', items: [] },
      { label: 'Ontem', items: [] },
      { label: 'Últimos 7 dias', items: [] },
      { label: 'Mais antigas', items: [] },
    ];
    for (const n of this.visible()) {
      const t = n.createdAt?.getTime() ?? 0;
      const i = t >= today ? 0 : t >= yesterday ? 1 : t >= weekAgo ? 2 : 3;
      buckets[i].items.push(n);
    }
    return buckets.filter(b => b.items.length);
  });

  constructor() {
    const app = getApps().length ? getApp() : initializeApp(environment.firebase);
    this.db = getFirestore(app);

    let stopList: (() => void) | undefined;
    const stopAuth = onAuthUserChanged(user => {
      stopList?.();
      stopList = undefined;
      this.uid.set(user?.uid ?? null);
      if (!user) {
        this.items.set([]);
        this.loading.set(false);
        return;
      }
      stopList = this.watch(user.uid);
      void this.loadPrefs(user.uid);
      void this.checkSubscription(user.uid);
    });

    const stopInstall = onInstallAvailabilityChange(() => this.installReady.set(canPromptInstall()));

    // Voltou ao app depois de mexer nos ajustes do sistema: relê a permissão.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      this.push.set(pushStatus());
      const uid = this.uid();
      if (uid) void this.checkSubscription(uid);
    };
    document.addEventListener('visibilitychange', onVisible);

    this.destroyRef.onDestroy(() => {
      stopAuth();
      stopList?.();
      stopInstall();
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  // ------------------------------------------------------------------ lista

  private watch(uid: string): () => void {
    let stop: (() => void) | undefined;
    const subscribe = (size: number) => {
      stop?.();
      const q = query(collection(this.db, `users/${uid}/notifications`), orderBy('createdAt', 'desc'), limit(size));
      stop = onSnapshot(q, snap => {
        this.items.set(snap.docs.map(d => toNotification(d.id, d.data())));
        this.hasMore.set(snap.size >= size);
        this.loading.set(false);
        this.failed.set(false);
      }, err => {
        console.error('[avisos] lista', err);
        this.failed.set(true);
        this.loading.set(false);
      });
    };
    subscribe(this.pageSize());
    this.loadMoreFn = () => {
      this.pageSize.update(n => n + PAGE);
      subscribe(this.pageSize());
    };
    return () => stop?.();
  }

  private loadMoreFn: () => void = () => undefined;

  loadMore(): void {
    this.loadMoreFn();
  }

  open(n: AppNotification): void {
    if (!n.read) void this.center.markRead([n.id]);
    void this.router.navigateByUrl(n.link || '/tabs/notifications');
  }

  async remove(n: AppNotification, event: Event): Promise<void> {
    event.stopPropagation();
    const uid = this.uid();
    if (!uid) return;
    try {
      await deleteDoc(doc(this.db, `users/${uid}/notifications/${n.id}`));
    } catch (err) {
      console.error('[avisos] apagar', err);
      void this.toast('Não deu para apagar agora.');
    }
  }

  async markAllRead(): Promise<void> {
    await this.center.markAllRead(this.items().filter(n => !n.read).map(n => n.id));
  }

  setFilter(id: Filter): void {
    this.filter.set(id);
  }

  emptyText(): string {
    switch (this.filter()) {
      case 'orders': return 'Pagamento aprovado, envio e entrega das suas compras aparecem aqui.';
      case 'sales': return 'Vendas novas, devoluções e avaliações dos seus produtos aparecem aqui.';
      case 'messages': return 'Quando uma loja ou um comprador escrever para você, avisamos aqui.';
      default: return 'Quando um pedido andar, você vender ou chegar mensagem, avisamos aqui.';
    }
  }

  // ------------------------------------------------------------------- push

  /** Do toque no botão, sem `await` antes (o iPhone exige o gesto "quente"). */
  activatePush(): void {
    const uid = this.uid();
    if (!uid || this.pushBusy()) return;
    this.pushBusy.set(true);
    enablePush(uid)
      .then(status => {
        this.push.set(status);
        if (status === 'granted') void this.toast('Notificações ativadas neste celular.');
      })
      .catch(err => {
        console.error('[avisos] ativar push', err);
        void this.toast('Não deu para ativar agora. Tente de novo em instantes.');
      })
      .finally(() => this.pushBusy.set(false));
  }

  async deactivatePush(): Promise<void> {
    const uid = this.uid();
    if (!uid) return;
    this.pushBusy.set(true);
    try {
      await disablePush(uid);
      this.push.set('default');
      this.showPrefs.set(false);
      void this.toast('Notificações desativadas neste celular.');
    } finally {
      this.pushBusy.set(false);
    }
  }

  async sendTest(): Promise<void> {
    if (this.testing()) return;
    this.testing.set(true);
    try {
      const { devices } = await sendTestNotification();
      void this.toast(devices > 0
        ? 'Teste enviado. A notificação chega em alguns segundos.'
        : 'Teste enviado, mas este celular ainda não está inscrito. Toque em Ativar.');
    } catch (err: any) {
      void this.toast(err?.message || 'Não deu para enviar o teste agora.');
    } finally {
      this.testing.set(false);
    }
  }

  async togglePref(key: keyof NotificationPrefs): Promise<void> {
    const uid = this.uid();
    if (!uid) return;
    const before = this.prefs();
    const next = { ...before, [key]: !before[key] };
    this.prefs.set(next);
    try {
      await updateDoc(doc(this.db, `users/${uid}`), { notificationPrefs: next });
    } catch (err) {
      console.error('[avisos] preferências', err);
      this.prefs.set(before);
      void this.toast('Não deu para salvar a preferência.');
    }
  }

  async install(): Promise<void> {
    const accepted = await promptInstall();
    if (accepted) void this.toast('Pronto! Abra a Vineon pelo ícone na tela inicial para ativar os avisos.');
  }

  closeInstallHint(): void {
    this.installHintClosed.set(true);
    try { localStorage.setItem(INSTALL_HINT_KEY, String(Date.now())); } catch { /* modo privado */ }
  }

  private readInstallHintClosed(): boolean {
    try {
      const at = Number(localStorage.getItem(INSTALL_HINT_KEY) || 0);
      return Date.now() - at < 30 * 86_400_000;
    } catch {
      return false;
    }
  }

  private async loadPrefs(uid: string): Promise<void> {
    try {
      const snap = await getDoc(doc(this.db, `users/${uid}`));
      const saved = snap.get('notificationPrefs') as Partial<NotificationPrefs> | undefined;
      if (saved) this.prefs.set({ ...this.prefs(), ...saved });
    } catch { /* fica o padrão: tudo ligado */ }
  }

  /** Permissão dada mas sem inscrição (raro: dados do app apagados). Refaz. */
  private async checkSubscription(uid: string): Promise<void> {
    if (pushStatus() !== 'granted') return;
    try {
      if (!(await hasActiveSubscription())) await syncPushSubscription(uid, true);
    } catch (err) {
      console.warn('[avisos] reinscrição', err);
    }
  }

  // ------------------------------------------------------------- apresentação

  iconOf(n: AppNotification): VnIconName {
    return n.icon in VN_ICONS ? n.icon : 'bell';
  }

  when(n: AppNotification): string {
    const date = n.createdAt;
    if (!date) return '';
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return 'agora';
    if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
    const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const day = startOfDay(date);
    const today = startOfDay(new Date());
    if (day === today) return hm;
    if (day === today - 86_400_000) return `ontem, ${hm}`;
    if (day > today - 6 * 86_400_000) return `${WEEKDAYS[date.getDay()]}, ${hm}`;
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return `${date.getDate()} ${MONTHS[date.getMonth()]}${sameYear ? '' : ' ' + date.getFullYear()}`;
  }

  goBack(): void {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 3200, position: 'top', color: 'dark' });
    await toast.present();
  }
}

function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toNotification(id: string, data: Record<string, any>): AppNotification {
  return {
    id,
    kind: (data['kind'] || 'system') as NotificationKind,
    icon: (data['icon'] || 'bell') as VnIconName,
    title: String(data['title'] || ''),
    body: String(data['body'] || ''),
    link: String(data['link'] || ''),
    image: typeof data['image'] === 'string' ? data['image'] : null,
    read: data['read'] === true,
    createdAt: toDate(data['createdAt']),
  };
}
