import { Coupon } from '../interfaces/coupon';

/**
 * Textos e limites dos cupons, iguais para o comprador, a loja e o admin.
 *
 * Quem calcula desconto é só o servidor (`functions/src/coupons.ts`); aqui é
 * só o jeito de mostrar. As regras aparecem por extenso em todo lugar onde o
 * cupom aparece (CDC: oferta precisa ser clara, e o que foi anunciado vale).
 *
 * `COUPON_LIMITS` espelha `LIMITS` do servidor. Mudou lá, mude aqui.
 */
export const COUPON_LIMITS = {
  codeMin: 4,
  codeMax: 15,
  percentMax: 90,
  fixedMax: 10_000,
  perUserMax: 10,
  productIdsMax: 50,
  sellerActiveMax: 20,
} as const;

/** Mínimo de cobrança do Cora/Asaas; o desconto nunca leva o total abaixo disso. */
export const MIN_ORDER_TOTAL = 5;

export function normalizeCouponCode(value: string): string {
  return (value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidCouponCode(code: string): boolean {
  return new RegExp(`^[A-Z0-9]{${COUPON_LIMITS.codeMin},${COUPON_LIMITS.codeMax}}$`).test(code);
}

function brl(value: number, compact = false): string {
  const whole = compact && Number.isInteger(value);
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

function day(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** A frase grande do cupom: "10% OFF", "R$ 20 OFF", "Frete grátis". */
export function couponHeadline(c: Pick<Coupon, 'type' | 'value'>): string {
  if (c.type === 'percent') return `${c.value}% OFF`;
  if (c.type === 'fixed') return `${brl(c.value, true)} OFF`;
  return c.value > 0 ? `Frete grátis até ${brl(c.value, true)}` : 'Frete grátis';
}

/** De quem é: "Cupom Vineon" ou "Cupom da Loja X". */
export function couponOwner(c: Pick<Coupon, 'scope' | 'sellerName'>): string {
  if (c.scope === 'platform') return 'Cupom Vineon';
  return c.sellerName ? `Cupom da ${c.sellerName}` : 'Cupom da loja';
}

/**
 * As condições, uma por linha, na ordem em que a pessoa precisa saber:
 * mínimo, teto, onde vale, quem pode, até quando.
 */
export function couponConditions(c: Coupon, opts: { withDates?: boolean } = {}): string[] {
  const out: string[] = [];
  const where = c.scope === 'seller'
    ? (c.productIds.length
        ? `Só em ${c.productIds.length === 1 ? '1 produto escolhido' : `${c.productIds.length} produtos escolhidos`} da loja`
        : 'Em qualquer produto da loja')
    : c.type === 'shipping' ? 'No frete do pedido' : 'Em qualquer produto da Vineon';
  out.push(where);

  if (c.minSubtotal > 0) {
    out.push(c.scope === 'seller'
      ? `Compra mínima de ${brl(c.minSubtotal)} em produtos da loja`
      : `Compra mínima de ${brl(c.minSubtotal)}`);
  }
  if (c.type === 'percent' && c.maxDiscount) out.push(`Desconto máximo de ${brl(c.maxDiscount)}`);
  if (c.type === 'shipping' && c.value > 0) out.push(`Cobre até ${brl(c.value)} do frete; o que passar disso você paga`);
  if (c.firstPurchaseOnly) out.push('Só na primeira compra na Vineon');
  out.push(c.perUserLimit === 1 ? '1 uso por pessoa' : `Até ${c.perUserLimit} usos por pessoa`);
  if (c.usageLimit) {
    const left = Math.max(0, c.usageLimit - c.redeemedCount);
    out.push(left <= 20 ? `Restam ${left} de ${c.usageLimit} cupons` : `Limitado a ${c.usageLimit} cupons`);
  }
  if (opts.withDates !== false) {
    if (c.endsAt) out.push(`Válido até ${day(c.endsAt)}`);
    else out.push('Sem data de término');
  }
  out.push('Não acumula com outro cupom no mesmo pedido');
  return out;
}

/** Linha curta para chips e listas: "10% OFF · mín. R$ 100 · até 31/10". */
export function couponShortRule(c: Coupon): string {
  const parts = [couponHeadline(c)];
  if (c.minSubtotal > 0) parts.push(`mín. ${brl(c.minSubtotal, true)}`);
  if (c.type === 'percent' && c.maxDiscount) parts.push(`até ${brl(c.maxDiscount, true)}`);
  if (c.endsAt) parts.push(`vale até ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(c.endsAt)}`);
  return parts.join(' · ');
}

/** Está valendo agora? (ativo, já começou, não venceu e não esgotou). */
export function isCouponLive(c: Coupon, now = Date.now()): boolean {
  if (c.status !== 'active') return false;
  if (c.startsAt && c.startsAt.getTime() > now) return false;
  if (c.endsAt && c.endsAt.getTime() <= now) return false;
  if (c.usageLimit && c.redeemedCount >= c.usageLimit) return false;
  return true;
}

/** Cupom da loja cobre este produto? */
export function couponCoversProduct(c: Coupon, productId: string | undefined, sellerId: string | undefined): boolean {
  if (c.scope === 'platform') return true;
  if (!sellerId || c.sellerId !== sellerId) return false;
  return !c.productIds.length || (!!productId && c.productIds.includes(productId));
}

export type CouponState = 'live' | 'scheduled' | 'paused' | 'expired' | 'soldout' | 'ended';

export const COUPON_STATE_LABEL: Record<CouponState, string> = {
  live: 'Valendo',
  scheduled: 'Agendado',
  paused: 'Pausado',
  expired: 'Vencido',
  soldout: 'Esgotado',
  ended: 'Encerrado',
};

/** Situação para quem administra (loja/admin). */
export function couponState(c: Coupon, now = Date.now()): CouponState {
  if (c.status === 'ended') return 'ended';
  if (c.status === 'paused') return 'paused';
  if (c.endsAt && c.endsAt.getTime() <= now) return 'expired';
  if (c.usageLimit && c.redeemedCount >= c.usageLimit) return 'soldout';
  if (c.startsAt && c.startsAt.getTime() > now) return 'scheduled';
  return 'live';
}
