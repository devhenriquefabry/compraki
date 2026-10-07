import { FieldValue, Timestamp, getFirestore, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';

import { defaultRuntime, handleCors, isBootstrapAdminEmail, methodNotAllowed, region, requireAuthenticated } from './shared/http';

/**
 * Cupons de desconto.
 * ----------------------------------------------------------------------------
 * Dois donos:
 * - `platform` (Vineon, criado no /admin): % ou valor fixo no carrinho todo, ou
 *   frete grátis (com teto). A Vineon banca o desconto; a loja recebe cheio.
 * - `seller` (loja, criado em "Cupons da loja"): % ou valor fixo só nos
 *   produtos daquela loja (todos ou os escolhidos). Sai da venda da loja.
 *
 * `coupons/{CODIGO}`: o id é o próprio código, então código é único no app
 * inteiro e achar um cupom é um `get`. O cliente só LÊ (os públicos e ativos,
 * ou os seus); quem cria e edita é `saveCoupon`.
 *
 * Uso de um cupom, em três passos, para o limite valer mesmo com duas abas
 * abertas ao mesmo tempo:
 *   1. `couponQuote` `preview`: calcula o desconto com o preço ATUAL dos
 *      produtos (`products/`), nunca com o que o navegador diz.
 *   2. `couponQuote` `reserve`, logo antes da cobrança: numa transação confere
 *      os limites e grava `couponRedemptions/{id}` (`reserved`, 30 min).
 *   3. O pedido nasce com `coupon` igual à reserva — a regra do Firestore
 *      confere campo a campo — e `onOrderWrittenCoupon` marca a reserva como
 *      `used`. Reserva usada duas vezes deixa o 2º pedido com
 *      `couponCheck: 'invalid'`, e a confirmação de pagamento não o aprova.
 * Pedido cancelado devolve o uso (o cupom volta para a pessoa, como no ML).
 *
 * Reserva vencida não precisa de rotina agendada: a próxima reserva do mesmo
 * cupom a encerra e devolve a vaga.
 *
 * As frases de regra que o app mostra estão em `src/app/core/coupons.ts`; os
 * limites abaixo também estão lá (`COUPON_LIMITS`). Mudou aqui, mude lá.
 */

export const COUPONS = 'coupons';
export const REDEMPTIONS = 'couponRedemptions';
const ATTEMPTS = 'couponAttempts';

type Scope = 'platform' | 'seller';
type CouponType = 'percent' | 'fixed' | 'shipping';
type CouponStatus = 'active' | 'paused' | 'ended';
type Visibility = 'public' | 'private';

const LIMITS = {
  codeMin: 4,
  codeMax: 15,
  percentMax: 90,
  fixedMax: 10_000,
  minSubtotalMax: 100_000,
  usageMax: 100_000,
  perUserMax: 10,
  productIdsMax: 50,
  sellerActiveMax: 20,
  cartLinesMax: 50,
  quantityMax: 999,
  /** Validade máxima de um cupom: um ano. */
  durationMaxMs: 366 * 24 * 60 * 60 * 1000,
  reserveMs: 30 * 60 * 1000,
  /** Códigos errados seguidos: trava de tentativa e erro. */
  failWindowMs: 10 * 60 * 1000,
  failMax: 15,
} as const;

/** Cora e Asaas recusam cobrança abaixo de R$ 5,00: o cupom nunca derruba o total disso. */
export const MIN_ORDER_TOTAL = 5;

const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'];

export const couponRuntime = { ...defaultRuntime, maxInstances: 2 } as const;

/** Erro com código HTTP: o handler devolve `message` ao app. */
class CouponError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface CouponDoc {
  code: string;
  scope: Scope;
  sellerId: string | null;
  sellerName: string | null;
  type: CouponType;
  value: number;
  maxDiscount: number | null;
  minSubtotal: number;
  productIds: string[];
  startsAt: Timestamp;
  endsAt: Timestamp | null;
  usageLimit: number | null;
  perUserLimit: number;
  firstPurchaseOnly: boolean;
  visibility: Visibility;
  status: CouponStatus;
  /** Reservas em aberto + usos: é o número que o `usageLimit` limita. */
  redeemedCount: number;
  /** Pedidos que saíram com o cupom (não conta reserva nem pedido cancelado). */
  ordersCount: number;
  /** Soma dos descontos dados nesses pedidos, em reais. */
  discountTotal: number;
}

interface CartLine {
  productId: string;
  sellerId: string;
  unitPrice: number;
  quantity: number;
}

export interface CouponResult {
  code: string;
  scope: Scope;
  sellerId: string | null;
  type: CouponType;
  subtotal: number;
  eligibleSubtotal: number;
  itemsDiscount: number;
  shippingDiscount: number;
  discount: number;
}

// ------------------------------------------------------------------ helpers

const cents = (value: number) => Math.round(value * 100) / 100;
/** Desconto arredonda para baixo: nunca dar um centavo a mais do que a regra. */
const floorCents = (value: number) => Math.floor(value * 100 + 1e-6) / 100;

function brl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function isValidCode(code: string): boolean {
  return new RegExp(`^[A-Z0-9]{${LIMITS.codeMin},${LIMITS.codeMax}}$`).test(code);
}

function money(value: unknown, field: string, { min = 0, max = LIMITS.fixedMax as number } = {}): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new CouponError(400, `${field}: valor inválido.`);
  return cents(n);
}

function optionalMoney(value: unknown, field: string, max = LIMITS.fixedMax): number | null {
  if (value === null || value === undefined || value === '' || Number(value) === 0) return null;
  return money(value, field, { min: 0.01, max });
}

function int(value: unknown, field: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new CouponError(400, `${field}: valor inválido.`);
  return n;
}

function millis(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(n) ? n : null;
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return Number(value) || 0;
}

function couponFrom(snap: DocumentSnapshot): CouponDoc {
  const d = snap.data() || {};
  return {
    code: snap.id,
    scope: d['scope'] === 'seller' ? 'seller' : 'platform',
    sellerId: d['sellerId'] || null,
    sellerName: d['sellerName'] || null,
    type: (['percent', 'fixed', 'shipping'] as const).includes(d['type']) ? d['type'] : 'fixed',
    value: Number(d['value']) || 0,
    maxDiscount: d['maxDiscount'] ? Number(d['maxDiscount']) : null,
    minSubtotal: Number(d['minSubtotal']) || 0,
    productIds: Array.isArray(d['productIds']) ? d['productIds'] : [],
    startsAt: d['startsAt'],
    endsAt: d['endsAt'] || null,
    usageLimit: d['usageLimit'] ? Number(d['usageLimit']) : null,
    perUserLimit: Number(d['perUserLimit']) || 1,
    firstPurchaseOnly: d['firstPurchaseOnly'] === true,
    visibility: d['visibility'] === 'private' ? 'private' : 'public',
    status: (['active', 'paused', 'ended'] as const).includes(d['status']) ? d['status'] : 'paused',
    redeemedCount: Number(d['redeemedCount']) || 0,
    ordersCount: Number(d['ordersCount']) || 0,
    discountTotal: Number(d['discountTotal']) || 0,
  };
}

async function isSuspended(uid: string): Promise<boolean> {
  return (await getFirestore().doc(`accountSuspensions/${uid}`).get()).exists;
}

// ---------------------------------------------------------------- o cálculo

/**
 * Lê os produtos do carrinho e devolve as linhas com o preço de AGORA: o da
 * variação quando há (`skus[skuId].price`), senão o promocional válido, senão
 * o cheio — a mesma conta de `priceMain` no app.
 */
async function loadCart(rawItems: unknown): Promise<CartLine[]> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new CouponError(400, 'Seu carrinho está vazio.');
  if (rawItems.length > LIMITS.cartLinesMax) throw new CouponError(400, 'Carrinho grande demais para um pedido só.');

  const wanted = rawItems.map(raw => {
    const item = (raw || {}) as Record<string, unknown>;
    const productId = String(item['productId'] ?? '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) throw new CouponError(400, 'Produto inválido no carrinho.');
    return {
      productId,
      skuId: typeof item['skuId'] === 'string' && item['skuId'] ? String(item['skuId']) : null,
      quantity: int(item['quantity'], 'Quantidade', 1, LIMITS.quantityMax),
    };
  });

  const db = getFirestore();
  const ids = [...new Set(wanted.map(w => w.productId))];
  const snaps = await db.getAll(...ids.map(id => db.doc(`products/${id}`)));
  const products = new Map(snaps.map(s => [s.id, s]));

  return wanted.map(w => {
    const snap = products.get(w.productId);
    if (!snap?.exists) throw new CouponError(409, 'Um produto do carrinho não está mais à venda. Atualize o carrinho.');
    const p = snap.data() || {};
    const price = Number(p['price']) || 0;
    const promo = Number(p['priceDiscounted']) || 0;
    const main = promo > 0 && price > 0 && promo < price ? promo : price;
    const skuPrice = w.skuId ? p['skus']?.[w.skuId]?.price : null;
    const unitPrice = typeof skuPrice === 'number' && skuPrice > 0 ? skuPrice : main;
    return { productId: w.productId, sellerId: String(p['sellerId'] || ''), unitPrice, quantity: w.quantity };
  });
}

/**
 * Aplica as regras do cupom ao carrinho. Não olha limite de uso (isso é da
 * reserva, dentro da transação); olha status, datas, loja, produtos e mínimo.
 */
export function evaluateCoupon(coupon: CouponDoc, lines: CartLine[], shippingPrice: number, now = Date.now()): CouponResult {
  if (coupon.status !== 'active') {
    throw new CouponError(409, coupon.status === 'ended' ? 'Este cupom foi encerrado.' : 'Este cupom está pausado no momento.');
  }
  if (toMillis(coupon.startsAt) > now) throw new CouponError(409, 'Este cupom ainda não começou a valer.');
  if (coupon.endsAt && toMillis(coupon.endsAt) <= now) throw new CouponError(409, 'Este cupom já venceu.');

  const subtotal = cents(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0));
  const eligible = lines.filter(l =>
    (coupon.scope === 'platform' || l.sellerId === coupon.sellerId)
    && (coupon.productIds.length === 0 || coupon.productIds.includes(l.productId)));

  if (!eligible.length) {
    if (coupon.scope === 'seller') {
      const shop = coupon.sellerName ? `da loja ${coupon.sellerName}` : 'de uma loja';
      throw new CouponError(409, coupon.productIds.length
        ? `Este cupom é ${shop} e vale só para alguns produtos dela, que não estão no seu carrinho.`
        : `Este cupom é ${shop} e vale só para produtos dela.`);
    }
    throw new CouponError(409, 'Este cupom não vale para os produtos do seu carrinho.');
  }

  const eligibleSubtotal = cents(eligible.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0));
  const base = coupon.type === 'shipping' ? subtotal : eligibleSubtotal;
  if (base < coupon.minSubtotal) {
    const where = coupon.scope === 'seller' ? ' em produtos da loja' : '';
    throw new CouponError(409, `Este cupom vale para compras a partir de ${brl(coupon.minSubtotal)}${where}. Faltam ${brl(cents(coupon.minSubtotal - base))}.`);
  }

  let itemsDiscount = 0;
  let shippingDiscount = 0;
  if (coupon.type === 'percent') {
    itemsDiscount = floorCents(eligibleSubtotal * coupon.value / 100);
    if (coupon.maxDiscount) itemsDiscount = Math.min(itemsDiscount, coupon.maxDiscount);
  } else if (coupon.type === 'fixed') {
    itemsDiscount = Math.min(coupon.value, eligibleSubtotal);
  } else {
    if (!(shippingPrice > 0)) throw new CouponError(409, 'Este cupom é de frete e só vale quando o pedido tem frete cobrado. Escolha a entrega primeiro.');
    shippingDiscount = coupon.value > 0 ? Math.min(coupon.value, shippingPrice) : shippingPrice;
  }

  // Cobrança mínima de R$ 5,00: o desconto para antes disso.
  const room = floorCents(subtotal + shippingPrice - MIN_ORDER_TOTAL);
  if (room <= 0) throw new CouponError(409, `Cupons valem em pedidos acima de ${brl(MIN_ORDER_TOTAL)}.`);
  itemsDiscount = cents(Math.min(itemsDiscount, room));
  shippingDiscount = cents(Math.min(shippingDiscount, room - itemsDiscount));

  const discount = cents(itemsDiscount + shippingDiscount);
  if (!(discount > 0)) throw new CouponError(409, 'Este cupom não dá desconto neste carrinho.');

  return {
    code: coupon.code,
    scope: coupon.scope,
    sellerId: coupon.sellerId,
    type: coupon.type,
    subtotal,
    eligibleSubtotal,
    itemsDiscount,
    shippingDiscount,
    discount,
  };
}

async function hasPaidOrder(uid: string): Promise<boolean> {
  const snap = await getFirestore().collection('orders').where('userId', '==', uid).limit(50).get();
  return snap.docs.some(d => PAID_STATUSES.includes(String(d.get('status'))) || d.get('status') === 'REFUNDED');
}

/** Código errado em sequência: depois de `failMax` em 10 min, para de responder. */
async function guardAttempts(uid: string): Promise<void> {
  const snap = await getFirestore().doc(`${ATTEMPTS}/${uid}`).get();
  const since = toMillis(snap.get('since'));
  if (since && Date.now() - since < LIMITS.failWindowMs && (Number(snap.get('count')) || 0) >= LIMITS.failMax) {
    throw new CouponError(429, 'Muitos códigos não encontrados seguidos. Espere alguns minutos e tente de novo.');
  }
}

async function countFailure(uid: string): Promise<void> {
  const ref = getFirestore().doc(`${ATTEMPTS}/${uid}`);
  await getFirestore().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const since = toMillis(snap.get('since'));
    const fresh = !since || Date.now() - since >= LIMITS.failWindowMs;
    tx.set(ref, {
      since: fresh ? Timestamp.now() : snap.get('since'),
      count: fresh ? 1 : (Number(snap.get('count')) || 0) + 1,
      // Some sozinho com a política de TTL em `couponAttempts.expireAt`.
      expireAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    });
  });
}

/**
 * Encerra, dentro da transação, as reservas que não valem mais: as vencidas
 * de qualquer pessoa e as abertas da própria pessoa (ela está reservando de
 * novo — a anterior foi abandonada). Devolve quantas vagas voltaram.
 */
async function sweepReservations(tx: Transaction, code: string, uid: string, now: number) {
  const db = getFirestore();
  const [open, mine] = await Promise.all([
    tx.get(db.collection(REDEMPTIONS).where('couponId', '==', code).where('status', '==', 'reserved').limit(200)),
    tx.get(db.collection(REDEMPTIONS).where('couponId', '==', code).where('uid', '==', uid).limit(100)),
  ]);
  const toClose = open.docs.filter(d => d.get('uid') === uid || toMillis(d.get('expiresAt')) <= now);
  const usedByMe = mine.docs.filter(d => d.get('status') === 'used').length;
  return { toClose, usedByMe };
}

// ------------------------------------------------------------------ cotação

/**
 * `POST couponQuote` — `{ action, code, items, shippingPrice, redemptionId? }`.
 * - `preview`: só calcula (o app mostra o desconto).
 * - `reserve`: calcula, confere os limites e segura um uso por 30 minutos.
 * - `release`: devolve uma reserva que a pessoa desistiu de usar.
 */
export const couponQuote = onRequest(couponRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const action = String(body['action'] ?? 'preview');
  const db = getFirestore();

  try {
    if (action === 'release') {
      const id = String(body['redemptionId'] ?? '');
      if (!/^[A-Za-z0-9]{20}$/.test(id)) throw new CouponError(400, 'Reserva inválida.');
      await db.runTransaction(async tx => {
        const ref = db.doc(`${REDEMPTIONS}/${id}`);
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get('uid') !== auth.uid || snap.get('status') !== 'reserved') return;
        tx.update(ref, { status: 'released', closedAt: FieldValue.serverTimestamp() });
        tx.update(db.doc(`${COUPONS}/${snap.get('couponId')}`), { redeemedCount: FieldValue.increment(-1) });
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (action !== 'preview' && action !== 'reserve') throw new CouponError(400, 'Ação inválida.');

    const code = normalizeCode(body['code']);
    if (!isValidCode(code)) throw new CouponError(400, 'Digite um código de cupom válido (letras e números).');

    const shippingPrice = money(body['shippingPrice'] ?? 0, 'Frete', { min: 0, max: 10_000 });

    await guardAttempts(auth.uid);
    const couponRef = db.doc(`${COUPONS}/${code}`);
    const first = await couponRef.get();
    if (!first.exists) {
      await countFailure(auth.uid);
      throw new CouponError(404, 'Cupom não encontrado. Confira as letras e os números.');
    }

    const lines = await loadCart(body['items']);
    const coupon = couponFrom(first);
    if (coupon.scope === 'seller' && coupon.sellerId === auth.uid) {
      throw new CouponError(409, 'Você não pode usar o cupom da sua própria loja.');
    }
    const preview = evaluateCoupon(coupon, lines, shippingPrice);

    if (coupon.firstPurchaseOnly && await hasPaidOrder(auth.uid)) {
      throw new CouponError(409, 'Este cupom é só para a primeira compra na Vineon.');
    }

    if (action === 'preview') {
      // Aviso adiantado do limite pessoal (a reserva confere de novo, na transação).
      const used = await db.collection(REDEMPTIONS)
        .where('couponId', '==', code).where('uid', '==', auth.uid).limit(100).get();
      if (used.docs.filter(d => d.get('status') === 'used').length >= coupon.perUserLimit) {
        throw new CouponError(409, coupon.perUserLimit === 1 ? 'Você já usou este cupom.' : `Você já usou este cupom ${coupon.perUserLimit} vezes, o máximo por pessoa.`);
      }
      res.status(200).json({ ok: true, quote: preview });
      return;
    }

    if (await isSuspended(auth.uid)) throw new CouponError(403, 'Sua conta está suspensa.');

    const now = Date.now();
    const redemptionRef = db.collection(REDEMPTIONS).doc();
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(couponRef);
      if (!snap.exists) throw new CouponError(404, 'Cupom não encontrado.');
      const current = couponFrom(snap);
      // Recalcula com o cupom lido DENTRO da transação: pode ter sido pausado agora.
      const quote = evaluateCoupon(current, lines, shippingPrice, now);
      const { toClose, usedByMe } = await sweepReservations(tx, code, auth.uid, now);

      if (usedByMe >= current.perUserLimit) {
        throw new CouponError(409, current.perUserLimit === 1 ? 'Você já usou este cupom.' : `Você já usou este cupom ${current.perUserLimit} vezes, o máximo por pessoa.`);
      }
      const inUse = Math.max(0, current.redeemedCount - toClose.length);
      if (current.usageLimit && inUse >= current.usageLimit) {
        throw new CouponError(409, 'Este cupom esgotou.');
      }

      for (const d of toClose) {
        tx.update(d.ref, {
          status: d.get('uid') === auth.uid ? 'released' : 'expired',
          closedAt: FieldValue.serverTimestamp(),
        });
      }
      const expiresAt = Timestamp.fromMillis(now + LIMITS.reserveMs);
      tx.set(redemptionRef, {
        couponId: code,
        code,
        uid: auth.uid,
        scope: quote.scope,
        sellerId: quote.sellerId,
        type: quote.type,
        discount: quote.discount,
        itemsDiscount: quote.itemsDiscount,
        shippingDiscount: quote.shippingDiscount,
        subtotal: quote.subtotal,
        shippingPrice,
        status: 'reserved',
        orderId: null,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
      });
      tx.update(couponRef, { redeemedCount: inUse + 1 });
      return { quote, expiresAt: expiresAt.toMillis() };
    });

    res.status(200).json({ ok: true, quote: result.quote, redemptionId: redemptionRef.id, expiresAt: result.expiresAt });
  } catch (error) {
    if (error instanceof CouponError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    logger.error('couponQuote falhou', { uid: auth.uid, action, error });
    res.status(500).json({ error: 'Não foi possível conferir o cupom agora. Tente de novo em instantes.' });
  }
});

// ------------------------------------------------------------- criar/editar

interface SaveInput {
  scope: Scope;
  type: CouponType;
  value: number;
  maxDiscount: number | null;
  minSubtotal: number;
  productIds: string[];
  startsAt: Timestamp;
  endsAt: Timestamp | null;
  usageLimit: number | null;
  perUserLimit: number;
  firstPurchaseOnly: boolean;
  visibility: Visibility;
}

async function readInput(body: Record<string, unknown>, scope: Scope, ownerId: string | null): Promise<SaveInput> {
  const type = String(body['type'] ?? '') as CouponType;
  if (!['percent', 'fixed', 'shipping'].includes(type)) throw new CouponError(400, 'Escolha o tipo de desconto.');
  if (scope === 'seller' && type === 'shipping') {
    throw new CouponError(400, 'Cupom de frete grátis é só da Vineon. Para a loja, use desconto em % ou em reais.');
  }

  const value = type === 'percent'
    ? int(body['value'], 'Porcentagem', 1, LIMITS.percentMax)
    : type === 'fixed'
      ? money(body['value'], 'Valor do desconto', { min: 1, max: LIMITS.fixedMax })
      // Frete: `value` é o teto do desconto; 0 = frete inteiro.
      : money(body['value'] ?? 0, 'Teto do frete', { min: 0, max: LIMITS.fixedMax });

  const maxDiscount = type === 'percent' ? optionalMoney(body['maxDiscount'], 'Desconto máximo') : null;
  const minSubtotal = money(body['minSubtotal'] ?? 0, 'Compra mínima', { min: 0, max: LIMITS.minSubtotalMax });
  if (type === 'fixed' && minSubtotal > 0 && value > minSubtotal) {
    throw new CouponError(400, 'O desconto não pode ser maior que a compra mínima.');
  }

  const now = Date.now();
  const startsMs = millis(body['startsAt']) ?? now;
  const endsMs = millis(body['endsAt']);
  if (endsMs !== null && endsMs <= Math.max(startsMs, now)) throw new CouponError(400, 'A data final precisa ser depois do início e de hoje.');
  if (endsMs !== null && endsMs - startsMs > LIMITS.durationMaxMs) throw new CouponError(400, 'Um cupom vale no máximo 1 ano.');
  if (endsMs === null && scope === 'seller') throw new CouponError(400, 'Defina até quando o cupom vale.');

  const usageRaw = body['usageLimit'];
  const usageLimit = usageRaw === null || usageRaw === undefined || usageRaw === '' || Number(usageRaw) === 0
    ? null
    : int(usageRaw, 'Quantidade de cupons', 1, LIMITS.usageMax);
  const perUserLimit = int(body['perUserLimit'] ?? 1, 'Usos por pessoa', 1, LIMITS.perUserMax);
  const visibility: Visibility = body['visibility'] === 'private' ? 'private' : 'public';
  const firstPurchaseOnly = scope === 'platform' && body['firstPurchaseOnly'] === true;

  let productIds: string[] = [];
  if (scope === 'seller' && Array.isArray(body['productIds']) && body['productIds'].length) {
    productIds = [...new Set(body['productIds'].map(String))];
    if (productIds.length > LIMITS.productIdsMax) throw new CouponError(400, `Escolha até ${LIMITS.productIdsMax} produtos.`);
    const db = getFirestore();
    const snaps = await db.getAll(...productIds.map(id => db.doc(`products/${id}`)));
    if (snaps.some(s => !s.exists || s.get('sellerId') !== ownerId)) {
      throw new CouponError(400, 'Só dá para escolher produtos da sua loja.');
    }
  }

  return {
    scope,
    type,
    value,
    maxDiscount,
    minSubtotal,
    productIds,
    startsAt: Timestamp.fromMillis(startsMs),
    endsAt: endsMs === null ? null : Timestamp.fromMillis(endsMs),
    usageLimit,
    perUserLimit,
    firstPurchaseOnly,
    visibility,
  };
}

async function shopNameOf(uid: string): Promise<string | null> {
  const db = getFirestore();
  const [seller, user] = await Promise.all([db.doc(`sellers/${uid}`).get(), db.doc(`users/${uid}`).get()]);
  const name = seller.get('shopName') || user.get('shopName') || seller.get('displayName') || user.get('displayName');
  return name ? String(name).slice(0, 60) : null;
}

/**
 * `POST saveCoupon` — `{ action: 'create' | 'update' | 'status' | 'delete', code, ... }`.
 * Admin cria cupom da Vineon e pausa/encerra qualquer cupom (moderação). Loja
 * cria e mexe só nos dela. Apagar só cupom nunca usado; usado se encerra.
 */
export const saveCoupon = onRequest(couponRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const action = String(body['action'] ?? '');
  const isAdmin = auth.isTokenAdmin === true || isBootstrapAdminEmail(auth.email);
  const db = getFirestore();

  try {
    const code = normalizeCode(body['code']);
    if (!isValidCode(code)) {
      throw new CouponError(400, `O código precisa ter de ${LIMITS.codeMin} a ${LIMITS.codeMax} letras ou números, sem espaço.`);
    }
    const ref = db.doc(`${COUPONS}/${code}`);

    if (action === 'create') {
      // Admin cria pela Vineon; `asSeller` deixa o admin testar como loja.
      const scope: Scope = isAdmin && body['asSeller'] !== true ? 'platform' : 'seller';
      if (scope === 'seller' && await isSuspended(auth.uid)) throw new CouponError(403, 'Sua conta está suspensa.');
      const ownerId = scope === 'seller' ? auth.uid : null;
      const input = await readInput(body, scope, ownerId);

      if (scope === 'seller') {
        const mine = await db.collection(COUPONS).where('sellerId', '==', auth.uid).limit(100).get();
        if (mine.docs.filter(d => d.get('status') === 'active').length >= LIMITS.sellerActiveMax) {
          throw new CouponError(409, `Sua loja já tem ${LIMITS.sellerActiveMax} cupons ativos. Encerre um antes de criar outro.`);
        }
      }

      const sellerName = scope === 'seller' ? await shopNameOf(auth.uid) : null;
      await db.runTransaction(async tx => {
        if ((await tx.get(ref)).exists) throw new CouponError(409, 'Já existe um cupom com esse código. Escolha outro.');
        tx.set(ref, {
          code,
          ...input,
          sellerId: ownerId,
          sellerName,
          status: 'active',
          redeemedCount: 0,
          ordersCount: 0,
          discountTotal: 0,
          createdBy: auth.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: auth.uid,
        });
      });
      res.status(200).json({ ok: true, code });
      return;
    }

    const snap = await ref.get();
    if (!snap.exists) throw new CouponError(404, 'Cupom não encontrado.');
    const coupon = couponFrom(snap);
    const isOwner = coupon.scope === 'seller' && coupon.sellerId === auth.uid;
    // Admin edita os da Vineon; nos das lojas ele só pausa/encerra.
    const canEdit = isOwner || (isAdmin && coupon.scope === 'platform');
    const canModerate = canEdit || isAdmin;

    if (action === 'update') {
      if (!canEdit) throw new CouponError(403, 'Você não pode editar este cupom.');
      if (coupon.status === 'ended') throw new CouponError(409, 'Cupom encerrado não volta. Crie um novo.');
      const input = await readInput(body, coupon.scope, coupon.sellerId);
      if (input.usageLimit && input.usageLimit < coupon.redeemedCount) {
        throw new CouponError(400, `Este cupom já tem ${coupon.redeemedCount} usos; a quantidade não pode ser menor que isso.`);
      }
      // Quem já usou, usou com a regra da época: o pedido guarda o desconto dado.
      await ref.update({
        ...input,
        ...(coupon.scope === 'seller' ? { sellerName: await shopNameOf(coupon.sellerId!) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      });
      res.status(200).json({ ok: true, code });
      return;
    }

    if (action === 'status') {
      if (!canModerate) throw new CouponError(403, 'Você não pode mudar este cupom.');
      const status = String(body['status'] ?? '') as CouponStatus;
      if (!['active', 'paused', 'ended'].includes(status)) throw new CouponError(400, 'Status inválido.');
      if (coupon.status === 'ended') throw new CouponError(409, 'Cupom encerrado não volta. Crie um novo.');
      // Loja não reativa cupom que a Vineon pausou.
      if (status === 'active' && !isAdmin && snap.get('pausedByAdmin') === true) {
        throw new CouponError(403, 'Este cupom foi pausado pela Vineon. Fale com a gente pelo atendimento.');
      }
      if (status === 'active' && coupon.endsAt && toMillis(coupon.endsAt) <= Date.now()) {
        throw new CouponError(409, 'Este cupom já venceu. Mude a data final antes de reativar.');
      }
      await ref.update({
        status,
        pausedByAdmin: status === 'paused' && isAdmin && !isOwner && coupon.scope === 'seller',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      });
      res.status(200).json({ ok: true, code, status });
      return;
    }

    if (action === 'delete') {
      if (!canEdit) throw new CouponError(403, 'Você não pode apagar este cupom.');
      const any = await db.collection(REDEMPTIONS).where('couponId', '==', code).limit(1).get();
      if (!any.empty || coupon.redeemedCount > 0) {
        throw new CouponError(409, 'Este cupom já foi usado e fica no histórico. Encerre-o em vez de apagar.');
      }
      await ref.delete();
      res.status(200).json({ ok: true, code });
      return;
    }

    throw new CouponError(400, 'Ação inválida.');
  } catch (error) {
    if (error instanceof CouponError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    logger.error('saveCoupon falhou', { uid: auth.uid, action, error });
    res.status(500).json({ error: 'Não foi possível salvar o cupom agora. Tente de novo em instantes.' });
  }
});

// ----------------------------------------------------- pedido usa / devolve

/**
 * Pedido criado com `coupon`: a reserva vira uso. Pedido cancelado: o uso
 * volta para a pessoa e para o limite do cupom. `couponCheck` é do servidor
 * (a regra recusa o cliente escrevendo nele).
 */
export const onOrderWrittenCoupon = onDocumentWritten(
  { document: 'orders/{orderId}', region, maxInstances: 2 },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!after?.['coupon']) return;

    const db = getFirestore();
    const orderId = event.params.orderId;
    const orderRef = db.doc(`orders/${orderId}`);
    const coupon = after['coupon'] as Record<string, unknown>;
    const redemptionId = String(coupon['redemptionId'] ?? '');
    if (!/^[A-Za-z0-9]{20}$/.test(redemptionId)) {
      if (!after['couponCheck']) await orderRef.update({ couponCheck: 'invalid', couponCheckReason: 'REDEMPTION_INVALID' });
      return;
    }
    const redemptionRef = db.doc(`${REDEMPTIONS}/${redemptionId}`);

    // 1) Pedido novo: consome a reserva.
    if (!after['couponCheck']) {
      await db.runTransaction(async tx => {
        const [order, redemption] = await Promise.all([tx.get(orderRef), tx.get(redemptionRef)]);
        if (!order.exists || order.get('couponCheck')) return;
        const r = redemption.data();
        const couponRef = db.doc(`${COUPONS}/${String(r?.['couponId'] ?? coupon['code'])}`);
        const createdMs = toMillis(order.get('createdAt')) || Date.now();

        let reason: string | null = null;
        if (!r) reason = 'REDEMPTION_NOT_FOUND';
        else if (r['uid'] !== order.get('userId')) reason = 'OWNER_MISMATCH';
        else if (Number(r['discount']) !== Number(coupon['discount'])) reason = 'DISCOUNT_MISMATCH';
        else if (r['status'] === 'used') reason = r['orderId'] === orderId ? null : 'ALREADY_USED';
        else if (r['status'] === 'expired' && createdMs > toMillis(r['expiresAt'])) reason = 'EXPIRED';
        else if (r['status'] !== 'reserved' && r['status'] !== 'expired') reason = 'RELEASED';

        if (reason) {
          logger.warn('Pedido com cupom inválido', { orderId, redemptionId, reason });
          tx.update(orderRef, { couponCheck: 'invalid', couponCheckReason: reason });
          return;
        }
        if (r!['status'] !== 'used') {
          tx.update(redemptionRef, { status: 'used', orderId, usedAt: FieldValue.serverTimestamp() });
          tx.update(couponRef, {
            ordersCount: FieldValue.increment(1),
            discountTotal: FieldValue.increment(Number(r!['discount']) || 0),
            // Reserva que a varredura já tinha encerrado volta a contar.
            ...(r!['status'] === 'expired' ? { redeemedCount: FieldValue.increment(1) } : {}),
          });
        }
        tx.update(orderRef, { couponCheck: 'ok' });
      });
      return;
    }

    // 2) Pedido cancelado: devolve o uso.
    const cancelled = after['status'] === 'CANCELLED' && before?.['status'] !== 'CANCELLED';
    if (!cancelled || after['couponCheck'] !== 'ok') return;
    await db.runTransaction(async tx => {
      const redemption = await tx.get(redemptionRef);
      if (redemption.get('status') !== 'used' || redemption.get('orderId') !== orderId) return;
      tx.update(redemptionRef, { status: 'cancelled', closedAt: FieldValue.serverTimestamp() });
      tx.update(db.doc(`${COUPONS}/${redemption.get('couponId')}`), {
        redeemedCount: FieldValue.increment(-1),
        ordersCount: FieldValue.increment(-1),
        discountTotal: FieldValue.increment(-(Number(redemption.get('discount')) || 0)),
      });
    });
  },
);
