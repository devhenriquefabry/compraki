import { Order } from '../interfaces/order';
import { Product } from '../interfaces/product';
import { CommissionConfig, feeFor, rateAt, roundCents } from './commission';
import {
  MONTHS_LONG, MONTHS_SHORT, OrderStage, formatDay, isPaid, orderStage, paidUnitPrice, productIdOf,
  sellerAmount, sellerItems, sellerShippingCost, shipByDate, toDate,
} from './order-stage';

/**
 * Contas do painel da loja (/seller-dashboard).
 *
 * Mesma base das outras telas de venda, para os números baterem:
 * - "Vendido" = itens desta loja em pedidos pagos, sem frete, menos o cupom
 *   da própria loja (`sellerAmount`), pela data do pagamento.
 * - Venda em devolução ou cancelada sai do vendido (igual a Minha conta) e
 *   entra só na contagem de devoluções.
 * - "Você recebe" = vendido − taxa em vigor no dia do pagamento − frete grátis
 *   que a loja ofereceu (igual a Recebimentos).
 *
 * Tudo aqui é função pura: a página só junta as leituras e chama.
 */

export type DashPeriod = '7d' | '30d' | '90d' | '12m';
export type DashBucket = 'day' | 'week' | 'month';

export const DASH_PERIODS: { id: DashPeriod; label: string; long: string }[] = [
  { id: '7d', label: '7 dias', long: 'últimos 7 dias' },
  { id: '30d', label: '30 dias', long: 'últimos 30 dias' },
  { id: '90d', label: '90 dias', long: 'últimos 90 dias' },
  { id: '12m', label: '12 meses', long: 'últimos 12 meses' },
];

export interface DashRange {
  start: Date;
  /** Exclusivo: amanhã à meia-noite (ou o 1º dia do mês que vem). */
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  bucket: DashBucket;
  /** "últimos 30 dias" */
  label: string;
  /** "30 dias anteriores" */
  previousLabel: string;
}

const DAY_MS = 86_400_000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function periodRange(period: DashPeriod, now = new Date()): DashRange {
  const meta = DASH_PERIODS.find(p => p.id === period)!;
  if (period === '12m') {
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      start, end,
      prevStart: new Date(start.getFullYear() - 1, start.getMonth(), 1),
      prevEnd: start,
      bucket: 'month',
      label: meta.long,
      previousLabel: '12 meses anteriores',
    };
  }
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const end = addDays(startOfDay(now), 1);
  const start = addDays(end, -days);
  return {
    start, end,
    prevStart: addDays(start, -days),
    prevEnd: start,
    bucket: period === '90d' ? 'week' : 'day',
    label: meta.long,
    previousLabel: `${days} dias anteriores`,
  };
}

// -------------------------------------------------------------- uma venda

export interface SaleLine {
  productId: string;
  name: string;
  photo: string;
  variant: string;
  quantity: number;
  amount: number;
}

export interface SaleFact {
  id: string;
  paidAt: Date;
  stage: OrderStage;
  /** Conta como venda (pago, sem devolução nem cancelamento). */
  counts: boolean;
  buyerId: string;
  buyerName: string;
  city: string;
  state: string;
  paymentMethod: Order['paymentMethod'];
  gross: number;
  fee: number;
  shipping: number;
  net: number;
  units: number;
  lines: SaleLine[];
}

/**
 * Uma linha por pedido desta loja que foi pago em algum momento (inclusive os
 * que depois viraram devolução). Pedido nunca pago não entra.
 */
export function saleFacts(orders: Order[], sellerId: string, commission: CommissionConfig): SaleFact[] {
  const facts: SaleFact[] = [];
  for (const order of orders) {
    const stage = orderStage(order);
    const everPaid = isPaid(order) || (stage === 'refund' && !!order.paymentConfirmedAt);
    if (!everPaid) continue;
    const items = sellerItems(order, sellerId);
    if (!items.length) continue;
    const paidAt = toDate(order.paymentConfirmedAt) ?? toDate(order.createdAt);
    if (!paidAt) continue;

    const gross = sellerAmount(order, sellerId);
    const fee = feeFor(gross, rateAt(commission, paidAt));
    const shipping = sellerShippingCost(order, sellerId);
    facts.push({
      id: order.id || '',
      paidAt,
      stage,
      counts: isPaid(order) && stage !== 'refund' && stage !== 'cancelled',
      buyerId: order.userId || '',
      buyerName: order.customerData?.name || '',
      city: (order.addressData?.city || '').trim(),
      state: (order.addressData?.state || '').trim().toUpperCase(),
      paymentMethod: order.paymentMethod,
      gross,
      fee,
      shipping,
      net: roundCents(gross - fee - shipping),
      units: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
      lines: items.map(item => ({
        productId: productIdOf(item) || item.productData?.name || '',
        name: item.productData?.name || 'Produto',
        photo: item.productData?.photoURL?.[0] || '',
        variant: item.variantLabel || '',
        quantity: item.quantity || 0,
        amount: roundCents(paidUnitPrice(item) * (item.quantity || 0)),
      })),
    });
  }
  return facts.sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
}

function inRange(fact: SaleFact, start: Date, end: Date): boolean {
  const t = fact.paidAt.getTime();
  return t >= start.getTime() && t < end.getTime();
}

// ------------------------------------------------------------------ resumo

export interface DashKpi {
  value: number;
  previous: number;
}

export interface DashSummary {
  revenue: DashKpi;
  net: DashKpi;
  fee: number;
  shipping: number;
  orders: DashKpi;
  units: DashKpi;
  ticket: DashKpi;
  customers: DashKpi;
  /** Clientes com 2+ compras no período. */
  returning: number;
  refunds: DashKpi;
  /** Devoluções ÷ pedidos pagos no período (0–1). */
  refundRate: number;
}

interface Totals {
  revenue: number;
  net: number;
  fee: number;
  shipping: number;
  orders: number;
  units: number;
  customers: number;
  returning: number;
  refunds: number;
}

function totals(facts: SaleFact[], start: Date, end: Date): Totals {
  const t: Totals = { revenue: 0, net: 0, fee: 0, shipping: 0, orders: 0, units: 0, customers: 0, returning: 0, refunds: 0 };
  const buyers = new Map<string, number>();
  for (const fact of facts) {
    if (!inRange(fact, start, end)) continue;
    if (!fact.counts) {
      if (fact.stage === 'refund') t.refunds++;
      continue;
    }
    t.revenue += fact.gross;
    t.net += fact.net;
    t.fee += fact.fee;
    t.shipping += fact.shipping;
    t.orders++;
    t.units += fact.units;
    if (fact.buyerId) buyers.set(fact.buyerId, (buyers.get(fact.buyerId) || 0) + 1);
  }
  t.customers = buyers.size;
  t.returning = [...buyers.values()].filter(n => n > 1).length;
  t.revenue = roundCents(t.revenue);
  t.net = roundCents(t.net);
  t.fee = roundCents(t.fee);
  t.shipping = roundCents(t.shipping);
  return t;
}

export function summarize(facts: SaleFact[], range: DashRange): DashSummary {
  const now = totals(facts, range.start, range.end);
  const before = totals(facts, range.prevStart, range.prevEnd);
  const ticket = (t: Totals) => (t.orders ? roundCents(t.revenue / t.orders) : 0);
  const paidCount = now.orders + now.refunds;
  return {
    revenue: { value: now.revenue, previous: before.revenue },
    net: { value: now.net, previous: before.net },
    fee: now.fee,
    shipping: now.shipping,
    orders: { value: now.orders, previous: before.orders },
    units: { value: now.units, previous: before.units },
    ticket: { value: ticket(now), previous: ticket(before) },
    customers: { value: now.customers, previous: before.customers },
    returning: now.returning,
    refunds: { value: now.refunds, previous: before.refunds },
    refundRate: paidCount ? now.refunds / paidCount : 0,
  };
}

export interface DashDelta {
  text: string;
  tone: 'up' | 'down' | 'flat';
  aria: string;
}

/** Variação contra o período anterior de mesma duração (igual às Métricas do admin). */
export function delta(kpi: DashKpi, previousLabel: string): DashDelta {
  if (kpi.previous === 0) {
    if (kpi.value === 0) return { text: 'estável', tone: 'flat', aria: 'sem variação' };
    return { text: 'novo', tone: 'up', aria: `sem movimento nos ${previousLabel}` };
  }
  const pct = ((kpi.value - kpi.previous) / kpi.previous) * 100;
  const rounded = Math.abs(pct) < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
  if (rounded === 0) return { text: '0%', tone: 'flat', aria: `igual aos ${previousLabel}` };
  const abs = String(Math.abs(rounded)).replace('.', ',');
  return {
    text: `${rounded > 0 ? '+' : '−'}${abs}%`,
    tone: rounded > 0 ? 'up' : 'down',
    aria: `${rounded > 0 ? 'alta' : 'queda'} de ${abs}% sobre os ${previousLabel}`,
  };
}

// ------------------------------------------------------------------ série

export interface DashPoint {
  label: string;
  revenue: number;
  orders: number;
}

/** Um ponto por dia, semana (começando no domingo) ou mês do período. */
export function series(facts: SaleFact[], range: DashRange): DashPoint[] {
  const buckets: { start: number; label: string; revenue: number; orders: number }[] = [];
  if (range.bucket === 'month') {
    for (let d = new Date(range.start); d < range.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const label = d.getMonth() === 0 ? `${MONTHS_SHORT[0]} ${String(d.getFullYear()).slice(2)}` : MONTHS_SHORT[d.getMonth()];
      buckets.push({ start: d.getTime(), label, revenue: 0, orders: 0 });
    }
  } else {
    const step = range.bucket === 'week' ? 7 : 1;
    let d = new Date(range.start);
    if (step === 7) d = addDays(d, -d.getDay());
    for (; d < range.end; d = addDays(d, step)) {
      buckets.push({ start: d.getTime(), label: formatDay(d), revenue: 0, orders: 0 });
    }
  }

  for (const fact of facts) {
    if (!fact.counts || !inRange(fact, range.start, range.end)) continue;
    const t = fact.paidAt.getTime();
    let i = buckets.length - 1;
    while (i > 0 && buckets[i].start > t) i--;
    buckets[i].revenue += fact.gross;
    buckets[i].orders++;
  }
  return buckets.map(b => ({ label: range.bucket === 'week' ? `sem. ${b.label}` : b.label, revenue: roundCents(b.revenue), orders: b.orders }));
}

// ------------------------------------------------------------ mais vendidos

export interface TopProduct {
  productId: string;
  name: string;
  photo: string;
  units: number;
  revenue: number;
  orders: number;
}

export function topProducts(facts: SaleFact[], range: DashRange): TopProduct[] {
  const map = new Map<string, TopProduct>();
  for (const fact of facts) {
    if (!fact.counts || !inRange(fact, range.start, range.end)) continue;
    const seen = new Set<string>();
    for (const line of fact.lines) {
      const entry = map.get(line.productId) ?? { productId: line.productId, name: line.name, photo: line.photo, units: 0, revenue: 0, orders: 0 };
      entry.units += line.quantity;
      entry.revenue = roundCents(entry.revenue + line.amount);
      if (!seen.has(line.productId)) entry.orders++;
      seen.add(line.productId);
      if (!entry.photo && line.photo) entry.photo = line.photo;
      map.set(line.productId, entry);
    }
  }
  return [...map.values()];
}

// --------------------------------------------------------- quando e onde

export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Pedidos pagos por dia da semana, começando na segunda. */
export function byWeekday(facts: SaleFact[], range: DashRange): { label: string; long: string; value: number }[] {
  const counts = new Array(7).fill(0);
  for (const fact of facts) {
    if (fact.counts && inRange(fact, range.start, range.end)) counts[fact.paidAt.getDay()]++;
  }
  return [1, 2, 3, 4, 5, 6, 0].map(d => ({ label: WEEKDAYS_SHORT[d], long: WEEKDAYS_LONG[d], value: counts[d] }));
}

export interface PlaceShare {
  label: string;
  orders: number;
  revenue: number;
}

/** Estados (UF) e cidades de entrega, por número de pedidos. */
export function byPlace(facts: SaleFact[], range: DashRange): { states: PlaceShare[]; cities: PlaceShare[] } {
  const states = new Map<string, PlaceShare>();
  const cities = new Map<string, PlaceShare>();
  const add = (map: Map<string, PlaceShare>, label: string, fact: SaleFact) => {
    const entry = map.get(label) ?? { label, orders: 0, revenue: 0 };
    entry.orders++;
    entry.revenue = roundCents(entry.revenue + fact.gross);
    map.set(label, entry);
  };
  for (const fact of facts) {
    if (!fact.counts || !inRange(fact, range.start, range.end)) continue;
    if (fact.state) add(states, fact.state, fact);
    if (fact.city) add(cities, fact.state ? `${fact.city} · ${fact.state}` : fact.city, fact);
  }
  const sort = (list: PlaceShare[]) => list.sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
  return { states: sort([...states.values()]), cities: sort([...cities.values()]) };
}

// ------------------------------------------------------------ agora na loja

export interface StoreNow {
  toShip: number;
  late: number;
  shipping: number;
  awaitingPayment: number;
  openRefunds: number;
}

/** Fila de trabalho de hoje, independente do período escolhido. */
export function storeNow(orders: Order[], sellerId: string, now = new Date()): StoreNow {
  const result: StoreNow = { toShip: 0, late: 0, shipping: 0, awaitingPayment: 0, openRefunds: 0 };
  for (const order of orders) {
    if (!sellerItems(order, sellerId).length) continue;
    const stage = orderStage(order);
    if (stage === 'preparing') {
      result.toShip++;
      const due = shipByDate(order);
      if (due && due.getTime() < now.getTime()) result.late++;
    } else if (stage === 'shipping') {
      result.shipping++;
    } else if (stage === 'pay') {
      result.awaitingPayment++;
    } else if (stage === 'refund' && (order.refundInfo?.status === 'REQUESTED' || order.refundInfo?.status === 'APPROVED')) {
      result.openRefunds++;
    }
  }
  return result;
}

// ---------------------------------------------------------------- anúncios

export interface ListingHealth {
  total: number;
  active: number;
  outOfStock: number;
  lowStock: number;
  hidden: number;
  /** Anúncios que pedem ação: fora do ar, sem estoque e estoque baixo, nessa ordem. */
  attention: { product: Product; reason: string; tone: 'rust' | 'amber' }[];
  mostSaved: Product[];
}

export const LOW_STOCK = 2;

export type ListingStatus = 'active' | 'low' | 'out' | 'hidden';

/** Situação de um anúncio para a loja (Meus anúncios, Meu anúncio). */
export function listingStatus(p: Product): ListingStatus {
  if (p.moderation?.hidden) return 'hidden';
  const stock = p.stock || 0;
  if (stock <= 0) return 'out';
  return stock <= LOW_STOCK ? 'low' : 'active';
}

export function listingHealth(products: Product[]): ListingHealth {
  const hidden = products.filter(p => p.moderation?.hidden);
  const visible = products.filter(p => !p.moderation?.hidden);
  const out = visible.filter(p => (p.stock || 0) <= 0);
  const low = visible.filter(p => (p.stock || 0) > 0 && (p.stock || 0) <= LOW_STOCK);
  return {
    total: products.length,
    active: visible.length - out.length,
    outOfStock: out.length,
    lowStock: low.length,
    hidden: hidden.length,
    attention: [
      ...hidden.map(product => ({ product, reason: 'Fora do ar pela moderação', tone: 'rust' as const })),
      ...out.map(product => ({ product, reason: 'Sem estoque — não aparece para compra', tone: 'rust' as const })),
      ...low.map(product => ({ product, reason: `Só ${product.stock} em estoque`, tone: 'amber' as const })),
    ],
    mostSaved: visible.filter(p => (p.savedCount || 0) > 0).sort((a, b) => (b.savedCount || 0) - (a.savedCount || 0)).slice(0, 3),
  };
}

// ----------------------------------------------------------------- relatório

export interface MonthRow {
  key: string;
  label: string;
  orders: number;
  units: number;
  revenue: number;
  fee: number;
  shipping: number;
  net: number;
  refunds: number;
}

/** Fechamento mês a mês (mais recente primeiro), na mesma base da nota da Vineon. */
export function monthlyReport(facts: SaleFact[], months: number, now = new Date()): MonthRow[] {
  const rows: MonthRow[] = [];
  for (let i = 0; i < months; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const t = totals(facts, start, end);
    const name = MONTHS_LONG[start.getMonth()];
    rows.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: start.getFullYear() === now.getFullYear() ? name : `${name} ${start.getFullYear()}`,
      orders: t.orders,
      units: t.units,
      revenue: t.revenue,
      fee: t.fee,
      shipping: t.shipping,
      net: t.net,
      refunds: t.refunds,
    });
  }
  return rows;
}

const PAYMENT_LABEL: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão' };
const STAGE_CSV: Record<OrderStage, string> = {
  pay: 'Aguardando pagamento', preparing: 'A enviar', shipping: 'Enviada', done: 'Entregue', refund: 'Devolução', cancelled: 'Cancelada',
};

/**
 * Planilha das vendas do período (uma linha por produto vendido). Separador
 * `;` e vírgula decimal, que é o que o Excel em português abre direto.
 */
export function salesCsv(facts: SaleFact[], range: DashRange): string {
  const money = (n: number) => n.toFixed(2).replace('.', ',');
  const cell = (value: string | number) => {
    const text = String(value ?? '');
    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const pad = (n: number) => String(n).padStart(2, '0');
  const header = ['Pedido', 'Pago em', 'Situação', 'Produto', 'Variação', 'Qtd.', 'Valor dos itens', 'Vendido no pedido',
    'Taxa Vineon', 'Frete grátis da loja', 'Você recebe', 'Pagamento', 'Cidade', 'UF'];
  const rows = [header.join(';')];
  for (const fact of [...facts].reverse()) {
    if (!inRange(fact, range.start, range.end)) continue;
    const d = fact.paidAt;
    const when = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    fact.lines.forEach((line, i) => {
      const first = i === 0;
      rows.push([
        fact.id.slice(0, 8).toUpperCase(), when, STAGE_CSV[fact.stage], line.name, line.variant, line.quantity, money(line.amount),
        first ? money(fact.gross) : '', first ? money(fact.fee) : '', first ? money(fact.shipping) : '', first ? money(fact.net) : '',
        PAYMENT_LABEL[fact.paymentMethod] || fact.paymentMethod || '', fact.city, fact.state,
      ].map(cell).join(';'));
    });
  }
  return '﻿' + rows.join('\r\n');
}

/** Dias inteiros desde uma data (para "há 3 dias" nas dicas). */
export function daysSince(date: Date, now = new Date()): number {
  return Math.floor((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS);
}
