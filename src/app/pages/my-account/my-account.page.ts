import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { User } from 'firebase/auth';
import { getApp } from 'firebase/app';
import { collection, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { isCurrentUserAdmin, onAuthUserChanged } from 'src/app/core/auth-state';
import {
  COUNTED_TABS, MONTHS_LONG, OrderStage, STAGE_LABEL, deliveryWindow, formatBRL, formatDay, isPaid, itemCount, orderStage,
  paymentDueDate, sellerAmount, toDate,
} from 'src/app/core/order-stage';
import { VnIconName } from 'src/app/core/vn-icons';
import { AppUser } from 'src/app/interfaces/app-user';
import { Order } from 'src/app/interfaces/order';
import { AddressService } from 'src/app/services/address.service';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { OrdersService } from 'src/app/services/orders.service';
import { SalesService } from 'src/app/services/sales.service';
import { StorefrontDataService } from 'src/app/services/storefront-data.service';
import { NotificationCenterService } from 'src/app/services/notification-center.service';

/** Uma parada da rota de pedidos (compras ou vendas). */
interface RouteStop {
  tab: OrderStage;
  label: string;
  count: number | null;
}

/** Atalho de uma etapa no cartão "Seus pedidos". */
interface OrderShortcut {
  tab: OrderStage;
  label: string;
  icon: VnIconName;
  /** Só etapas que pedem atenção ganham número (mesma regra de "Minhas compras"). */
  count: number;
}

/** O pedido em destaque no cartão: o que mais pede atenção, ou o último. */
interface FeaturedOrder {
  tab: OrderStage;
  stage: string;
  title: string;
  more: string | null;
  photo: string | null;
  total: string;
  hint: string;
  urgent: boolean;
}

/** Linha das listas da conta. Sem `link` nem `action`, é um item "Em breve". */
interface AccountRow {
  icon: VnIconName;
  label: string;
  hint?: string;
  link?: string;
  query?: Record<string, string>;
  action?: 'editor' | 'security';
  badge?: number;
  alert?: boolean;
}

/**
 * Minha conta. Logo abaixo do topo, "Seus pedidos" mostra o pedido que mais pede
 * atenção e atalhos para cada etapa, lidos de `orders/`. A seção "Sua loja" só
 * existe para quem já anunciou (ou vendeu): rota das vendas e total do mês.
 * Quem só compra vê o convite para vender o primeiro produto. Nada aqui é
 * número de exemplo.
 */
@Component({
  selector: 'app-my-account',
  templateUrl: './my-account.page.html',
  styleUrls: ['./my-account.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyAccountPage {
  private readonly fbProducts = inject(FirebaseProducts);
  private readonly usersService = inject(FirebaseUsersService);
  private readonly ordersService = inject(OrdersService);
  private readonly salesService = inject(SalesService);
  private readonly addressService = inject(AddressService);
  private readonly storefront = inject(StorefrontDataService);
  private readonly toastCtrl = inject(ToastController);
  private readonly router = inject(Router);

  // ---------------------------------------------------------------- estado

  readonly view = signal<'overview' | 'editor'>('overview');
  readonly user = signal<User | null>(null);
  readonly appUser = signal<AppUser | null>(null);
  readonly isAdmin = signal(false);

  readonly orders = signal<Order[] | null>(null);
  readonly sales = signal<Order[] | null>(null);
  readonly productCount = signal<number | null>(null);
  readonly unseenInvoices = signal(0);
  readonly unreadNotifications = inject(NotificationCenterService).unread;
  /** Leitura de pedidos/vendas falhou: a tela diz isso em vez de mostrar zeros. */
  readonly ordersFailed = signal(false);
  readonly salesFailed = signal(false);

  readonly cartCount = toSignal(this.storefront.cartCount$, { initialValue: 0 });
  readonly savedCount = toSignal(this.storefront.savedItems$.pipe(map(items => items.length)), { initialValue: 0 });
  readonly addresses = toSignal(this.addressService.addresses$, { initialValue: [] });

  readonly isSavingProfile = signal(false);
  readonly isChangingPassword = signal(false);
  readonly passwordOpen = signal(false);

  profileForm = { displayName: '', username: '', email: '', phoneNumber: '', cpf: '' };
  passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };

  private dataSubs: Subscription[] = [];

  // ------------------------------------------------------------- derivados

  readonly firstName = computed(() => {
    const user = this.user();
    const name = this.appUser()?.displayName || user?.displayName || user?.email?.split('@')[0] || '';
    return name.trim().split(/\s+/)[0] || 'você';
  });

  readonly fullName = computed(() => this.appUser()?.displayName || this.user()?.displayName || '');

  readonly initials = computed(() => {
    const parts = (this.fullName() || this.firstName()).trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  });

  readonly photoUrl = computed(() => this.user()?.photoURL || this.appUser()?.photoURL || null);

  readonly memberSince = computed(() => {
    const created = toDate(this.user()?.metadata?.creationTime);
    return created ? `${MONTHS_LONG[created.getMonth()]} de ${created.getFullYear()}` : null;
  });

  /** Dados pessoais que faltam — vira aviso na linha "Dados pessoais". */
  readonly missingProfile = computed(() => {
    const u = this.appUser();
    const missing: string[] = [];
    if (!u?.phoneNumber) missing.push('telefone');
    if (!u?.cpf) missing.push('CPF');
    return missing;
  });

  readonly orderShortcuts = computed<OrderShortcut[]>(() => {
    const counts = this.countStages(this.orders());
    const count = (tab: OrderStage) => (COUNTED_TABS.includes(tab) ? counts?.[tab] ?? 0 : 0);
    return [
      { tab: 'pay', label: 'A pagar', icon: 'wallet', count: count('pay') },
      { tab: 'preparing', label: 'Preparando', icon: 'box', count: count('preparing') },
      { tab: 'shipping', label: 'A caminho', icon: 'truck', count: count('shipping') },
      { tab: 'done', label: 'Entregues', icon: 'check', count: count('done') },
    ];
  });

  /**
   * Pedido em destaque: primeiro o que espera pagamento, depois o que está a
   * caminho, depois o que a loja prepara; sem nenhum andando, o mais recente.
   */
  readonly featuredOrder = computed<FeaturedOrder | null>(() => {
    const orders = this.orders();
    if (!orders?.length) return null;
    const newest = [...orders].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
    const pick = (['pay', 'shipping', 'preparing'] as OrderStage[])
      .map(stage => newest.find(order => orderStage(order) === stage))
      .find(Boolean) ?? newest[0];

    const stage = orderStage(pick);
    const first = pick.items?.[0]?.productData;
    const others = itemCount(pick) - (pick.items?.[0]?.quantity || 0);
    const eta = deliveryWindow(pick);
    const arrives = eta ? `Chega entre ${formatDay(eta.from)} e ${formatDay(eta.to)}` : null;
    const due = paymentDueDate(pick);

    let hint: string;
    switch (stage) {
      case 'pay': hint = this.dueHint(due); break;
      case 'preparing': hint = arrives ?? 'A loja está preparando o envio'; break;
      case 'shipping': hint = arrives ?? 'Já saiu da loja'; break;
      default: hint = `Pedido de ${formatDay(toDate(pick.createdAt), true)}`;
    }

    return {
      tab: stage,
      stage: stage === 'pay' ? 'A pagar' : STAGE_LABEL[stage],
      title: first?.name || 'Pedido',
      more: others > 0 ? (others === 1 ? '+ 1 item' : `+ ${others} itens`) : null,
      photo: first?.photoURL?.[0] || null,
      total: formatBRL(pick.total),
      hint,
      urgent: stage === 'pay',
    };
  });

  /** Quantos pedidos estão andando (pagar, preparar, a caminho). */
  readonly activeOrders = computed(() => {
    const counts = this.countStages(this.orders());
    return counts ? counts.pay + counts.preparing + counts.shipping : 0;
  });

  readonly refundCount = computed(() => this.countStages(this.orders())?.refund ?? 0);

  readonly sellerStops = computed<RouteStop[]>(() => {
    const counts = this.countStages(this.sales());
    return [
      { tab: 'preparing', label: 'A enviar', count: counts?.preparing ?? null },
      { tab: 'shipping', label: 'Enviadas', count: counts?.shipping ?? null },
      { tab: 'done', label: 'Entregues', count: counts?.done ?? null },
    ];
  });

  /**
   * Quem já anunciou (ou já vendeu) vê a loja; quem só compra vê o convite para
   * vender o primeiro produto. Enquanto não dá para saber, nenhum dos dois —
   * senão o convite pisca na tela de quem já vende.
   */
  readonly storeState = computed<'loading' | 'seller' | 'newcomer'>(() => {
    const products = this.productCount();
    const sales = this.sales();
    if ((products ?? 0) > 0 || (sales?.length ?? 0) > 0) return 'seller';
    if (products === null || (sales === null && !this.salesFailed())) return 'loading';
    return 'newcomer';
  });

  readonly monthLabel = MONTHS_LONG[new Date().getMonth()];

  /** Vendas pagas no mês corrente, só os itens desta loja (sem frete). */
  readonly monthSales = computed(() => {
    const sales = this.sales();
    const uid = this.user()?.uid;
    if (!sales || !uid) return null;
    const now = new Date();
    const inMonth = sales.filter(order => {
      const stage = orderStage(order);
      if (!isPaid(order) || stage === 'refund' || stage === 'cancelled') return false;
      const date = toDate(order.paymentConfirmedAt) ?? toDate(order.createdAt);
      return !!date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
    return {
      count: inMonth.length,
      total: formatBRL(inMonth.reduce((sum, order) => sum + sellerAmount(order, uid), 0)),
    };
  });

  readonly defaultAddress = computed(() => {
    const list = this.addresses();
    const main = list.find(a => a.isDefault) || list[0];
    return main ? `${main.street}, ${main.number} · ${main.city}/${main.state}` : null;
  });

  readonly shoppingRows = computed<AccountRow[]>(() => [
    { icon: 'history', label: 'Histórico de compras', hint: 'Tudo o que você já comprou', link: '/purchase-history' },
    {
      icon: 'returns', label: 'Devoluções e reembolsos', hint: 'Acompanhe pedidos devolvidos',
      link: '/my-orders', query: { aba: 'refund' }, badge: this.refundCount(),
    },
    { icon: 'star', label: 'Minhas avaliações', hint: 'Notas que você deu aos produtos' },
    { icon: 'question', label: 'Perguntas aos vendedores', hint: 'Dúvidas que você enviou' },
    { icon: 'ticket', label: 'Cupons', hint: 'Descontos disponíveis para você' },
  ]);

  readonly storeRows = computed<AccountRow[]>(() => [
    {
      icon: 'tag', label: 'Meus anúncios', link: '/my-products',
      hint: this.productCount() === null ? undefined : this.plural(this.productCount()!, 'anúncio', 'anúncios'),
    },
    { icon: 'chart', label: 'Vendas', hint: 'Pedidos, etiquetas e envios', link: '/my-sales' },
    { icon: 'receipt', label: 'Notas fiscais', hint: 'Notas mensais da Vineon', link: '/my-invoices', badge: this.unseenInvoices() },
    { icon: 'store', label: 'Perfil de vendedor', hint: 'Nome da loja, foto e descrição', link: '/seller-profile' },
  ]);

  readonly accountRows = computed<AccountRow[]>(() => {
    const missing = this.missingProfile();
    const rows: AccountRow[] = [
      {
        icon: 'account', label: 'Dados pessoais', action: 'editor',
        hint: missing.length ? `Falta ${missing.join(' e ')}` : 'Nome, telefone e CPF', alert: missing.length > 0,
      },
      { icon: 'pin', label: 'Endereços', hint: this.defaultAddress() ?? 'Cadastre onde receber seus pedidos', link: '/address' },
      { icon: 'card', label: 'Formas de pagamento', hint: 'Pix, boleto e cartões', link: '/payments' },
      { icon: 'lock', label: 'Senha e segurança', hint: 'Troque sua senha de acesso', action: 'security' },
      { icon: 'bell', label: 'Notificações', hint: 'Avisos de pedidos e mensagens', link: '/tabs/notifications', badge: this.unreadNotifications() },
      { icon: 'privacy', label: 'Privacidade e dados', hint: 'O que a Vineon guarda sobre você' },
    ];
    if (this.isAdmin()) rows.push({ icon: 'grid', label: 'Painel de gestão', hint: 'Área administrativa', link: '/admin' });
    return rows;
  });

  readonly helpRows: AccountRow[] = [
    { icon: 'help', label: 'Central de ajuda', hint: 'Respostas para as dúvidas mais comuns' },
    { icon: 'chat', label: 'Fale com a Vineon', hint: 'Atendimento para compras e vendas' },
    { icon: 'doc', label: 'Termos e políticas', hint: 'Termos de uso, privacidade e devolução' },
  ];

  /** Quanto do cadastro está preenchido (lido do formulário, muda enquanto a pessoa digita). */
  get profileCompletion(): number {
    const f = this.profileForm;
    const filled = [f.displayName, f.username, f.email, f.phoneNumber, f.cpf].filter(v => v && v.trim()).length;
    return Math.round((filled / 5) * 100);
  }

  /** Conta criada com e-mail e senha? Quem entra só pelo Google não tem senha aqui. */
  readonly hasPassword = computed(() => !!this.user()?.providerData.some(p => p.providerId === 'password'));

  constructor() {
    const destroyRef = inject(DestroyRef);
    const stopAuth = onAuthUserChanged(user => this.bindUser(user));
    destroyRef.onDestroy(() => {
      stopAuth();
      this.unbindData();
    });
  }

  /** Volta de "Notas fiscais": o selo reflete o que a loja já abriu. */
  ionViewWillEnter() {
    const uid = this.user()?.uid;
    if (uid) void this.countUnseenInvoices(uid);
  }

  // ----------------------------------------------------------------- dados

  private bindUser(user: User | null) {
    const previous = this.user()?.uid;
    this.user.set(user);
    if (user?.uid === previous) return;

    this.unbindData();
    this.appUser.set(null);
    this.orders.set(null);
    this.sales.set(null);
    this.productCount.set(null);
    this.ordersFailed.set(false);
    this.salesFailed.set(false);
    this.isAdmin.set(false);
    if (!user) return;

    void this.loadProfile(user);
    void this.countUnseenInvoices(user.uid);
    isCurrentUserAdmin().then(isAdmin => this.isAdmin.set(isAdmin));

    this.dataSubs = [
      this.ordersService.getUserOrders(user.uid).subscribe({
        next: orders => this.orders.set(orders),
        error: err => {
          console.error('Minha conta: falha ao ler pedidos', err);
          this.ordersFailed.set(true);
        },
      }),
      this.salesService.getSellerSales(user.uid).subscribe({
        next: sales => this.sales.set(sales),
        error: err => {
          console.error('Minha conta: falha ao ler vendas', err);
          this.salesFailed.set(true);
        },
      }),
      this.fbProducts.getBySeller(user.uid, true).subscribe({
        next: products => this.productCount.set(products.length),
        error: () => this.productCount.set(0),
      }),
    ];
  }

  private unbindData() {
    this.dataSubs.forEach(sub => sub.unsubscribe());
    this.dataSubs = [];
  }

  private async loadProfile(user: User) {
    const appUser = await this.usersService.getUserById(user.uid);
    this.appUser.set(appUser);
    this.profileForm = {
      displayName: appUser?.displayName || user.displayName || '',
      username: appUser?.username || this.defaultUsername(user),
      email: appUser?.email || user.email || '',
      phoneNumber: appUser?.phoneNumber || user.phoneNumber || '',
      cpf: appUser?.cpf || '',
    };
  }

  private async countUnseenInvoices(uid: string) {
    try {
      const snap = await getDocs(query(collection(getFirestore(getApp()), 'sellerInvoices'), where('sellerId', '==', uid)));
      this.unseenInvoices.set(snap.docs.filter(d => !d.get('seenAt')).length);
    } catch {
      this.unseenInvoices.set(0);
    }
  }

  /** "Vence hoje", "Pague até 30 set" ou "Venceu em 25 set". */
  private dueHint(due: Date | null): string {
    if (!due) return 'Falta pagar para a loja enviar';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(due);
    day.setHours(0, 0, 0, 0);
    if (day.getTime() === today.getTime()) return 'Vence hoje';
    return day < today ? `Venceu em ${formatDay(due)}` : `Pague até ${formatDay(due)}`;
  }

  private countStages(orders: Order[] | null): Record<OrderStage, number> | null {
    if (!orders) return null;
    const counts: Record<OrderStage, number> = { pay: 0, preparing: 0, shipping: 0, done: 0, refund: 0, cancelled: 0 };
    for (const order of orders) counts[orderStage(order)]++;
    return counts;
  }

  private defaultUsername(user: User): string {
    const source = user.email?.split('@')[0] || user.displayName || '';
    return source.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '.').toLowerCase();
  }

  private plural(n: number, one: string, many: string) {
    return `${n} ${n === 1 ? one : many}`;
  }

  // ---------------------------------------------------------------- ações

  onRow(row: AccountRow) {
    if (row.action === 'editor') this.openEditor();
    else if (row.action === 'security') this.openEditor(true);
  }

  openEditor(focusSecurity = false) {
    this.view.set('editor');
    this.passwordOpen.set(focusSecurity);
    if (focusSecurity) {
      setTimeout(() => document.getElementById('acc-security')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    }
  }

  closeEditor() {
    this.view.set('overview');
  }

  async onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const user = this.user();
    if (!file || !user) return;

    this.isSavingProfile.set(true);
    try {
      const photoURL = await this.usersService.uploadProfilePhoto(user.uid, file);
      await this.usersService.updateCurrentUserProfile({ photoURL });
      await user.reload();
      this.user.set(this.fbProducts.getUser());
      await this.loadProfile(user);
      await this.toast('Foto de perfil atualizada.');
    } catch (error) {
      console.error(error);
      await this.toast('Não foi possível trocar a foto. Tente uma imagem JPG ou PNG menor.', 'danger');
    } finally {
      this.isSavingProfile.set(false);
    }
  }

  async saveProfile() {
    const user = this.user();
    if (!user || this.isSavingProfile()) return;

    const displayName = this.profileForm.displayName.trim();
    if (!displayName) {
      await this.toast('Informe seu nome completo.', 'warning');
      return;
    }

    this.isSavingProfile.set(true);
    try {
      await this.usersService.updateCurrentUserProfile({
        displayName,
        username: this.profileForm.username.trim() || null,
        phoneNumber: this.profileForm.phoneNumber.trim() || null,
        cpf: this.profileForm.cpf.trim() || null,
      });
      await user.reload();
      this.user.set(this.fbProducts.getUser());
      await this.loadProfile(user);
      this.view.set('overview');
      await this.toast('Dados pessoais salvos.');
    } catch (error) {
      console.error(error);
      await this.toast('Não foi possível salvar seus dados. Confira a conexão e tente de novo.', 'danger');
    } finally {
      this.isSavingProfile.set(false);
    }
  }

  async changePassword() {
    if (this.isChangingPassword()) return;
    const currentPassword = this.passwordForm.currentPassword.trim();
    const newPassword = this.passwordForm.newPassword.trim();
    const confirmPassword = this.passwordForm.confirmPassword.trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      await this.toast('Preencha a senha atual, a nova senha e a confirmação.', 'warning');
      return;
    }
    if (newPassword.length < 6) {
      await this.toast('A nova senha precisa ter pelo menos 6 caracteres.', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      await this.toast('A confirmação não é igual à nova senha.', 'warning');
      return;
    }

    this.isChangingPassword.set(true);
    try {
      await this.usersService.changeCurrentUserPassword(currentPassword, newPassword);
      this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
      this.passwordOpen.set(false);
      await this.toast('Senha trocada.');
    } catch (error) {
      console.error(error);
      await this.toast(this.passwordError(error), 'danger');
    } finally {
      this.isChangingPassword.set(false);
    }
  }

  private passwordError(error: unknown): string {
    const text = JSON.stringify(error);
    if (text.includes('auth/wrong-password') || text.includes('auth/invalid-credential')) return 'A senha atual está incorreta.';
    if (text.includes('auth/weak-password')) return 'A nova senha é fraca. Use pelo menos 6 caracteres.';
    if (text.includes('auth/requires-recent-login')) return 'Por segurança, saia e entre de novo antes de trocar a senha.';
    if (text.includes('auth/operation-not-allowed')) return 'Esta conta não usa senha. Entre pelo Google.';
    return 'Não foi possível trocar a senha.';
  }

  async soon(label: string) {
    await this.toast(`${label} chega em breve.`, 'medium');
  }

  logout() {
    this.fbProducts.signOut();
    this.router.navigate(['/login']);
  }

  private async toast(message: string, color: 'success' | 'danger' | 'warning' | 'medium' = 'success') {
    const toast = await this.toastCtrl.create({ message, color, duration: 2600, position: 'top' });
    await toast.present();
  }
}
