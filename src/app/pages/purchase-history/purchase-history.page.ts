import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { IonicModule, NavController, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, arrowBack, bagHandleOutline, chevronForward, closeOutline, downloadOutline,
  pricetagOutline, receiptOutline, refreshOutline, storefrontOutline,
} from 'ionicons/icons';

import { waitForAuthUser } from 'src/app/core/auth-state';
import {
  MONTHS_LONG, MONTHS_SHORT, OrderStage, formatDay, isPaid, itemCount, listUnitPrice, orderStage,
  paidUnitPrice, toDate,
} from 'src/app/core/order-stage';
import { Order } from 'src/app/interfaces/order';
import { OrdersService } from 'src/app/services/orders.service';
import { SellerDirectoryService } from 'src/app/services/seller-directory.service';

type Period = 'month' | '3m' | '12m' | 'all';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'month', label: 'Este mês' },
  { id: '3m', label: '3 meses' },
  { id: '12m', label: '12 meses' },
  { id: 'all', label: 'Tudo' },
];

const PAYMENT_LABEL: Record<Order['paymentMethod'], string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão',
};

/** Uma compra no extrato. Estornada aparece, mas não soma no gasto. */
interface Entry {
  id: string;
  shortId: string;
  date: Date;
  dateLabel: string;
  title: string;
  extra: number;
  photo: string;
  sellerIds: string[];
  method: string;
  amount: number;
  saved: number;
  refunded: boolean;
  stage: OrderStage;
}

interface MonthBar {
  key: string;
  label: string;
  long: string;
  total: number;
  count: number;
  height: number;
  inPeriod: boolean;
}

@Component({
  selector: 'app-purchase-history',
  templateUrl: './purchase-history.page.html',
  styleUrls: ['./purchase-history.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class PurchaseHistoryPage {
  private readonly ordersService = inject(OrdersService);
  private readonly sellers = inject(SellerDirectoryService);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly toastCtrl = inject(ToastController);

  readonly periods = PERIODS;
  readonly isLoading = signal(true);
  readonly loadError = signal(false);
  readonly orders = signal<Order[]>([]);
  readonly period = signal<Period>('12m');
  /** Mês escolhido no gráfico ("2026-09"); sobrepõe o período. */
  readonly month = signal<string | null>(null);
  readonly hovered = signal<string | null>(null);

  /** Pedidos pagos (e estornados) viram lançamentos; pendente e cancelado não são compra. */
  readonly entries = computed<Entry[]>(() =>
    this.orders()
      .filter(o => isPaid(o) || o.status === 'REFUNDED')
      .map(o => this.toEntry(o))
      .filter((e): e is Entry => !!e)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
  );

  readonly filtered = computed(() => {
    const month = this.month();
    if (month) return this.entries().filter(e => monthKey(e.date) === month);
    const start = periodStart(this.period());
    return start ? this.entries().filter(e => e.date >= start) : this.entries();
  });

  readonly totals = computed(() => {
    const counted = this.filtered().filter(e => !e.refunded);
    const spent = counted.reduce((s, e) => s + e.amount, 0);
    return {
      spent,
      count: counted.length,
      saved: counted.reduce((s, e) => s + e.saved, 0),
      average: counted.length ? spent / counted.length : 0,
    };
  });

  /** Últimos 12 meses, sempre — o período só destaca as barras que entram no filtro. */
  readonly bars = computed<MonthBar[]>(() => {
    const now = new Date();
    const start = periodStart(this.period());
    const selected = this.month();
    const months: MonthBar[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      months.push({
        key,
        label: MONTHS_SHORT[d.getMonth()],
        long: `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`,
        total: 0,
        count: 0,
        height: 0,
        inPeriod: selected ? key === selected : !start || d >= new Date(start.getFullYear(), start.getMonth(), 1),
      });
    }
    const byKey = new Map(months.map(m => [m.key, m]));
    for (const e of this.entries()) {
      if (e.refunded) continue;
      const m = byKey.get(monthKey(e.date));
      if (m) {
        m.total += e.amount;
        m.count++;
      }
    }
    const max = Math.max(...months.map(m => m.total), 0);
    for (const m of months) m.height = max ? Math.max(m.total ? 4 : 0, (m.total / max) * 100) : 0;
    return months;
  });

  readonly peak = computed(() => this.bars().reduce((a, b) => (b.total > a.total ? b : a), this.bars()[0]));

  readonly groups = computed(() => {
    const groups: { key: string; label: string; total: number; entries: Entry[] }[] = [];
    for (const e of this.filtered()) {
      const key = monthKey(e.date);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: `${MONTHS_LONG[e.date.getMonth()]} ${e.date.getFullYear()}`, total: 0, entries: [] };
        groups.push(g);
      }
      g.entries.push(e);
      if (!e.refunded) g.total += e.amount;
    }
    return groups;
  });

  readonly topStores = computed(() => {
    const byStore = new Map<string, { total: number; count: number }>();
    for (const e of this.filtered()) {
      if (e.refunded || e.sellerIds.length !== 1) continue;
      const cur = byStore.get(e.sellerIds[0]) ?? { total: 0, count: 0 };
      cur.total += e.amount;
      cur.count++;
      byStore.set(e.sellerIds[0], cur);
    }
    const list = [...byStore.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 3);
    const max = list[0]?.[1].total ?? 0;
    return list.map(([id, v]) => ({ id, ...v, share: max ? (v.total / max) * 100 : 0 }));
  });

  readonly selectedMonthLabel = computed(() => {
    const key = this.month();
    return key ? this.bars().find(b => b.key === key)?.long ?? null : null;
  });

  private stop?: () => void;

  constructor() {
    addIcons({
      alertCircleOutline, arrowBack, bagHandleOutline, chevronForward, closeOutline, downloadOutline,
      pricetagOutline, receiptOutline, refreshOutline, storefrontOutline,
    });
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
    const sub = this.ordersService.getUserOrders(user.uid).subscribe({
      next: orders => {
        this.orders.set(orders);
        this.isLoading.set(false);
        void this.sellers.ensure(orders.flatMap(o => o.sellerIds || []));
      },
      error: err => {
        console.error('Falha ao carregar histórico', err);
        this.loadError.set(true);
        this.isLoading.set(false);
      },
    });
    this.stop = () => sub.unsubscribe();
  }

  private toEntry(order: Order): Entry | null {
    const date = toDate(order.paymentConfirmedAt) ?? toDate(order.createdAt);
    if (!date) return null;
    const items = order.items || [];
    const first = items[0];
    const refunded = order.status === 'REFUNDED' || order.refundInfo?.status === 'COMPLETED';
    return {
      id: order.id || '',
      shortId: (order.id || '').substring(0, 8).toUpperCase(),
      date,
      dateLabel: formatDay(date),
      title: first?.productData?.name || 'Compra',
      extra: Math.max(0, itemCount(order) - (first?.quantity || 1)),
      photo: first?.productData?.photoURL?.[0] || 'assets/imagens/placeholder.png',
      sellerIds: (order.sellerIds || []).filter(s => s && s !== 'unknown'),
      method: PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod,
      amount: order.total || 0,
      saved: items.reduce((s, i) => {
        const list = listUnitPrice(i);
        return s + (list ? (list - paidUnitPrice(i)) * (i.quantity || 0) : 0);
      }, 0),
      refunded,
      stage: orderStage(order),
    };
  }

  storeName(e: Entry | { sellerIds: string[] }): string {
    if (e.sellerIds.length > 1) return `${e.sellerIds.length} lojas`;
    return this.sellers.name(e.sellerIds[0]);
  }

  sellerName(id: string): string {
    return this.sellers.name(id);
  }

  // ------------------------------------------------------------------- UI

  setPeriod(p: Period) {
    this.period.set(p);
    this.month.set(null);
  }

  pickMonth(bar: MonthBar) {
    if (!bar.count) return;
    this.month.set(this.month() === bar.key ? null : bar.key);
  }

  clearMonth() {
    this.month.set(null);
  }

  openOrder(e: Entry) {
    this.router.navigate(['/my-orders'], { queryParams: { aba: e.refunded ? 'refund' : e.stage } });
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }

  /** Extrato em CSV (separador ";" e BOM, que é como o Excel em pt-BR abre certo). */
  exportCsv() {
    const rows = this.filtered();
    if (!rows.length) return;
    const header = ['Data', 'Pedido', 'Loja', 'Produto', 'Itens', 'Pagamento', 'Situação', 'Valor (R$)'];
    const lines = rows.map(e => [
      e.date.toLocaleDateString('pt-BR'),
      e.shortId,
      this.storeName(e),
      e.title,
      String(e.extra + 1),
      e.method,
      e.refunded ? 'Estornado' : 'Pago',
      e.amount.toFixed(2).replace('.', ','),
    ]);
    const csv = [header, ...lines].map(cols => cols.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vineon-compras-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    void this.toastCtrl.create({ message: 'Extrato baixado.', duration: 2500, color: 'dark' }).then(t => t.present());
  }
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodStart(p: Period): Date | null {
  const now = new Date();
  switch (p) {
    case 'month': return new Date(now.getFullYear(), now.getMonth(), 1);
    case '3m': return new Date(now.getFullYear(), now.getMonth() - 2, 1);
    case '12m': return new Date(now.getFullYear(), now.getMonth() - 11, 1);
    default: return null;
  }
}

function csvCell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
