import {
  Component, DestroyRef, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { collection, getDocs, getFirestore, limit, query, where } from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { getCurrentUser, onAuthUserChanged } from '../../core/auth-state';
import { VineonLogoComponent } from '../../components/vineon-logo/vineon-logo.component';
import { FirebaseProducts } from '../../services/firebase-products';
import { DevProductsPage } from '../dev-products/dev-products.page';
import { ManageChatsPage } from '../manage-chats/manage-chats.page';
import { ManageBannersPage } from '../manage-banners/manage-banners.page';
import { ManageWhatsappPage } from '../manage-whatsapp/manage-whatsapp.page';
import { MelhorEnvioPage } from '../melhor-envio/melhor-envio.page';
import { AdminMetricsPage } from '../admin-metrics/admin-metrics.page';
import { BotsPage } from '../bots/bots.page';
import { ManageUsersPage } from '../manage-users/manage-users.page';
import { ManageRefundsPage } from '../manage-refunds/manage-refunds.page';
import { ManageOrdersPage } from '../manage-orders/manage-orders.page';
import { ManageReportsPage } from '../manage-reports/manage-reports.page';
import { AdminSettingsPage } from '../admin-settings/admin-settings.page';
import { ManageSellersPage } from '../manage-sellers/manage-sellers.page';

type AdminTab =
  | 'metrics'
  | 'products'
  | 'chats'
  | 'banners'
  | 'whatsapp'
  | 'melhor-envio'
  | 'bots'
  | 'users'
  | 'refunds'
  | 'orders'
  | 'reports'
  | 'settings'
  | 'sellers';

interface NavItem {
  id: AdminTab;
  title: string;
  icon: string;
  iconActive: string;
  /** Linha curta que aparece na busca rápida. */
  hint: string;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

/** Resultado da busca rápida: uma seção do painel ou um atalho. */
interface PaletteEntry {
  key: string;
  title: string;
  hint: string;
  icon: string;
  group: string;
  run: () => void;
}

const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Visão geral',
    items: [
      { id: 'metrics', title: 'Métricas', icon: 'analytics-outline', iconActive: 'analytics', hint: 'Receita, pedidos e usuários em tempo real' },
    ],
  },
  {
    heading: 'Operação',
    items: [
      { id: 'orders', title: 'Pedidos', icon: 'receipt-outline', iconActive: 'receipt', hint: 'Do pagamento à entrega' },
      { id: 'sellers', title: 'Vendedores', icon: 'storefront-outline', iconActive: 'storefront', hint: 'Vendas por loja, taxa da Vineon e nota fiscal do mês' },
      { id: 'products', title: 'Produtos', icon: 'cube-outline', iconActive: 'cube', hint: 'Inventário de todos os vendedores' },
      { id: 'refunds', title: 'Devoluções', icon: 'swap-horizontal-outline', iconActive: 'swap-horizontal', hint: 'Valores retidos e pedidos de devolução' },
      { id: 'reports', title: 'Denúncias', icon: 'flag-outline', iconActive: 'flag', hint: 'Anúncios e vendedores denunciados' },
    ],
  },
  {
    heading: 'Relacionamento',
    items: [
      { id: 'chats', title: 'Conversas', icon: 'chatbubbles-outline', iconActive: 'chatbubbles', hint: 'Mensagens entre compradores e vendedores' },
      { id: 'users', title: 'Usuários', icon: 'people-outline', iconActive: 'people', hint: 'Contas, suspensões e mapa de calor' },
      { id: 'whatsapp', title: 'WhatsApp', icon: 'logo-whatsapp', iconActive: 'logo-whatsapp', hint: 'Instâncias e respostas automáticas' },
    ],
  },
  {
    heading: 'Loja e integrações',
    items: [
      { id: 'banners', title: 'Banners', icon: 'images-outline', iconActive: 'images', hint: 'Destaques da home e da exploração' },
      { id: 'melhor-envio', title: 'Melhor Envio', icon: 'paper-plane-outline', iconActive: 'paper-plane', hint: 'Fretes, etiquetas e simulador' },
      { id: 'bots', title: 'Bots', icon: 'hardware-chip-outline', iconActive: 'hardware-chip', hint: 'Automações e fila de execução' },
      { id: 'settings', title: 'Ajustes', icon: 'options-outline', iconActive: 'options', hint: 'Frete grátis, nomes bloqueados e redes' },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap(group => group.items.map(item => ({ ...item, group: group.heading })));
const VALID_TABS = new Set<string>(ALL_ITEMS.map(item => item.id));
const COLLAPSE_KEY = 'vn_admin_sidebar_collapsed';
/** Contagens dos selos da barra lateral: no máximo uma consulta por minuto. */
const BADGE_TTL_MS = 60_000;
const BADGE_CAP = 100;

/**
 * Casca do painel de gestão: barra lateral agrupada, trilha no topo e busca
 * rápida (Ctrl/⌘ + K). No celular e no tablet a barra vira gaveta.
 *
 * As seções continuam sendo as mesmas páginas de antes, trocadas por
 * `/admin/:tab`; aqui só muda a moldura em volta delas.
 */
@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    RouterModule,
    VineonLogoComponent,
    AdminMetricsPage,
    DevProductsPage,
    ManageChatsPage,
    ManageBannersPage,
    ManageWhatsappPage,
    MelhorEnvioPage,
    BotsPage,
    ManageUsersPage,
    ManageRefundsPage,
    ManageOrdersPage,
    ManageReportsPage,
    AdminSettingsPage,
    ManageSellersPage,
  ],
})
export class AdminPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly modalCtrl = inject(ModalController);
  private readonly products = inject(FirebaseProducts);
  private readonly destroyRef = inject(DestroyRef);

  private readonly navEl = viewChild<ElementRef<HTMLElement>>('nav');
  private readonly paletteInput = viewChild<ElementRef<HTMLInputElement>>('paletteInput');

  readonly groups = NAV_GROUPS;
  readonly activeTab = signal<AdminTab>('metrics');
  readonly collapsed = signal(readCollapsed());
  readonly drawerOpen = signal(false);
  readonly userMenuOpen = signal(false);

  readonly paletteOpen = signal(false);
  readonly paletteQuery = signal('');
  readonly paletteIndex = signal(0);

  readonly badges = signal<Partial<Record<AdminTab, number>>>({});
  private badgesFetchedAt = 0;

  readonly user = signal(getCurrentUser());
  readonly userName = computed(() => {
    const user = this.user();
    return user?.displayName || user?.email?.split('@')[0] || 'Administrador';
  });
  readonly userInitials = computed(() =>
    this.userName().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase());

  readonly activeItem = computed(() => ALL_ITEMS.find(item => item.id === this.activeTab()) ?? ALL_ITEMS[0]);

  /** Posição da faixa lima que acompanha a seção ativa na barra lateral. */
  readonly rail = signal<{ top: number; height: number } | null>(null);

  readonly isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  private readonly paletteEntries: PaletteEntry[] = [
    ...ALL_ITEMS.map(item => ({
      key: item.id,
      title: item.title,
      hint: item.hint,
      icon: item.icon,
      group: 'Seções',
      run: () => void this.router.navigate(['/admin', item.id]),
    })),
    {
      key: 'store', title: 'Abrir a loja', hint: 'Ver o Vineon como o comprador vê',
      icon: 'storefront-outline', group: 'Atalhos', run: () => void this.router.navigate(['/tabs/tab2']),
    },
    {
      key: 'webhooks', title: 'Laboratório de webhooks', hint: 'Testar notificações de pagamento',
      icon: 'flask-outline', group: 'Atalhos', run: () => void this.router.navigate(['/webhook-tester']),
    },
    {
      key: 'logout', title: 'Sair da conta', hint: 'Encerrar a sessão neste aparelho',
      icon: 'log-out-outline', group: 'Atalhos', run: () => this.logout(),
    },
  ];

  readonly paletteResults = computed(() => {
    const term = normalize(this.paletteQuery());
    if (!term) return this.paletteEntries;
    return this.paletteEntries.filter(entry => normalize(`${entry.title} ${entry.hint}`).includes(term));
  });

  constructor() {
    // Ícones vêm por nome de /svg/ (asset do ionicons em angular.json): importar
    // de 'ionicons/icons' aqui levaria os SVGs para o bundle inicial.
    const stopAuthWatch = onAuthUserChanged(user => this.user.set(user));
    this.destroyRef.onDestroy(stopAuthWatch);
  }

  ngOnInit() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const tab = params.get('tab');

      if (tab && VALID_TABS.has(tab)) {
        if (tab !== 'products') {
          this.dismissProductChatModals();
        }

        this.activeTab.set(tab as AdminTab);
        this.drawerOpen.set(false);
        this.placeRail();
        void this.refreshBadges();
        return;
      }

      this.router.navigate(['/admin/metrics'], { replaceUrl: true });
    });
  }

  // ------------------------------------------------------------ barra lateral

  toggleSidebar() {
    if (window.matchMedia('(min-width: 992px)').matches) {
      const next = !this.collapsed();
      this.collapsed.set(next);
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* modo privado */ }
      this.placeRail();
    } else {
      this.drawerOpen.update(open => !open);
    }
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  badgeFor(id: AdminTab): number {
    return this.badges()[id] ?? 0;
  }

  /** Mede o item ativo depois que o Angular pinta a troca de seção. */
  private placeRail() {
    requestAnimationFrame(() => {
      const nav = this.navEl()?.nativeElement;
      const link = nav?.querySelector<HTMLElement>(`[data-tab="${this.activeTab()}"]`);
      this.rail.set(link ? { top: link.offsetTop, height: link.offsetHeight } : null);
    });
  }

  /**
   * Selos de "precisa de atenção": denúncias abertas e devoluções pedidas.
   *
   * Consulta limitada em vez de `getCountFromServer`: a agregação puxaria
   * código novo do Firestore para o bundle inicial, que está no teto de 2 MB.
   * Acima do limite o selo mostra "99+".
   */
  private async refreshBadges() {
    const now = Date.now();
    if (now - this.badgesFetchedAt < BADGE_TTL_MS) return;
    this.badgesFetchedAt = now;

    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    const db = getFirestore(app);
    const count = (field: string, value: string, path: string) =>
      getDocs(query(collection(db, path), where(field, '==', value), limit(BADGE_CAP)))
        .then(snap => snap.size)
        .catch(() => 0);

    const [reports, refunds] = await Promise.all([
      count('status', 'open', 'contentReports'),
      count('refundInfo.status', 'REQUESTED', 'orders'),
    ]);
    this.badges.set({ reports, refunds });
  }

  // ------------------------------------------------------------ busca rápida

  openPalette() {
    this.userMenuOpen.set(false);
    this.paletteQuery.set('');
    this.paletteIndex.set(0);
    this.paletteOpen.set(true);
    setTimeout(() => this.paletteInput()?.nativeElement.focus());
  }

  closePalette() {
    this.paletteOpen.set(false);
  }

  onPaletteInput(value: string) {
    this.paletteQuery.set(value);
    this.paletteIndex.set(0);
  }

  onPaletteKey(event: KeyboardEvent) {
    const total = this.paletteResults().length;
    if (event.key === 'ArrowDown' && total) {
      event.preventDefault();
      this.paletteIndex.update(i => (i + 1) % total);
      this.scrollActiveResult();
    } else if (event.key === 'ArrowUp' && total) {
      event.preventDefault();
      this.paletteIndex.update(i => (i - 1 + total) % total);
      this.scrollActiveResult();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = this.paletteResults()[this.paletteIndex()];
      if (entry) this.runEntry(entry);
    }
  }

  runEntry(entry: PaletteEntry) {
    this.closePalette();
    entry.run();
  }

  private scrollActiveResult() {
    requestAnimationFrame(() =>
      document.querySelector('.adm-palette__item.is-active')?.scrollIntoView({ block: 'nearest' }));
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKey(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (this.paletteOpen()) this.closePalette();
      else this.openPalette();
      return;
    }

    if (event.key === 'Escape') {
      if (this.paletteOpen()) this.closePalette();
      else if (this.userMenuOpen()) this.userMenuOpen.set(false);
      else if (this.drawerOpen()) this.drawerOpen.set(false);
    }
  }

  @HostListener('window:resize')
  onResize() {
    if (window.matchMedia('(min-width: 992px)').matches) this.drawerOpen.set(false);
    this.placeRail();
  }

  // ------------------------------------------------------------ conta

  toggleUserMenu() {
    this.userMenuOpen.update(open => !open);
  }

  logout() {
    this.userMenuOpen.set(false);
    this.products.signOut();
    this.router.navigate(['/login']);
  }

  private dismissProductChatModals() {
    localStorage.setItem('compraki_chat_open', 'false');
    void this.modalCtrl.dismiss(undefined, 'admin-tab-change', 'admin-mobile-chat-modal').catch(() => undefined);
    void this.modalCtrl.dismiss(undefined, 'admin-tab-change', 'admin-chat-inbox-modal').catch(() => undefined);
  }
}

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

/** Busca sem acento e sem caixa: "devolucoes" acha "Devoluções". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
