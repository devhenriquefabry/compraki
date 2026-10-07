/**
 * Cupom de desconto (`coupons/{CODIGO}`). Quem grava é a Cloud Function
 * `saveCoupon`; o app só lê. Regras e cálculo em `functions/src/coupons.ts`.
 */
export type CouponScope = 'platform' | 'seller';
export type CouponType = 'percent' | 'fixed' | 'shipping';
export type CouponStatus = 'active' | 'paused' | 'ended';
export type CouponVisibility = 'public' | 'private';

export interface Coupon {
  /** É o próprio id do documento: único no app inteiro. */
  code: string;
  /** `platform`: a Vineon dá e banca. `seller`: a loja dá, só nos produtos dela. */
  scope: CouponScope;
  sellerId: string | null;
  sellerName: string | null;
  type: CouponType;
  /** % (percent), reais (fixed) ou teto do desconto no frete (shipping; 0 = frete inteiro). */
  value: number;
  /** Teto do desconto em % (opcional). */
  maxDiscount: number | null;
  /** Compra mínima: nos itens que o cupom cobre (no carrinho todo, para frete). */
  minSubtotal: number;
  /** Cupom da loja só para alguns produtos; vazio = todos os da loja. */
  productIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  /** Quantos cupons existem; `null` = sem limite. */
  usageLimit: number | null;
  perUserLimit: number;
  firstPurchaseOnly: boolean;
  /** Público aparece no app; privado só funciona para quem tem o código. */
  visibility: CouponVisibility;
  status: CouponStatus;
  /** Reservas abertas + usos (o que o `usageLimit` limita). */
  redeemedCount: number;
  /** Pedidos que saíram com o cupom. */
  ordersCount: number;
  discountTotal: number;
  /** A Vineon pausou um cupom de loja: a loja não reativa sozinha. */
  pausedByAdmin: boolean;
  createdAt: Date | null;
}

/** Resposta do servidor para um carrinho. Valores em reais. */
export interface CouponQuote {
  code: string;
  scope: CouponScope;
  sellerId: string | null;
  type: CouponType;
  subtotal: number;
  eligibleSubtotal: number;
  itemsDiscount: number;
  shippingDiscount: number;
  discount: number;
}

/** O que o formulário manda para `saveCoupon` (datas em milissegundos). */
export interface CouponInput {
  code: string;
  type: CouponType;
  value: number;
  maxDiscount: number | null;
  minSubtotal: number;
  productIds: string[];
  startsAt: number | null;
  endsAt: number | null;
  usageLimit: number | null;
  perUserLimit: number;
  firstPurchaseOnly: boolean;
  visibility: CouponVisibility;
}
