import { CartItem } from '../interfaces/cart-item';
import { Order, RefundRequestStatus } from '../interfaces/order';

/**
 * Em que pé está a compra, do ponto de vista de quem comprou.
 *
 * O pedido guarda duas coisas separadas: `status` (dinheiro — escrito só pelo
 * webhook do Asaas) e `shipmentStatus` (entrega — escrito pelo vendedor na
 * tela de venda). A lista "Minhas compras" junta as duas numa etapa só, que é
 * o que decide aba, cor, trilha e botões.
 */
export type OrderStage = 'pay' | 'preparing' | 'shipping' | 'done' | 'refund' | 'cancelled';

export type OrderTab = 'all' | OrderStage;

export const ORDER_TABS: { id: OrderTab; label: string }[] = [
  { id: 'all', label: 'Tudo' },
  { id: 'pay', label: 'A pagar' },
  { id: 'preparing', label: 'Preparando' },
  { id: 'shipping', label: 'A caminho' },
  { id: 'done', label: 'Entregues' },
  { id: 'refund', label: 'Devoluções' },
  { id: 'cancelled', label: 'Cancelados' },
];

/** Abas cujo número aparece em destaque: pedem algo da pessoa ou estão andando. */
export const COUNTED_TABS: OrderTab[] = ['pay', 'preparing', 'shipping'];

const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'];

export function orderStage(order: Order): OrderStage {
  if (order.refundInfo?.status || order.status === 'REFUNDED') return 'refund';
  if (order.status === 'CANCELLED') return 'cancelled';
  if (order.status === 'PENDING') return 'pay';

  if (order.status === 'DELIVERED' || order.shipmentStatus === 'DELIVERED') return 'done';
  if (order.shipmentStatus === 'SHIPPED' || order.shipmentStatus === 'PROBLEM') return 'shipping';
  if (PAID_STATUSES.includes(order.status)) return 'preparing';
  return 'pay';
}

export const STAGE_LABEL: Record<OrderStage, string> = {
  pay: 'Aguardando pagamento',
  preparing: 'Preparando',
  shipping: 'A caminho',
  done: 'Entregue',
  refund: 'Devolução',
  cancelled: 'Cancelado',
};

export const REFUND_LABEL: Record<RefundRequestStatus, string> = {
  REQUESTED: 'Devolução em análise',
  APPROVED: 'Devolução aprovada',
  REJECTED: 'Devolução recusada',
  COMPLETED: 'Estorno concluído',
};

/** Os quatro marcos da trilha de entrega. `done` é o último. */
export const TRACK_STEPS = ['Pago', 'Preparando', 'A caminho', 'Entregue'] as const;

/** Índice do marco atual na trilha, ou -1 quando a etapa não tem trilha. */
export function trackIndex(stage: OrderStage): number {
  switch (stage) {
    case 'preparing': return 1;
    case 'shipping': return 2;
    case 'done': return 3;
    default: return -1;
  }
}

export function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const weekday = d.getDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return d;
}

/**
 * Prazo de entrega a partir da confirmação do pagamento.
 *
 * `deliveryTime` é o prazo em dias úteis que o Melhor Envio devolveu na cotação
 * do checkout; ele conta a partir da postagem. O início da faixa é o prazo
 * cru, o fim soma 2 dias úteis para o vendedor postar — mesma lógica da
 * "data prevista" dos marketplaces grandes, que mostram uma faixa, não um dia.
 */
export function deliveryWindow(order: Order): { from: Date; to: Date } | null {
  const days = order.shippingInfo?.deliveryTime;
  if (!days || days <= 0) return null;
  const base = toDate(order.paymentConfirmedAt) ?? toDate(order.createdAt);
  if (!base) return null;
  return { from: addBusinessDays(base, days), to: addBusinessDays(base, days + 2) };
}

/** Vencimento da cobrança: o checkout cria PIX e boleto com 3 dias. */
export function paymentDueDate(order: Order): Date | null {
  const created = toDate(order.createdAt);
  if (!created) return null;
  const due = new Date(created);
  due.setDate(due.getDate() + 3);
  return due;
}

export function trackingUrl(code: string): string {
  return `https://www.melhorrastreio.com.br/rastreio/${encodeURIComponent(code)}`;
}

/** Preço unitário pago: o menor entre cheio e promocional, como no checkout. */
export function paidUnitPrice(item: CartItem): number {
  const { price, priceDiscounted } = item.productData;
  return priceDiscounted ? Math.min(price, priceDiscounted) : price;
}

/** Preço cheio riscado ao lado, só quando houve desconto de verdade. */
export function listUnitPrice(item: CartItem): number | null {
  const { price, priceDiscounted } = item.productData;
  return priceDiscounted && priceDiscounted < price ? price : null;
}

export function itemCount(order: Order): number {
  return (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
}

export function productIdOf(item: CartItem): string | null {
  return item.productId || item.productData?.id || null;
}

/** Até quando a devolução ainda pode ser pedida (fim da retenção de 7 dias). */
export function canRequestRefund(order: Order, now = new Date()): boolean {
  if (!['RECEIVED', 'CONFIRMED', 'DELIVERED'].includes(order.status)) return false;
  if (order.refundInfo?.status) return false;
  if (order.escrowInfo?.status !== 'HOLDING') return false;
  const release = toDate(order.escrowInfo?.releaseDate);
  return !!release && release.getTime() > now.getTime();
}

// ------------------------------------------------------------ lado da loja

/**
 * Etapas vistas por quem vende. Mesma derivação do comprador, com outros
 * nomes: "Preparando" para a loja é "A enviar".
 */
export type SaleTab = 'all' | OrderStage;

export const SALE_TABS: { id: SaleTab; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'preparing', label: 'A enviar' },
  { id: 'shipping', label: 'Enviadas' },
  { id: 'done', label: 'Entregues' },
  { id: 'pay', label: 'Pendentes' },
  { id: 'refund', label: 'Devoluções' },
  { id: 'cancelled', label: 'Canceladas' },
];

export const SALE_STAGE_LABEL: Record<OrderStage, string> = {
  pay: 'Aguardando pagamento',
  preparing: 'A enviar',
  shipping: 'Enviada',
  done: 'Entregue',
  refund: 'Devolução',
  cancelled: 'Cancelada',
};

export const SALE_TRACK_STEPS = ['Paga', 'Embalar', 'Enviada', 'Entregue'] as const;

/** Itens do pedido que são desta loja (pedido pode ter várias lojas). */
export function sellerItems(order: Order, sellerId: string): CartItem[] {
  const items = order.items || [];
  const mine = items.filter(item => item.productData?.sellerId === sellerId);
  // Pedido antigo sem `sellerId` no item: se a loja é a única do pedido, é tudo dela.
  if (!mine.length && (order.sellerIds || []).length === 1) return items;
  return mine;
}

/** Quanto a loja vendeu neste pedido: só os itens dela, sem frete. */
export function sellerAmount(order: Order, sellerId: string): number {
  return sellerItems(order, sellerId).reduce((sum, item) => sum + paidUnitPrice(item) * (item.quantity || 0), 0);
}

/**
 * Prazo de postagem: 2 dias úteis depois do pagamento. É a mesma folga que a
 * previsão de entrega do comprador (`deliveryWindow`) reserva para a loja.
 */
export function shipByDate(order: Order): Date | null {
  const base = toDate(order.paymentConfirmedAt) ?? toDate(order.createdAt);
  return base ? addBusinessDays(base, 2) : null;
}

export function isPaid(order: Order): boolean {
  return PAID_STATUSES.includes(order.status);
}

// --------------------------------------------------------------- formatação

export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "24 set", com o ano só quando não é o corrente. */
export function formatDay(date: Date | null, withYear = false): string {
  if (!date) return '';
  const base = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return withYear && date.getFullYear() !== new Date().getFullYear() ? `${base} ${date.getFullYear()}` : base;
}

export function formatBRL(value: number): string {
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
