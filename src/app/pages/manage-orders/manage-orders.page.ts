import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronDownOutline, receiptOutline, refreshOutline, searchOutline } from 'ionicons/icons';

import { OrderTimelineComponent } from '../../components/order-timeline/order-timeline.component';
import {
  OrderStage, REFUND_LABEL, STAGE_LABEL, formatBRL, formatDay, itemCount, normalizeSearch, orderStage, paidUnitPrice,
  shipByDate, toDate,
} from '../../core/order-stage';
import { Order } from '../../interfaces/order';
import { FirebaseUsersService } from '../../services/firebase-users.service';
import { OrdersService } from '../../services/orders.service';

type Filter = 'all' | 'attention' | OrderStage;

interface OrderRow {
  id: string;
  shortId: string;
  order: Order;
  stage: OrderStage;
  stageLabel: string;
  placedAt: string;
  buyer: string;
  summary: string;
  count: number;
  total: string;
  method: string;
  alerts: { label: string; tone: 'warn' | 'danger' | 'info' }[];
  search: string;
}

const METHOD_LABEL: Record<Order['paymentMethod'], string> = { PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão' };

const STAGE_TONE: Record<OrderStage, string> = {
  pay: 'is-warn',
  preparing: 'is-info',
  shipping: 'is-info',
  done: 'is-ok',
  refund: 'is-danger',
  cancelled: '',
};

/**
 * Aba "Pedidos" do painel: todos os pedidos do app em tempo real, com a
 * mesma linha do tempo que o comprador vê. É o "onde está cada pedido" do
 * dono da loja — só leitura; ações de dinheiro continuam em Devoluções.
 */
@Component({
  selector: 'app-manage-orders',
  templateUrl: './manage-orders.page.html',
  styleUrls: ['./manage-orders.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, OrderTimelineComponent],
})
export class ManageOrdersPage {
  private readonly ordersService = inject(OrdersService);
  private readonly usersService = inject(FirebaseUsersService);

  readonly pageSize = 40;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly orders = signal<Order[]>([]);
  readonly filter = signal<Filter>('all');
  readonly search = signal('');
  readonly limit = signal(this.pageSize);
  readonly openId = signal<string | null>(null);
  /** Nome público das lojas, carregado sob demanda. */
  readonly sellerNames = signal<Record<string, string>>({});

  readonly formatBRL = formatBRL;
  readonly stageTone = STAGE_TONE;
  readonly methodLabel = METHOD_LABEL;

  readonly rows = computed<OrderRow[]>(() => this.orders().map(order => this.toRow(order)));

  readonly counts = computed(() => {
    const counts: Record<Filter, number> = { all: 0, attention: 0, pay: 0, preparing: 0, shipping: 0, done: 0, refund: 0, cancelled: 0 };
    for (const row of this.rows()) {
      counts.all++;
      counts[row.stage]++;
      if (row.alerts.length) counts.attention++;
    }
    return counts;
  });

  readonly filters = computed<{ id: Filter; label: string; alert?: boolean }[]>(() => [
    { id: 'all', label: 'Todos' },
    { id: 'attention', label: 'Precisam de atenção', alert: true },
    { id: 'pay', label: 'A pagar' },
    { id: 'preparing', label: 'Preparando' },
    { id: 'shipping', label: 'A caminho' },
    { id: 'done', label: 'Entregues' },
    { id: 'refund', label: 'Devoluções' },
    { id: 'cancelled', label: 'Cancelados' },
  ]);

  readonly stats = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let todayCount = 0;
    let todayRevenue = 0;
    for (const order of this.orders()) {
      const created = toDate(order.createdAt);
      if (created && created >= today) {
        todayCount++;
        if (order.status !== 'PENDING' && order.status !== 'CANCELLED') todayRevenue += order.total || 0;
      }
    }
    const c = this.counts();
    return { todayCount, todayRevenue: formatBRL(todayRevenue), toShip: c.preparing, onTheWay: c.shipping, attention: c.attention };
  });

  readonly filtered = computed(() => {
    const filter = this.filter();
    const term = normalizeSearch(this.search().trim());
    return this.rows().filter(row => {
      if (filter === 'attention' && !row.alerts.length) return false;
      if (filter !== 'all' && filter !== 'attention' && row.stage !== filter) return false;
      return !term || row.search.includes(term);
    });
  });

  readonly visible = computed(() => this.filtered().slice(0, this.limit()));

  private stop?: () => void;

  constructor() {
    addIcons({ chevronDownOutline, receiptOutline, refreshOutline, searchOutline });
    inject(DestroyRef).onDestroy(() => this.stop?.());
    this.listen();
  }

  listen() {
    this.stop?.();
    this.loading.set(true);
    this.error.set('');
    const sub = this.ordersService.watchAllOrders(500).subscribe({
      next: orders => {
        this.orders.set(orders);
        this.loading.set(false);
        void this.loadSellerNames(orders);
      },
      error: err => {
        console.error('Falha ao carregar pedidos', err);
        this.error.set('Não foi possível carregar os pedidos. Confira se sua conta tem acesso de administrador.');
        this.loading.set(false);
      },
    });
    this.stop = () => sub.unsubscribe();
  }

  setFilter(filter: Filter) {
    this.filter.set(filter);
    this.limit.set(this.pageSize);
  }

  onSearch(value: string) {
    this.search.set(value);
    this.limit.set(this.pageSize);
  }

  toggle(row: OrderRow) {
    this.openId.set(this.openId() === row.id ? null : row.id);
  }

  showMore() {
    this.limit.update(n => n + this.pageSize);
  }

  sellerName(uid: string): string {
    return this.sellerNames()[uid] || `Loja ${uid.slice(0, 6)}`;
  }

  itemsOf(order: Order) {
    return (order.items || []).map((item, i) => ({
      key: `${item.productId ?? i}:${i}`,
      name: item.productData?.name || 'Produto',
      photo: item.productData?.photoURL?.[0] || 'assets/imagens/placeholder.png',
      variant: item.variantLabel || null,
      quantity: item.quantity || 1,
      price: formatBRL(paidUnitPrice(item)),
      sellerId: item.productData?.sellerId || null,
    }));
  }

  /** Pedido antigo pode vir sem `customerData`. */
  customer(order: Order): Order['customerData'] {
    return order.customerData ?? { name: '', cpf: '', phone: '', email: '' };
  }

  addressOf(order: Order): string {
    const a = order.addressData;
    if (!a) return '';
    return `${a.street}, ${a.number}${a.complement ? ' – ' + a.complement : ''} · ${a.neighborhood ? a.neighborhood + ' · ' : ''}${a.city}/${a.state} · CEP ${a.postalCode}`;
  }

  private toRow(order: Order): OrderRow {
    const stage = orderStage(order);
    const items = order.items || [];
    const first = items[0]?.productData?.name || 'Produto';
    const buyer = order.customerData?.name || 'Comprador';
    const refundStatus = order.refundInfo?.status;

    return {
      id: order.id || '',
      shortId: (order.id || '').substring(0, 8).toUpperCase(),
      order,
      stage,
      stageLabel: stage === 'refund' && refundStatus ? REFUND_LABEL[refundStatus] : STAGE_LABEL[stage],
      placedAt: formatStamp(order.createdAt),
      buyer,
      summary: items.length > 1 ? `${first} +${items.length - 1}` : first,
      count: itemCount(order),
      total: formatBRL(order.total),
      method: METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod,
      alerts: alertsOf(order, stage),
      search: normalizeSearch([
        order.id, buyer, order.customerData?.email, order.customerData?.cpf,
        ...items.map(i => i.productData?.name), order.shippingInfo?.trackingCode,
      ].filter(Boolean).join(' ')),
    };
  }

  private async loadSellerNames(orders: Order[]) {
    const known = this.sellerNames();
    const missing = Array.from(new Set(orders.flatMap(o => o.sellerIds || []))).filter(uid => uid && !(uid in known));
    if (!missing.length) return;

    const entries = await Promise.all(missing.slice(0, 80).map(async uid => {
      try {
        const profile = await this.usersService.getPublicSellerProfile(uid);
        return [uid, profile?.shopName || profile?.displayName || ''] as const;
      } catch {
        return [uid, ''] as const;
      }
    }));
    this.sellerNames.update(current => {
      const next = { ...current };
      for (const [uid, name] of entries) next[uid] = name || `Loja ${uid.slice(0, 6)}`;
      return next;
    });
  }
}

function formatStamp(value: unknown): string {
  const date = toDate(value);
  if (!date) return '—';
  return `${formatDay(date, true)}, ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function alertsOf(order: Order, stage: OrderStage): OrderRow['alerts'] {
  const alerts: OrderRow['alerts'] = [];
  if (order.paymentAlert) alerts.push({ label: 'Valor pago divergente', tone: 'danger' });
  if (order.shipmentStatus === 'PROBLEM') alerts.push({ label: 'Problema na entrega', tone: 'danger' });
  if (order.refundInfo?.status === 'REQUESTED') alerts.push({ label: 'Devolução a analisar', tone: 'warn' });
  if (stage === 'preparing') {
    const shipBy = shipByDate(order);
    if (shipBy) {
      const end = new Date(shipBy);
      end.setHours(23, 59, 59, 999);
      if (end.getTime() < Date.now()) alerts.push({ label: 'Envio atrasado', tone: 'warn' });
    }
  }
  return alerts;
}
