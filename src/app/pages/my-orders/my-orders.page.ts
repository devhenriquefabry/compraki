import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  IonicModule,
  LoadingController,
  NavController,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  arrowBack,
  bagHandleOutline,
  chatbubblesOutline,
  checkmarkCircle,
  chevronDown,
  chevronForward,
  closeCircle,
  copyOutline,
  cubeOutline,
  receiptOutline,
  refreshOutline,
  searchOutline,
  shieldHalfOutline,
  star,
  storefrontOutline,
  timeOutline,
} from 'ionicons/icons';
import { serverTimestamp } from 'firebase/firestore';

import { waitForAuthUser } from 'src/app/core/auth-state';
import { Order } from 'src/app/interfaces/order';
import { PublicSellerProfile } from 'src/app/interfaces/seller';
import { AsaasService } from 'src/app/services/asaas.service';
import { CoraService } from 'src/app/services/cora.service';
import { FirebaseChatService } from 'src/app/services/firebase-chat.service';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { OrdersService } from 'src/app/services/orders.service';
import { RefundsService } from 'src/app/services/refunds.service';
import { SalesService } from 'src/app/services/sales.service';
import { OrderTimelineComponent } from 'src/app/components/order-timeline/order-timeline.component';
import {
  COUNTED_TABS,
  ORDER_TABS,
  OrderStage,
  OrderTab,
  REFUND_LABEL,
  STAGE_LABEL,
  TRACK_STEPS,
  canRequestRefund,
  deliveryWindow,
  itemCount,
  listUnitPrice,
  orderStage,
  paidUnitPrice,
  paymentDueDate,
  productIdOf,
  toDate,
  trackIndex,
  trackingUrl,
} from './order-stage';

/** Quantos produtos o card mostra antes do "ver mais". */
const COLLAPSED_ITEMS = 2;

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const PAYMENT_LABEL: Record<Order['paymentMethod'], string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão de crédito',
};

interface ItemView {
  key: string;
  productId: string | null;
  name: string;
  photo: string;
  variant: string | null;
  quantity: number;
  price: number;
  listPrice: number | null;
}

/** Tudo que o card precisa, calculado uma vez por emissão da lista. */
interface OrderView {
  id: string;
  shortId: string;
  order: Order;
  stage: OrderStage;
  statusLabel: string;
  sellerIds: string[];
  items: ItemView[];
  count: number;
  track: number;
  placedAt: string;
  window: string | null;
  due: { label: string; overdue: boolean } | null;
  trackingCode: string | null;
  refundable: boolean;
  searchText: string;
}

@Component({
  selector: 'app-my-orders',
  templateUrl: './my-orders.page.html',
  styleUrls: ['./my-orders.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, OrderTimelineComponent],
})
export class MyOrdersPage {
  private readonly ordersService = inject(OrdersService);
  private readonly refundsService = inject(RefundsService);
  private readonly salesService = inject(SalesService);
  private readonly usersService = inject(FirebaseUsersService);
  private readonly chatService = inject(FirebaseChatService);
  private readonly asaasService = inject(AsaasService);
  private readonly coraService = inject(CoraService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly navCtrl = inject(NavController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);

  readonly tabs = ORDER_TABS;
  readonly trackSteps = TRACK_STEPS;
  readonly paymentLabel = PAYMENT_LABEL;
  readonly refundLabel = REFUND_LABEL;
  readonly collapsedItems = COLLAPSED_ITEMS;
  readonly skeletons = [0, 1, 2];

  readonly isLoading = signal(true);
  readonly loadError = signal(false);
  readonly orders = signal<Order[]>([]);
  readonly sellers = signal<Record<string, PublicSellerProfile | null>>({});
  readonly tab = signal<OrderTab>('all');
  readonly searchOpen = signal(false);
  readonly search = signal('');
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  /** Pedidos com a linha do tempo completa aberta. */
  readonly openTimelines = signal<ReadonlySet<string>>(new Set());

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly tabStrip = viewChild<ElementRef<HTMLElement>>('tabStrip');

  readonly views = computed<OrderView[]>(() => this.orders().map(order => this.toView(order)));

  readonly counts = computed(() => {
    const counts: Record<OrderTab, number> = {
      all: 0, pay: 0, preparing: 0, shipping: 0, done: 0, refund: 0, cancelled: 0,
    };
    for (const view of this.views()) {
      counts.all++;
      counts[view.stage]++;
    }
    return counts;
  });

  readonly visible = computed(() => {
    const tab = this.tab();
    const term = normalize(this.search().trim());
    return this.views().filter(view =>
      (tab === 'all' || view.stage === tab) && (!term || view.searchText.includes(term))
    );
  });

  // Modal de devolução
  isRefundModalOpen = false;
  refundOrder: Order | null = null;
  refundReason = '';

  private stopOrders?: () => void;

  constructor() {
    addIcons({
      alertCircleOutline, arrowBack, bagHandleOutline, chatbubblesOutline, checkmarkCircle, chevronDown,
      chevronForward, closeCircle, copyOutline, cubeOutline, receiptOutline, refreshOutline, searchOutline,
      shieldHalfOutline, star, storefrontOutline, timeOutline,
    });

    const initialTab = this.route.snapshot.queryParamMap.get('aba') as OrderTab | null;
    if (initialTab && ORDER_TABS.some(t => t.id === initialTab)) this.tab.set(initialTab);

    inject(DestroyRef).onDestroy(() => this.stopOrders?.());
    void this.load();
  }

  // ------------------------------------------------------------------ dados

  async load() {
    this.stopOrders?.();
    this.isLoading.set(true);
    this.loadError.set(false);

    const user = await waitForAuthUser();
    if (!user) {
      this.isLoading.set(false);
      return;
    }

    const sub = this.ordersService.getUserOrders(user.uid).subscribe({
      next: orders => {
        this.orders.set(orders);
        this.isLoading.set(false);
        void this.loadSellers(orders);
      },
      error: err => {
        console.error('Falha ao carregar compras', err);
        this.loadError.set(true);
        this.isLoading.set(false);
      },
    });
    this.stopOrders = () => sub.unsubscribe();
  }

  /** Nome e foto das lojas, lidos uma vez por vendedor de `sellers/` (leitura pública). */
  private async loadSellers(orders: Order[]) {
    const known = this.sellers();
    const missing = [...new Set(orders.flatMap(o => o.sellerIds || []))]
      .filter(id => id && id !== 'unknown' && !(id in known));
    if (!missing.length) return;

    const entries = await Promise.all(
      missing.map(async id => [id, await this.usersService.getPublicSellerProfile(id).catch(() => null)] as const)
    );
    this.sellers.update(current => ({ ...current, ...Object.fromEntries(entries) }));
  }

  private toView(order: Order): OrderView {
    const stage = orderStage(order);
    const id = order.id || '';
    const items: ItemView[] = (order.items || []).map((item, index) => ({
      key: `${productIdOf(item) ?? index}:${item.skuId ?? ''}:${index}`,
      productId: productIdOf(item),
      name: item.productData?.name || 'Produto',
      photo: item.productData?.photoURL?.[0] || 'assets/imagens/placeholder.png',
      variant: item.variantLabel || null,
      quantity: item.quantity || 1,
      price: paidUnitPrice(item),
      listPrice: listUnitPrice(item),
    }));

    const eta = deliveryWindow(order);
    const due = paymentDueDate(order);
    const refundStatus = order.refundInfo?.status;

    return {
      id,
      shortId: id.substring(0, 8).toUpperCase(),
      order,
      stage,
      statusLabel: stage === 'refund' && refundStatus ? REFUND_LABEL[refundStatus] : STAGE_LABEL[stage],
      sellerIds: (order.sellerIds || []).filter(s => s && s !== 'unknown'),
      items,
      count: itemCount(order),
      track: trackIndex(stage),
      placedAt: formatDay(toDate(order.createdAt), true),
      window: eta ? formatRange(eta.from, eta.to) : null,
      due: due ? { label: formatDay(due), overdue: due.getTime() < Date.now() } : null,
      trackingCode: order.shippingInfo?.trackingCode || null,
      refundable: canRequestRefund(order),
      searchText: normalize([id, ...items.map(i => i.name)].join(' ')),
    };
  }

  sellerName(view: OrderView): string {
    if (view.sellerIds.length > 1) return `${view.sellerIds.length} lojas`;
    const seller = this.sellers()[view.sellerIds[0]];
    return seller?.shopName || seller?.displayName || 'Loja Vineon';
  }

  sellerPhoto(view: OrderView): string | null {
    if (view.sellerIds.length !== 1) return null;
    return this.sellers()[view.sellerIds[0]]?.photoURL || null;
  }

  // ---------------------------------------------------------- navegação e UI

  selectTab(tab: OrderTab, event?: Event) {
    this.tab.set(tab);
    (event?.currentTarget as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  /** Setas esquerda/direita trocam de aba, como pede o padrão de tablist. */
  onTabKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = ORDER_TABS.findIndex(t => t.id === this.tab());
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + ORDER_TABS.length) % ORDER_TABS.length;
    this.tab.set(ORDER_TABS[next].id);
    const button = this.tabStrip()?.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]')[next];
    button?.focus();
    button?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  isCounted(tab: OrderTab) {
    return COUNTED_TABS.includes(tab);
  }

  toggleSearch() {
    const open = !this.searchOpen();
    this.searchOpen.set(open);
    if (open) setTimeout(() => this.searchInput()?.nativeElement.focus(), 60);
    else this.search.set('');
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }

  openChats() {
    this.router.navigate(['/tabs/chats']);
  }

  openStore(view: OrderView) {
    if (view.sellerIds.length !== 1) return;
    this.router.navigate(['/seller-profile', view.sellerIds[0]]);
  }

  openProduct(item: ItemView) {
    if (item.productId) this.router.navigate(['/product-details', item.productId]);
  }

  isExpanded(view: OrderView) {
    return this.expanded().has(view.id);
  }

  toggleItems(view: OrderView) {
    this.expanded.update(current => {
      const next = new Set(current);
      if (next.has(view.id)) next.delete(view.id);
      else next.add(view.id);
      return next;
    });
  }

  isTimelineOpen(view: OrderView) {
    return this.openTimelines().has(view.id);
  }

  toggleTimeline(view: OrderView) {
    this.openTimelines.update(current => {
      const next = new Set(current);
      if (next.has(view.id)) next.delete(view.id);
      else next.add(view.id);
      return next;
    });
  }

  emptyCopy(tab: OrderTab): { title: string; text: string } {
    switch (tab) {
      case 'pay': return { title: 'Nada para pagar', text: 'Compras com Pix ou boleto em aberto aparecem aqui até o pagamento cair.' };
      case 'preparing': return { title: 'Nenhum pedido em preparação', text: 'Assim que um pagamento é aprovado, o pedido vem para cá enquanto a loja embala.' };
      case 'shipping': return { title: 'Nenhuma entrega a caminho', text: 'Quando a loja postar seu pedido, você acompanha o trajeto por aqui.' };
      case 'done': return { title: 'Nenhuma compra entregue ainda', text: 'Depois da entrega, é aqui que você avalia e compra de novo.' };
      case 'refund': return { title: 'Nenhuma devolução', text: 'Pedidos com devolução solicitada aparecem aqui com o andamento.' };
      case 'cancelled': return { title: 'Nenhum pedido cancelado', text: 'Que bom. Nada por aqui.' };
      default: return { title: 'Você ainda não comprou nada', text: 'Suas compras aparecem aqui, com o andamento da entrega de cada uma.' };
    }
  }

  // ------------------------------------------------------------------ ações

  async pay(view: OrderView) {
    if (view.order.coraInvoiceId) return this.payCora(view);

    const paymentId = view.order.asaasPaymentId;
    if (!paymentId) {
      this.showToast('Não encontramos a cobrança deste pedido. Fale com a loja.', 'warning');
      return;
    }

    // A janela abre já no clique: navegador de celular bloqueia pop-up aberto
    // depois de um `await`.
    const tab = window.open('', '_blank');
    const loading = await this.loadingCtrl.create({ message: 'Abrindo cobrança...' });
    await loading.present();
    try {
      const payment = await this.asaasService.getPayment(paymentId) as { invoiceUrl?: string; status?: string };
      if (!payment?.invoiceUrl) throw new Error('sem invoiceUrl');
      if (tab) tab.location.href = payment.invoiceUrl;
      else window.location.href = payment.invoiceUrl;
    } catch (err) {
      console.error('Falha ao abrir cobrança', err);
      tab?.close();
      this.showToast('Não foi possível abrir a cobrança agora. Tente de novo em instantes.', 'danger');
    } finally {
      loading.dismiss();
    }
  }

  /** Cobrança do Cora: PIX volta para a tela do QR; boleto abre o PDF. */
  private async payCora(view: OrderView) {
    const order = view.order;

    if (order.paymentMethod === 'PIX') {
      this.router.navigate(['/pix-payment'], { queryParams: { orderId: view.id } });
      return;
    }

    // A janela abre já no clique: navegador de celular bloqueia pop-up aberto
    // depois de um `await`.
    const tab = window.open('', '_blank');
    try {
      const url = order.coraPayment?.bankSlipUrl
        || (await this.coraService.getCharge(order.coraInvoiceId!)).bankSlipUrl;
      if (!url) throw new Error('sem bankSlipUrl');
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      console.error('Falha ao abrir boleto', err);
      tab?.close();
      this.showToast('Não foi possível abrir o boleto agora. Tente de novo em instantes.', 'danger');
    }
  }

  trackOrder(view: OrderView) {
    if (!view.trackingCode) {
      this.showToast('A loja ainda não informou o código de rastreio.', 'dark');
      return;
    }
    window.open(trackingUrl(view.trackingCode), '_blank', 'noopener');
  }

  async copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.showToast(`${what} copiado.`, 'dark');
    } catch {
      this.showToast(`Não foi possível copiar o ${what.toLowerCase()}.`, 'warning');
    }
  }

  async confirmReceipt(view: OrderView) {
    const alert = await this.alertCtrl.create({
      header: 'Recebeu o pedido?',
      message: 'Confirme só se o produto chegou em suas mãos. Depois disso, a loja recebe o pagamento ao fim do prazo de devolução.',
      buttons: [
        { text: 'Ainda não', role: 'cancel' },
        { text: 'Recebi', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    try {
      await this.salesService.updateSaleData(view.id, {
        shipmentStatus: 'DELIVERED',
        deliveryConfirmedAt: serverTimestamp(),
      });
      this.showToast('Recebimento confirmado. Que tal avaliar a compra?', 'success');
      this.tab.set('done');
    } catch (err) {
      console.error('Falha ao confirmar recebimento', err);
      this.showToast('Não foi possível confirmar o recebimento. Tente de novo.', 'danger');
    }
  }

  async talkToStore(view: OrderView) {
    const sellerId = view.sellerIds.length === 1
      ? view.sellerIds[0]
      : await this.pickSeller(view);
    if (!sellerId) return;

    const seller = this.sellers()[sellerId];
    const item = view.order.items.find(i => i.productData?.sellerId === sellerId) ?? view.order.items[0];
    try {
      const chatId = await this.chatService.startChat(
        {
          uid: sellerId,
          name: seller?.shopName || seller?.displayName || 'Loja',
          photoUrl: seller?.photoURL || undefined,
        },
        item?.productData?.id
          ? { id: item.productData.id, name: item.productData.name, photo: item.productData.photoURL?.[0] }
          : undefined
      );
      this.router.navigate(['/chat-details', chatId]);
    } catch (err: any) {
      console.error('Falha ao abrir conversa', err);
      this.showToast(err?.message || 'Não foi possível abrir a conversa.', 'danger');
    }
  }

  async review(view: OrderView) {
    const productId = await this.pickProduct(view, 'Qual produto você quer avaliar?');
    if (productId) this.router.navigate(['/product-details', productId], { queryParams: { avaliar: 1 } });
  }

  async buyAgain(view: OrderView) {
    const productId = await this.pickProduct(view, 'Comprar de novo qual produto?');
    if (productId) this.router.navigate(['/product-details', productId]);
  }

  /** Um produto só vai direto; vários abrem a escolha. */
  private async pickProduct(view: OrderView, header: string): Promise<string | null> {
    const unique = new Map<string, string>();
    for (const item of view.items) if (item.productId && !unique.has(item.productId)) unique.set(item.productId, item.name);
    if (unique.size <= 1) return unique.keys().next().value ?? null;

    const sheet = await this.actionSheetCtrl.create({
      header,
      buttons: [
        ...[...unique].map(([id, name]) => ({ text: name, data: id })),
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
    const { data, role } = await sheet.onDidDismiss();
    return role === 'cancel' ? null : (data as string) ?? null;
  }

  private async pickSeller(view: OrderView): Promise<string | null> {
    const sheet = await this.actionSheetCtrl.create({
      header: 'Falar com qual loja?',
      buttons: [
        ...view.sellerIds.map(id => ({
          text: this.sellers()[id]?.shopName || this.sellers()[id]?.displayName || 'Loja',
          data: id,
        })),
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
    const { data, role } = await sheet.onDidDismiss();
    return role === 'cancel' ? null : (data as string) ?? null;
  }

  // ------------------------------------------------------------- devolução

  openRefundModal(view: OrderView) {
    this.refundOrder = view.order;
    this.refundReason = '';
    this.isRefundModalOpen = true;
  }

  closeRefundModal() {
    this.isRefundModalOpen = false;
    this.refundOrder = null;
    this.refundReason = '';
  }

  async submitRefundRequest() {
    if (!this.refundOrder?.id) return;
    if (this.refundReason.trim().length < 10) {
      this.showToast('Conte o motivo com pelo menos 10 caracteres.', 'warning');
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Enviando solicitação...' });
    await loading.present();

    try {
      const user = await waitForAuthUser();
      await this.refundsService.requestRefund(this.refundOrder.id, user?.uid || 'unknown', this.refundReason);
      this.showToast('Devolução solicitada. Acompanhe na aba Devoluções.', 'success');
      this.closeRefundModal();
    } catch (err) {
      console.error(err);
      this.showToast('Não foi possível enviar a solicitação. Tente de novo.', 'danger');
    } finally {
      loading.dismiss();
    }
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, color, position: 'bottom' });
    await toast.present();
  }
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function formatDay(date: Date | null, withYear = false): string {
  if (!date) return '';
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return withYear && date.getFullYear() !== new Date().getFullYear() ? `${base} ${date.getFullYear()}` : base;
}

function formatRange(from: Date, to: Date): string {
  if (from.getMonth() === to.getMonth()) return `${from.getDate()} – ${to.getDate()} ${MONTHS[to.getMonth()]}`;
  return `${formatDay(from)} – ${formatDay(to)}`;
}
