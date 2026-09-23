import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertController, IonicModule, NavController, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, arrowBack, cashOutline, chevronForward, copyOutline, cubeOutline, locationOutline,
  pricetagsOutline, refreshOutline, searchOutline, shieldHalfOutline, timeOutline,
} from 'ionicons/icons';

import { waitForAuthUser } from 'src/app/core/auth-state';
import {
  OrderStage, SALE_STAGE_LABEL, SALE_TABS, SALE_TRACK_STEPS, SaleTab, REFUND_LABEL,
  formatDay, isPaid, listUnitPrice, normalizeSearch, orderStage, paidUnitPrice, productIdOf,
  sellerAmount, sellerItems, shipByDate, toDate, trackIndex, trackingUrl,
} from 'src/app/core/order-stage';
import { Order } from 'src/app/interfaces/order';
import { SalesService } from 'src/app/services/sales.service';

const COLLAPSED_ITEMS = 2;

interface SaleItemView {
  key: string;
  name: string;
  photo: string;
  variant: string | null;
  quantity: number;
  price: number;
  listPrice: number | null;
}

interface SaleView {
  id: string;
  shortId: string;
  order: Order;
  stage: OrderStage;
  statusLabel: string;
  buyer: string;
  initial: string;
  items: SaleItemView[];
  amount: number;
  track: number;
  placedAt: string;
  shipBy: { label: string; late: boolean } | null;
  destination: string | null;
  payout: string | null;
  trackingCode: string | null;
  searchText: string;
}

@Component({
  selector: 'app-my-sales',
  templateUrl: './my-sales.page.html',
  styleUrls: ['./my-sales.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule],
})
export class MySalesPage {
  private readonly salesService = inject(SalesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly navCtrl = inject(NavController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly tabs = SALE_TABS;
  readonly trackSteps = SALE_TRACK_STEPS;
  readonly collapsedItems = COLLAPSED_ITEMS;
  readonly skeletons = [0, 1, 2];

  readonly isLoading = signal(true);
  readonly loadError = signal(false);
  readonly sellerId = signal<string | null>(null);
  readonly orders = signal<Order[]>([]);
  readonly tab = signal<SaleTab>('all');
  readonly searchOpen = signal(false);
  readonly search = signal('');
  readonly expanded = signal<ReadonlySet<string>>(new Set());

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly tabStrip = viewChild<ElementRef<HTMLElement>>('tabStrip');

  readonly views = computed<SaleView[]>(() => {
    const seller = this.sellerId();
    return seller ? this.orders().map(order => this.toView(order, seller)) : [];
  });

  readonly counts = computed(() => {
    const counts: Record<SaleTab, number> = { all: 0, pay: 0, preparing: 0, shipping: 0, done: 0, refund: 0, cancelled: 0 };
    for (const v of this.views()) {
      counts.all++;
      counts[v.stage]++;
    }
    return counts;
  });

  /**
   * Resumo do topo. "Vendido no mês" soma pedidos pagos criados no mês corrente;
   * "A liberar" é o que está retido na garantia de 7 dias; "Liberado" já saiu
   * da retenção. Pedido com devolução não entra em nenhum dos dois.
   */
  readonly summary = computed(() => {
    const now = new Date();
    let month = 0;
    let held = 0;
    let released = 0;
    for (const v of this.views()) {
      if (!isPaid(v.order) || v.stage === 'refund') continue;
      const created = toDate(v.order.createdAt);
      if (created && created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear()) month += v.amount;
      if (v.order.escrowInfo?.status === 'RELEASED') released += v.amount;
      else held += v.amount;
    }
    return { month, held, released, monthName: formatMonth(now) };
  });

  readonly visible = computed(() => {
    const tab = this.tab();
    const term = normalizeSearch(this.search().trim());
    return this.views().filter(v => (tab === 'all' || v.stage === tab) && (!term || v.searchText.includes(term)));
  });

  private stop?: () => void;

  constructor() {
    addIcons({
      alertCircleOutline, arrowBack, cashOutline, chevronForward, copyOutline, cubeOutline, locationOutline,
      pricetagsOutline, refreshOutline, searchOutline, shieldHalfOutline, timeOutline,
    });
    const initial = this.route.snapshot.queryParamMap.get('aba') as SaleTab | null;
    if (initial && SALE_TABS.some(t => t.id === initial)) this.tab.set(initial);
    inject(DestroyRef).onDestroy(() => this.stop?.());
    void this.load();
  }

  async load() {
    this.stop?.();
    this.isLoading.set(true);
    this.loadError.set(false);

    const user = await waitForAuthUser();
    if (!user) {
      this.isLoading.set(false);
      return;
    }
    this.sellerId.set(user.uid);

    const sub = this.salesService.getSellerSales(user.uid).subscribe({
      next: orders => {
        this.orders.set(orders);
        this.isLoading.set(false);
      },
      error: err => {
        console.error('Falha ao carregar vendas', err);
        this.loadError.set(true);
        this.isLoading.set(false);
      },
    });
    this.stop = () => sub.unsubscribe();
  }

  private toView(order: Order, seller: string): SaleView {
    const stage = orderStage(order);
    const id = order.id || '';
    const mine = sellerItems(order, seller);
    const items = mine.map((item, index) => ({
      key: `${productIdOf(item) ?? index}:${item.skuId ?? ''}:${index}`,
      name: item.productData?.name || 'Produto',
      photo: item.productData?.photoURL?.[0] || 'assets/imagens/placeholder.png',
      variant: item.variantLabel || null,
      quantity: item.quantity || 1,
      price: paidUnitPrice(item),
      listPrice: listUnitPrice(item),
    }));

    const buyer = firstName(order.customerData?.name);
    const shipBy = stage === 'preparing' ? shipByDate(order) : null;
    const address = order.addressData;
    const release = toDate(order.escrowInfo?.releasedAt) ?? toDate(order.escrowInfo?.releaseDate);
    const refundStatus = order.refundInfo?.status;

    return {
      id,
      shortId: id.substring(0, 8).toUpperCase(),
      order,
      stage,
      statusLabel: stage === 'refund' && refundStatus ? REFUND_LABEL[refundStatus] : SALE_STAGE_LABEL[stage],
      buyer,
      initial: buyer.charAt(0).toUpperCase() || '?',
      items,
      amount: sellerAmount(order, seller),
      track: trackIndex(stage),
      placedAt: formatDay(toDate(order.createdAt), true),
      shipBy: shipBy ? { label: formatDay(shipBy), late: endOfDay(shipBy) < Date.now() } : null,
      destination: address?.city ? `${address.city}/${address.state}` : null,
      payout: release ? formatDay(release) : null,
      trackingCode: order.shippingInfo?.trackingCode || null,
      searchText: normalizeSearch([id, order.customerData?.name || '', ...items.map(i => i.name)].join(' ')),
    };
  }

  // ---------------------------------------------------------------- UI

  selectTab(tab: SaleTab, event?: Event) {
    this.tab.set(tab);
    (event?.currentTarget as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  onTabKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = SALE_TABS.findIndex(t => t.id === this.tab());
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + SALE_TABS.length) % SALE_TABS.length;
    this.tab.set(SALE_TABS[next].id);
    const button = this.tabStrip()?.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]')[next];
    button?.focus();
    button?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
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

  openListings() {
    this.router.navigate(['/my-products']);
  }

  openSale(view: SaleView) {
    this.router.navigate(['/sale-details', view.id]);
  }

  isExpanded(view: SaleView) {
    return this.expanded().has(view.id);
  }

  toggleItems(view: SaleView, event: Event) {
    event.stopPropagation();
    this.expanded.update(current => {
      const next = new Set(current);
      if (next.has(view.id)) next.delete(view.id);
      else next.add(view.id);
      return next;
    });
  }

  emptyCopy(tab: SaleTab): { title: string; text: string } {
    switch (tab) {
      case 'preparing': return { title: 'Nada para enviar', text: 'Quando um pagamento for aprovado, o pedido aparece aqui para você embalar e postar.' };
      case 'shipping': return { title: 'Nenhuma venda em trânsito', text: 'Pedidos que você marcou como enviados ficam aqui até o comprador receber.' };
      case 'done': return { title: 'Nenhuma entrega concluída', text: 'Vendas entregues aparecem aqui, com a data em que o valor é liberado.' };
      case 'pay': return { title: 'Nenhum pagamento pendente', text: 'Pedidos com Pix ou boleto em aberto aparecem aqui. Não envie antes do pagamento cair.' };
      case 'refund': return { title: 'Nenhuma devolução', text: 'Se um comprador pedir devolução, você acompanha por aqui.' };
      case 'cancelled': return { title: 'Nenhuma venda cancelada', text: 'Nada por aqui.' };
      default: return { title: 'Sua primeira venda está a caminho', text: 'Anúncios com boas fotos e descrição completa vendem mais rápido.' };
    }
  }

  // ------------------------------------------------------------- ações

  async markShipped(view: SaleView, event: Event) {
    event.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Marcar como enviada',
      message: 'Informe o código de rastreio para o comprador acompanhar a entrega. Você pode adicionar depois, se ainda não tiver.',
      inputs: [{ name: 'code', type: 'text', placeholder: 'Ex.: AN123456789BR', value: view.trackingCode ?? '' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Marcar como enviada', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    try {
      await this.salesService.markShipped(view.id, data?.values?.code);
      this.toast('Venda marcada como enviada. O comprador já vê "A caminho".', 'success');
    } catch (err) {
      console.error('Falha ao marcar envio', err);
      this.toast('Não foi possível marcar como enviada. Tente de novo.', 'danger');
    }
  }

  track(view: SaleView, event: Event) {
    event.stopPropagation();
    if (view.trackingCode) window.open(trackingUrl(view.trackingCode), '_blank', 'noopener');
  }

  async copy(text: string, what: string, event: Event) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      this.toast(`${what} copiado.`, 'dark');
    } catch {
      this.toast(`Não foi possível copiar o ${what.toLowerCase()}.`, 'warning');
    }
  }

  private async toast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 3000, color, position: 'bottom' });
    await t.present();
  }
}

function firstName(name: string | undefined): string {
  const first = (name || '').trim().split(/\s+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : 'Comprador';
}

function endOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString('pt-BR', { month: 'long' });
}
