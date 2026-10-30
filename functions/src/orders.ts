import { FieldValue, Timestamp, getFirestore, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { MIN_ORDER_TOTAL, REDEMPTIONS } from './coupons';
import { ensureAsaasCustomer, requestAsaas } from './payments/asaas';
import { CORA_CHARGES, applyCoraInvoiceToOrder, presentInvoice } from './payments/cora';
import { CoraInvoice, cancelCoraInvoice, getCoraInvoice, isCoraSandbox, requestCora } from './payments/cora-client';
import { defaultRuntime, handleCors, isAdminUser, methodNotAllowed, region, requireAuthenticated } from './shared/http';
import { MELHOR_ENVIO_SERVICES, getMelhorEnvioConfig, melhorEnvioPackage, requestMelhorEnvio } from './shared/melhor-envio';
import { LOCAL_DELIVERY_SERVICE, planDelivery, readLocalDelivery } from './local-delivery';

/**
 * Fechamento do pedido — tudo no servidor.
 * ----------------------------------------------------------------------------
 * Antes, o navegador calculava o total, emitia a cobrança com esse valor e
 * gravava o pedido (com os preços que quisesse em `items`). O webhook conferia
 * "pago == total do pedido", mas os dois números vinham do mesmo navegador:
 * dava para levar um produto de R$ 500 pagando R$ 5.
 *
 * Agora o app manda só O QUE quer comprar (produto, variação, quantidade), o
 * endereço, a forma de entrega escolhida e o cupom reservado. `placeOrder`:
 *   1. lê os produtos e calcula o preço de AGORA (o mesmo de `couponQuote`);
 *   2. confere estoque, anúncio no ar e que ninguém compra de si mesmo;
 *   3. recota o frete no Melhor Envio e aplica a regra de frete grátis (ou
 *      confere que a própria loja entrega nesse endereço — local-delivery.ts);
 *   4. confere a reserva do cupom contra esse carrinho e esse frete;
 *   5. emite a cobrança (Cora: Pix/boleto; Asaas: cartão) com esse total;
 *   6. grava o pedido pelo Admin SDK (o cliente não cria mais `orders/`).
 *
 * Se o total calculado não bater com o que a pessoa viu (`expectedTotal`), a
 * compra para com 409 e o app mostra o valor novo — ninguém paga um número que
 * não viu.
 *
 * Estoque e "vendidos" mudam quando o pagamento é confirmado
 * (`applyOrderInventory`, chamado pelo gatilho `onOrderWrittenInventory`) e
 * voltam se o pedido for cancelado ou estornado depois disso.
 */

const ORDERS = 'orders';
const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'];

const LIMITS = {
  linesMax: 50,
  quantityMax: 999,
  /** Pedidos esperando pagamento ao mesmo tempo, por pessoa. */
  pendingMax: 10,
  /** Pix e boleto vencem em 3 dias (o app mostra isso em "A pagar"). */
  dueDays: 3,
  /** Sem pagamento depois disso, o pedido é cancelado sozinho. */
  expireAfterMs: 4 * 24 * 60 * 60 * 1000,
} as const;

export const orderRuntime = { ...defaultRuntime, maxInstances: 3, timeoutSeconds: 90 } as const;

class OrderError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const cents = (value: number) => Math.round(value * 100) / 100;
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const digitsOf = (value: unknown) => String(value ?? '').replace(/\D/g, '');

function brl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ------------------------------------------------------------ CPF / CNPJ

export function isValidCpf(value: string): boolean {
  const d = digitsOf(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

export function isValidCnpj(value: string): boolean {
  const d = digitsOf(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

// ------------------------------------------------------------- preço/estoque

interface WantedLine {
  productId: string;
  skuId: string | null;
  quantity: number;
}

interface PricedLine extends WantedLine {
  product: DocumentData;
  sellerId: string;
  unitPrice: number;
  listPrice: number;
  promoPrice: number | null;
  variantLabel: string | null;
  variantSelection: Record<string, string> | null;
}

function readWanted(raw: unknown): WantedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new OrderError(400, 'Seu carrinho está vazio.');
  if (raw.length > LIMITS.linesMax) throw new OrderError(400, 'Carrinho grande demais para um pedido só.');
  return raw.map(item => {
    const r = (item || {}) as Record<string, unknown>;
    const productId = String(r['productId'] ?? '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) throw new OrderError(400, 'Produto inválido no carrinho.');
    const skuId = typeof r['skuId'] === 'string' && r['skuId'] ? String(r['skuId']).slice(0, 200) : null;
    const quantity = Number(r['quantity']);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > LIMITS.quantityMax) {
      throw new OrderError(400, 'Quantidade inválida no carrinho.');
    }
    return { productId, skuId, quantity };
  });
}

/**
 * Preço de agora, a mesma conta de `loadCart` (coupons.ts) e de `priceMain` no
 * app: variação com preço próprio > promocional válido > cheio.
 */
async function priceLines(wanted: WantedLine[], buyerUid: string): Promise<PricedLine[]> {
  const db = getFirestore();
  const ids = [...new Set(wanted.map(w => w.productId))];
  const snaps = await db.getAll(...ids.map(id => db.doc(`products/${id}`)));
  const products = new Map(snaps.map(s => [s.id, s] as [string, DocumentSnapshot]));

  // Soma por produto/variação: duas linhas do mesmo item contam juntas no estoque.
  const demand = new Map<string, number>();
  for (const w of wanted) {
    const key = `${w.productId}::${w.skuId ?? ''}`;
    demand.set(key, (demand.get(key) ?? 0) + w.quantity);
  }

  return wanted.map(w => {
    const snap = products.get(w.productId);
    const p = snap?.exists ? snap.data() || {} : null;
    if (!p) throw new OrderError(409, 'Um produto do carrinho não está mais à venda. Atualize o carrinho.');
    const name = text(p['name'], 120) || 'Produto';
    if (p['moderation']?.hidden === true) throw new OrderError(409, `"${name}" não está mais à venda. Tire do carrinho para continuar.`);
    const sellerId = String(p['sellerId'] || '');
    if (!sellerId) throw new OrderError(409, `"${name}" não está disponível. Tire do carrinho para continuar.`);
    if (sellerId === buyerUid) throw new OrderError(409, `"${name}" é um anúncio seu. Não dá para comprar o próprio produto.`);

    const price = Number(p['price']) || 0;
    const promo = Number(p['priceDiscounted']) || 0;
    const hasPromo = promo > 0 && price > 0 && promo < price;
    const main = hasPromo ? promo : price;

    let unitPrice = main;
    let listPrice = price;
    let promoPrice: number | null = hasPromo ? promo : null;
    let variantLabel: string | null = null;
    let variantSelection: Record<string, string> | null = null;
    let available = Number(p['stock']);

    if (p['hasVariants'] === true) {
      const sku = w.skuId ? p['skus']?.[w.skuId] : null;
      if (!sku) throw new OrderError(409, `A opção escolhida de "${name}" não existe mais. Escolha de novo no anúncio.`);
      const skuPrice = typeof sku.price === 'number' && sku.price > 0 ? sku.price : null;
      unitPrice = skuPrice ?? main;
      // Como o carrinho grava: preço da combinação, sem "de/por".
      listPrice = unitPrice;
      promoPrice = null;
      available = Number(sku.stock);
      const names: string[] = Array.isArray(p['variantAttributes']) ? p['variantAttributes'].map((a: any) => String(a?.name || '')) : [];
      const attrs = (sku.attributes || {}) as Record<string, string>;
      variantSelection = Object.fromEntries(names.filter(n => attrs[n]).map(n => [n, String(attrs[n])]));
      variantLabel = names.filter(n => attrs[n]).map(n => `${n}: ${attrs[n]}`).join(' · ') || null;
    } else if (w.skuId) {
      throw new OrderError(409, `"${name}" mudou desde que foi para o carrinho. Tire e adicione de novo.`);
    }

    if (!(unitPrice > 0)) throw new OrderError(409, `"${name}" está sem preço. Tire do carrinho para continuar.`);

    // Estoque sem número (anúncio antigo) não trava a compra.
    const wantedQty = demand.get(`${w.productId}::${w.skuId ?? ''}`) ?? w.quantity;
    if (Number.isFinite(available) && wantedQty > available) {
      throw new OrderError(409, available > 0
        ? `"${name}" tem só ${available} em estoque. Ajuste a quantidade no carrinho.`
        : `"${name}" esgotou. Tire do carrinho para continuar.`);
    }

    return { ...w, product: p, sellerId, unitPrice: cents(unitPrice), listPrice: cents(listPrice), promoPrice, variantLabel, variantSelection };
  });
}

/** Retrato do item no pedido — o mesmo formato de `CartItem` no app. */
function itemSnapshot(line: PricedLine) {
  const p = line.product;
  const photos: string[] = Array.isArray(p['photoURL']) ? p['photoURL'].filter((u: unknown) => typeof u === 'string') : [];
  // Variação com foto própria: ela vai na frente (é o que a pessoa escolheu).
  const firstAttr = Array.isArray(p['variantAttributes']) ? String(p['variantAttributes'][0]?.name || '') : '';
  const optionPhoto = firstAttr && line.variantSelection ? p['variantImages']?.[line.variantSelection[firstAttr]] : null;
  const photoURL = typeof optionPhoto === 'string' ? [optionPhoto, ...photos.filter(u => u !== optionPhoto)] : photos;

  return {
    productId: line.productId,
    skuId: line.skuId,
    variantLabel: line.variantLabel,
    variantSelection: line.variantSelection,
    quantity: line.quantity,
    addedAt: Timestamp.now(),
    productData: {
      id: line.productId,
      name: text(p['name'], 200),
      price: line.listPrice,
      priceDiscounted: line.promoPrice,
      photoURL: photoURL.slice(0, 12),
      condition: p['condition'] ?? null,
      stock: Number.isFinite(Number(p['stock'])) ? Number(p['stock']) : null,
      shipping: p['shipping'] ?? null,
      localDelivery: readLocalDelivery(p['localDelivery']),
      paymentMethods: Array.isArray(p['paymentMethods']) ? p['paymentMethods'] : [],
      categoryIds: Array.isArray(p['categoryIds']) ? p['categoryIds'] : [],
      subcategoryIds: Array.isArray(p['subcategoryIds']) ? p['subcategoryIds'] : [],
      sellerId: line.sellerId,
      // Medidas reais vão para a etiqueta (antes saía sempre 10 x 15 x 10 cm).
      weight: Number(p['weight']) || null,
      width: Number(p['width']) || null,
      height: Number(p['height']) || null,
      length: Number(p['length']) || null,
    },
  };
}

// ------------------------------------------------------------------- frete

interface ShippingChoice {
  /** `null` na entrega da loja (não há serviço do Melhor Envio nem etiqueta). */
  serviceId: number | null;
  serviceName: string;
  quotedPrice: number;
  price: number;
  freeShipping: boolean;
  deliveryTime: number;
  localDelivery: boolean;
  /**
   * Parte da etiqueta que cada loja paga (sai do repasse): só quando o frete
   * grátis é escolha da loja ("Frete Grátis" no anúncio). Frete grátis da
   * Vineon (regra por valor, cupom de frete) a Vineon banca.
   */
  sellerShippingCost: Record<string, number>;
}

/** Regra de frete grátis da loja (`appConfig/storefront.freeShipping`). */
async function freeShippingRule(): Promise<number | null> {
  const snap = await getFirestore().doc('appConfig/storefront').get();
  const rule = snap.get('freeShipping') || {};
  const min = Number(rule.minValue) || 0;
  return rule.enabled === true && min > 0 ? min : null;
}

/**
 * Recota no Melhor Envio com as medidas de `products/` (as mesmas que o app
 * manda para `calculateMelhorEnvioShipping`) e pega o serviço escolhido.
 * Frete grátis quando TODOS os itens têm (do vendedor ou pela regra da loja),
 * como `CheckoutShippingComponent.freeShipping`.
 */
async function quoteShipping(lines: PricedLine[], zipTo: string, serviceId: number): Promise<ShippingChoice> {
  const config = await getMelhorEnvioConfig();
  if (!config?.address?.zipCode) throw new OrderError(503, 'Entrega indisponível no momento. Tente de novo em instantes.');

  const payload = {
    from: { postal_code: digitsOf(config.address.zipCode) },
    to: { postal_code: zipTo },
    services: MELHOR_ENVIO_SERVICES,
    products: lines.map(l => ({
      id: l.productId.substring(0, 50),
      ...melhorEnvioPackage(l.product),
      insurance_value: l.unitPrice,
      quantity: l.quantity,
    })),
  };

  let quotes: any[];
  try {
    const data = await requestMelhorEnvio('/api/v2/me/shipment/calculate', { method: 'POST', body: payload });
    quotes = Array.isArray(data) ? data : [];
  } catch (error) {
    logger.error('placeOrder: cotação do Melhor Envio falhou', { error: error instanceof Error ? error.message : error });
    throw new OrderError(502, 'Não conseguimos confirmar o frete agora. Tente de novo em instantes.');
  }

  const quote = quotes.find(q => Number(q?.id) === serviceId && !q?.error);
  if (!quote) throw new OrderError(409, 'A forma de entrega escolhida não está mais disponível. Volte e escolha outra.', { reason: 'SHIPPING_UNAVAILABLE' });
  const quotedPrice = cents(parseFloat(String(quote.price)) || 0);

  const rule = await freeShippingRule();
  const byVineon = (l: PricedLine) => rule !== null && l.unitPrice >= rule;
  const freeShipping = lines.every(l => l.product['shipping'] === 'Frete Grátis' || byVineon(l));

  return {
    serviceId,
    serviceName: text(`${quote.company?.name || ''} - ${quote.name || ''}`, 80),
    quotedPrice,
    price: freeShipping ? 0 : quotedPrice,
    freeShipping,
    deliveryTime: Number(quote.delivery_time) || 0,
    localDelivery: false,
    // Quando a Vineon também daria o frete grátis ao item, a Vineon paga.
    sellerShippingCost: freeShipping ? splitShippingCost(lines, quotedPrice, l => !byVineon(l)) : {},
  };
}

/**
 * Divide o custo da etiqueta entre os itens pelo valor de cada um e soma, por
 * loja, a parte dos itens que ela paga. Arredonda para baixo: a soma nunca
 * passa do custo (o centavo que sobra fica com a Vineon).
 */
export function splitShippingCost(lines: PricedLine[], cost: number, sellerPays: (l: PricedLine) => boolean): Record<string, number> {
  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  if (!(cost > 0) || !(total > 0)) return {};
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (!sellerPays(l)) continue;
    out[l.sellerId] = (out[l.sellerId] ?? 0) + (cost * l.unitPrice * l.quantity) / total;
  }
  for (const id of Object.keys(out)) out[id] = Math.floor(out[id] * 100) / 100;
  return out;
}

/**
 * Entrega da loja (`serviceId === null`) ou transportadora, conferindo o que o
 * carrinho permite neste endereço (`planDelivery`, mesma regra do app): a loja
 * só entrega de graça onde disse que entrega, e item "só entrega da loja" não
 * vai por transportadora.
 */
async function chooseShipping(lines: PricedLine[], address: Address, serviceId: number | null): Promise<ShippingChoice> {
  const plan = planDelivery(
    lines.map(l => ({ name: text(l.product['name'], 120) || 'Produto', sellerId: l.sellerId, localDelivery: l.product['localDelivery'] })),
    address.city,
    address.state,
  );
  if (plan.blocked) throw new OrderError(409, plan.blocked, { reason: 'SHIPPING_UNAVAILABLE' });

  if (serviceId === null) {
    if (!plan.local) {
      throw new OrderError(409, 'A entrega da loja não atende este endereço. Volte e escolha outra forma de entrega.', { reason: 'SHIPPING_UNAVAILABLE' });
    }
    return {
      serviceId: null,
      serviceName: 'Entrega da loja',
      quotedPrice: 0,
      price: 0,
      freeShipping: true,
      deliveryTime: plan.local.days,
      localDelivery: true,
      sellerShippingCost: {},
    };
  }
  if (!plan.carrier) {
    throw new OrderError(409, 'Este pedido é entregue pela própria loja. Volte e escolha a entrega da loja.', { reason: 'SHIPPING_UNAVAILABLE' });
  }
  return quoteShipping(lines, address.postalCode, serviceId);
}

// ------------------------------------------------------------------- cupom

async function readCoupon(redemptionId: unknown, uid: string, subtotal: number, shippingPrice: number) {
  if (redemptionId === undefined || redemptionId === null || redemptionId === '') return null;
  const id = String(redemptionId);
  if (!/^[A-Za-z0-9]{20}$/.test(id)) throw new OrderError(400, 'Reserva de cupom inválida.');
  const snap = await getFirestore().doc(`${REDEMPTIONS}/${id}`).get();
  const r = snap.data();
  const expiresAt = r?.['expiresAt'] instanceof Timestamp ? r['expiresAt'].toMillis() : 0;
  if (!r || r['uid'] !== uid || r['status'] !== 'reserved' || expiresAt <= Date.now()) {
    throw new OrderError(409, 'A reserva do cupom expirou. Aplique o cupom de novo.', { reason: 'COUPON_EXPIRED' });
  }
  // O desconto foi calculado para um carrinho e um frete: tem que ser este.
  if (Math.abs(Number(r['subtotal']) - subtotal) > 0.009 || Math.abs(Number(r['shippingPrice']) - shippingPrice) > 0.009) {
    throw new OrderError(409, 'O carrinho ou o frete mudou depois que o cupom foi aplicado. Aplique o cupom de novo.', { reason: 'COUPON_STALE' });
  }
  return {
    redemptionId: id,
    code: String(r['code']),
    scope: r['scope'] === 'seller' ? 'seller' : 'platform',
    sellerId: r['sellerId'] ?? null,
    type: r['type'],
    discount: Number(r['discount']) || 0,
    itemsDiscount: Number(r['itemsDiscount']) || 0,
    shippingDiscount: Number(r['shippingDiscount']) || 0,
  };
}

// ---------------------------------------------------------------- cobrança

function dueDateBrt(days: number): string {
  const now = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

interface Buyer { name: string; cpf: string; phone: string; email: string }
interface Address { street: string; number: string; complement: string; neighborhood: string; city: string; state: string; postalCode: string }

async function chargeCora(method: 'PIX' | 'BOLETO', total: number, orderId: string, buyer: Buyer, address: Address) {
  const doc = digitsOf(buyer.cpf);
  const invoice = await requestCora<CoraInvoice>('POST', '/v2/invoices', {
    customer: {
      name: buyer.name.slice(0, 60),
      ...(buyer.email && buyer.email.length <= 60 ? { email: buyer.email } : {}),
      document: { identity: doc, type: doc.length === 11 ? 'CPF' : 'CNPJ' },
      address: {
        street: address.street,
        number: address.number || 'S/N',
        district: address.neighborhood || 'Centro',
        city: address.city,
        state: address.state,
        complement: address.complement || 'N/A',
        zip_code: address.postalCode,
      },
    },
    services: [{
      name: 'Pedido Vineon',
      description: `Pedido ${orderId.slice(0, 8).toUpperCase()} na Vineon`.slice(0, 100),
      amount: Math.round(total * 100),
    }],
    payment_terms: { due_date: dueDateBrt(LIMITS.dueDays) },
    // Fatura só com PIX volta REC-0030 no Cora: sempre boleto + PIX (ver cora.ts).
    payment_forms: ['BANK_SLIP', 'PIX'],
  });
  return invoice;
}

interface CardInput {
  holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string;
}

async function chargeCard(uid: string, total: number, orderId: string, buyer: Buyer, address: Address, card: CardInput, remoteIp: string) {
  const customer = await ensureAsaasCustomer(uid, { name: buyer.name, cpfCnpj: buyer.cpf, email: buyer.email, phone: buyer.phone });
  const payment = await requestAsaas('/payments', {
    method: 'POST',
    body: {
      customer,
      billingType: 'CREDIT_CARD',
      value: total,
      dueDate: dueDateBrt(0),
      description: `Pedido ${orderId.slice(0, 8).toUpperCase()} na Vineon`,
      // `getAsaasPayment` confere o dono por aqui.
      externalReference: uid,
      creditCard: card,
      creditCardHolderInfo: {
        name: buyer.name,
        email: buyer.email,
        cpfCnpj: digitsOf(buyer.cpf),
        postalCode: address.postalCode,
        addressNumber: address.number,
        phone: digitsOf(buyer.phone),
      },
      remoteIp,
    },
  }) as { id: string; status: string };
  return payment;
}

function readCard(raw: unknown): CardInput {
  const c = (raw || {}) as Record<string, unknown>;
  const card = {
    holderName: text(c['holderName'], 80),
    number: digitsOf(c['number']).slice(0, 19),
    expiryMonth: digitsOf(c['expiryMonth']).slice(0, 2),
    expiryYear: digitsOf(c['expiryYear']).slice(0, 4),
    ccv: digitsOf(c['ccv']).slice(0, 4),
  };
  if (!card.holderName || card.number.length < 13 || !card.expiryMonth || card.expiryYear.length !== 4 || card.ccv.length < 3) {
    throw new OrderError(400, 'Confira os dados do cartão.');
  }
  return card;
}

function readBuyer(raw: unknown, email: string): Buyer {
  const b = (raw || {}) as Record<string, unknown>;
  const name = text(b['name'], 120);
  const cpf = digitsOf(b['cpf']);
  const phone = digitsOf(b['phone']);
  if (name.length < 3) throw new OrderError(400, 'Informe o nome completo de quem compra.');
  if (!(isValidCpf(cpf) || isValidCnpj(cpf))) throw new OrderError(400, 'CPF inválido. Confira os números em "Dados do comprador".');
  if (phone.length < 10 || phone.length > 11) throw new OrderError(400, 'Informe um celular com DDD.');
  return { name, cpf, phone, email };
}

function readAddress(raw: unknown): Address {
  const a = (raw || {}) as Record<string, unknown>;
  const address = {
    street: text(a['street'], 120),
    number: text(a['number'] ?? a['addressNumber'], 20),
    complement: text(a['complement'], 60),
    neighborhood: text(a['neighborhood'], 80),
    city: text(a['city'], 80),
    state: text(a['state'], 2).toUpperCase(),
    postalCode: digitsOf(a['postalCode']).slice(0, 8),
  };
  if (address.postalCode.length !== 8) throw new OrderError(400, 'CEP de entrega inválido.');
  if (!address.street || !address.number || !address.city || !/^[A-Z]{2}$/.test(address.state)) {
    throw new OrderError(400, 'Endereço de entrega incompleto. Confira rua, número, cidade e UF.');
  }
  return address;
}

// ------------------------------------------------------------- placeOrder

/**
 * `POST placeOrder` — `{ items, shippingServiceId, address, buyer, method,
 * couponRedemptionId?, card?, expectedTotal? }`.
 * Devolve `{ orderId, total, method, charge }`.
 */
export const placeOrder = onRequest(orderRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const db = getFirestore();

  try {
    if ((await db.doc(`accountSuspensions/${auth.uid}`).get()).exists) {
      throw new OrderError(403, 'Sua conta está suspensa. Fale com a Vineon pelo atendimento.');
    }

    const method = String(body['method'] ?? '');
    if (method !== 'PIX' && method !== 'BOLETO' && method !== 'CREDIT_CARD') {
      throw new OrderError(400, 'Escolha a forma de pagamento.');
    }
    // Número = serviço do Melhor Envio; 'local' = entrega da própria loja.
    const rawService = body['shippingServiceId'];
    const serviceId = rawService === LOCAL_DELIVERY_SERVICE ? null : Number(rawService);
    if (serviceId !== null && (!Number.isInteger(serviceId) || serviceId <= 0)) throw new OrderError(400, 'Escolha a forma de entrega.');

    const buyer = readBuyer(body['buyer'], text(auth.email, 120));
    const address = readAddress(body['address']);
    const card = method === 'CREDIT_CARD' ? readCard(body['card']) : null;

    // Teto de pedidos esperando pagamento: cada pedido emite uma cobrança real.
    const pending = await db.collection(ORDERS).where('userId', '==', auth.uid).where('status', '==', 'PENDING')
      .limit(LIMITS.pendingMax).get();
    if (pending.size >= LIMITS.pendingMax) {
      throw new OrderError(429, 'Você tem muitos pedidos esperando pagamento. Pague ou cancele algum em Minhas compras antes de fazer outro.');
    }

    const lines = await priceLines(readWanted(body['items']), auth.uid);
    const subtotal = cents(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0));
    const shipping = await chooseShipping(lines, address, serviceId);
    const coupon = await readCoupon(body['couponRedemptionId'], auth.uid, subtotal, shipping.price);
    const discount = coupon?.discount ?? 0;
    const total = cents(subtotal + shipping.price - discount);

    if (!(total > 0)) throw new OrderError(400, 'Valor do pedido inválido.');
    if (method !== 'CREDIT_CARD' && total < MIN_ORDER_TOTAL) {
      throw new OrderError(400, `Pix e boleto aceitam compras a partir de ${brl(MIN_ORDER_TOTAL)}.`);
    }

    const expected = Number(body['expectedTotal']);
    if (Number.isFinite(expected) && Math.abs(expected - total) > 0.009) {
      throw new OrderError(409, `O total do pedido mudou para ${brl(total)} (preço, frete ou estoque atualizados). Confira e finalize de novo.`, {
        reason: 'TOTAL_CHANGED', total, subtotal, shipping: shipping.price, discount,
      });
    }

    const orderRef = db.collection(ORDERS).doc();
    const sellerIds = [...new Set(lines.map(l => l.sellerId))];

    // Cobrança primeiro, pedido depois: se a cobrança falhar, não fica pedido
    // fantasma (nem cupom gasto). Se o pedido falhar, a cobrança é desfeita.
    let charge: ReturnType<typeof presentInvoice> | null = null;
    let paymentRef: Record<string, unknown>;
    let cardStatus: string | null = null;

    if (method === 'CREDIT_CARD') {
      const payment = await chargeCard(auth.uid, total, orderRef.id, buyer, address, card!, req.ip || '');
      cardStatus = payment.status;
      paymentRef = { paymentProvider: 'asaas', asaasPaymentId: payment.id };
    } else {
      const invoice = await chargeCora(method, total, orderRef.id, buyer, address);
      charge = presentInvoice(invoice);
      paymentRef = {
        paymentProvider: 'cora',
        coraInvoiceId: invoice.id,
        coraPayment: {
          pixCode: charge.pixCode,
          bankSlipUrl: charge.bankSlipUrl,
          digitableLine: charge.digitableLine,
          sandbox: charge.sandbox,
        },
      };
      await db.doc(`${CORA_CHARGES}/${invoice.id}`).set({
        uid: auth.uid,
        orderId: orderRef.id,
        billingType: method,
        amountCents: Math.round(total * 100),
        invoiceStatus: invoice.status,
        sandbox: isCoraSandbox(),
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    try {
      await orderRef.create({
        userId: auth.uid,
        items: lines.map(itemSnapshot),
        subtotal,
        shippingCost: shipping.price,
        discount,
        total,
        status: 'PENDING',
        paymentMethod: method,
        ...paymentRef,
        ...(coupon ? { coupon } : {}),
        sellerIds,
        // Só ordena a lista do admin: a liberação conta da ENTREGA (order-stage.ts).
        escrowInfo: { status: 'HOLDING', releaseDate: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        customerData: { name: buyer.name, cpf: buyer.cpf, phone: buyer.phone, email: buyer.email },
        addressData: {
          street: address.street,
          number: address.number,
          complement: address.complement,
          neighborhood: address.neighborhood,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
        },
        shippingInfo: {
          serviceId: shipping.serviceId,
          serviceName: shipping.serviceName,
          price: shipping.price,
          freeShipping: shipping.freeShipping,
          quotedPrice: shipping.quotedPrice,
          deliveryTime: shipping.deliveryTime,
          // Sem etiqueta: `createMelhorEnvioShipment` recusa pedido sem serviceId.
          ...(shipping.localDelivery ? { localDelivery: true } : {}),
          ...(Object.keys(shipping.sellerShippingCost).length ? { sellerShippingCost: shipping.sellerShippingCost } : {}),
        },
        pricedBy: 'server',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      logger.error('placeOrder: pedido não gravou depois da cobrança; desfazendo', { orderId: orderRef.id, error });
      if (method === 'CREDIT_CARD') {
        const id = String(paymentRef['asaasPaymentId']);
        await requestAsaas(`/payments/${encodeURIComponent(id)}/refund`, { method: 'POST' })
          .catch(() => requestAsaas(`/payments/${encodeURIComponent(id)}`, { method: 'DELETE' }))
          .catch(e => logger.error('placeOrder: não deu para desfazer a cobrança do cartão', { id, e }));
      } else {
        await cancelCoraInvoice(String(paymentRef['coraInvoiceId']))
          .catch(e => logger.error('placeOrder: não deu para cancelar a fatura do Cora', { e }));
      }
      throw new OrderError(500, 'Não foi possível registrar o pedido. Nada foi cobrado. Tente de novo.');
    }

    logger.info('Pedido criado', { orderId: orderRef.id, uid: auth.uid, total, method, lines: lines.length });
    res.status(200).json({ orderId: orderRef.id, total, subtotal, shipping: shipping.price, discount, method, charge, cardStatus });
  } catch (error) {
    if (error instanceof OrderError) {
      res.status(error.status).json({ error: error.message, ...error.extra });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error('placeOrder falhou', { uid: auth.uid, error: message });
    if (/CORA_CLIENT_ID|ASAAS_API_KEY/.test(message)) {
      res.status(503).json({ error: 'Pagamentos indisponíveis no momento. Tente mais tarde.' });
      return;
    }
    res.status(502).json({ error: 'Não foi possível gerar o pagamento agora. Nada foi cobrado. Tente de novo em instantes.' });
  }
});

// ----------------------------------------------------- cancelar sem pagar

/**
 * Cancela um pedido que ainda espera pagamento: primeiro a cobrança (para não
 * dar para pagar depois), depois o pedido. Se a cobrança já tiver sido paga, o
 * pedido é atualizado como pago e o cancelamento é recusado.
 */
async function cancelUnpaidOrder(orderId: string, by: 'buyer' | 'system' | 'admin', reason: string): Promise<{ cancelled: boolean; reason?: string }> {
  const db = getFirestore();
  const ref = db.doc(`${ORDERS}/${orderId}`);
  const order = (await ref.get()).data();
  if (!order) return { cancelled: false, reason: 'NOT_FOUND' };
  if (order['status'] !== 'PENDING') return { cancelled: false, reason: 'NOT_PENDING' };

  if (order['coraInvoiceId']) {
    const invoiceId = String(order['coraInvoiceId']);
    const invoice = await getCoraInvoice(invoiceId).catch(() => null);
    if (invoice && (invoice.status === 'PAID' || invoice.status === 'IN_PAYMENT' || (invoice.total_paid || 0) > 0)) {
      await applyCoraInvoiceToOrder(invoiceId, 'cancel-check').catch(() => undefined);
      return { cancelled: false, reason: 'ALREADY_PAID' };
    }
    if (invoice && invoice.status !== 'CANCELLED') {
      try {
        await cancelCoraInvoice(invoiceId);
      } catch (error) {
        // Não cancelou a cobrança: não cancela o pedido (poderia ser pago depois).
        logger.error('Cancelar pedido: Cora recusou cancelar a fatura', { orderId, invoiceId, error: error instanceof Error ? error.message : error });
        return { cancelled: false, reason: 'CHARGE_NOT_CANCELLED' };
      }
    }
  } else if (order['asaasPaymentId']) {
    const id = String(order['asaasPaymentId']);
    const payment = await requestAsaas(`/payments/${encodeURIComponent(id)}`).catch(() => null) as { status?: string } | null;
    if (payment && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(String(payment.status))) {
      return { cancelled: false, reason: 'ALREADY_PAID' };
    }
    await requestAsaas(`/payments/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  }

  const done = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.get('status') !== 'PENDING') return false;
    tx.update(ref, {
      status: 'CANCELLED',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: by,
      cancelReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  return done ? { cancelled: true } : { cancelled: false, reason: 'NOT_PENDING' };
}

/** `POST cancelOrder` — `{ orderId }`: o comprador (ou admin) cancela um pedido não pago. */
export const cancelOrder = onRequest(orderRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  const orderId = String((req.body || {}).orderId ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) {
    res.status(400).json({ error: 'Pedido inválido.' });
    return;
  }

  try {
    const order = (await getFirestore().doc(`${ORDERS}/${orderId}`).get()).data();
    const admin = isAdminUser(auth);
    if (!order || (order['userId'] !== auth.uid && !admin)) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }
    const result = await cancelUnpaidOrder(orderId, admin && order['userId'] !== auth.uid ? 'admin' : 'buyer', 'BUYER_REQUEST');
    if (result.cancelled) {
      res.status(200).json({ ok: true });
      return;
    }
    const messages: Record<string, string> = {
      NOT_PENDING: 'Este pedido não está mais esperando pagamento.',
      ALREADY_PAID: 'O pagamento deste pedido já caiu, então ele não pode ser cancelado aqui. Se não quiser mais, peça a devolução depois de receber ou fale com a Vineon.',
      CHARGE_NOT_CANCELLED: 'Não conseguimos cancelar a cobrança agora. Tente de novo em alguns minutos.',
    };
    res.status(409).json({ error: messages[result.reason || ''] || 'Não foi possível cancelar o pedido.', reason: result.reason });
  } catch (error) {
    logger.error('cancelOrder falhou', { orderId, error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Não foi possível cancelar agora. Tente de novo em instantes.' });
  }
});

/**
 * Pedido sem pagamento depois do vencimento (3 dias + folga) é cancelado, como
 * nos marketplaces grandes: some de "A pagar", a loja não fica com venda
 * pendurada e o cupom volta para a pessoa. Antes, confere na cobrança se não
 * foi pago (webhook perdido).
 */
export const expireUnpaidOrders = onSchedule(
  { schedule: 'every 6 hours', region, timeZone: 'America/Sao_Paulo', maxInstances: 1, timeoutSeconds: 300 },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - LIMITS.expireAfterMs);
    const snap = await getFirestore().collection(ORDERS)
      .where('status', '==', 'PENDING')
      .where('createdAt', '<', cutoff)
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get();

    let cancelled = 0;
    for (const doc of snap.docs) {
      const result = await cancelUnpaidOrder(doc.id, 'system', 'PAYMENT_EXPIRED').catch(error => {
        logger.error('expireUnpaidOrders: falhou num pedido', { orderId: doc.id, error: error instanceof Error ? error.message : error });
        return { cancelled: false };
      });
      if (result.cancelled) cancelled++;
    }
    logger.info('expireUnpaidOrders', { checked: snap.size, cancelled });
  }
);

// ---------------------------------------------------- estoque e vendidos

interface InventoryChange {
  /** O pedido acabou de virar pago (e o estoque foi baixado agora). */
  paidNow: boolean;
}

/**
 * Baixa o estoque e soma "vendidos" quando o pagamento é confirmado; devolve
 * se o pedido pago for cancelado ou estornado. Idempotente pelo campo
 * `inventory` do próprio pedido (o gatilho pode rodar mais de uma vez).
 */
export async function applyOrderInventory(orderId: string): Promise<InventoryChange> {
  const db = getFirestore();
  const ref = db.doc(`${ORDERS}/${orderId}`);

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const order = snap.data();
    if (!order) return { paidNow: false };

    const inventory = order['inventory'] || {};
    const status = String(order['status'] || '');
    const isPaid = PAID_STATUSES.includes(status);
    const undo = (status === 'CANCELLED' || status === 'REFUNDED') && inventory.applied === true && inventory.restored !== true;
    const apply = isPaid && inventory.applied !== true;
    if (!apply && !undo) return { paidNow: false };

    const items: any[] = Array.isArray(order['items']) ? order['items'] : [];
    const byProduct = new Map<string, { qty: number; skus: Map<string, number> }>();
    for (const item of items) {
      const productId = String(item?.productId || item?.productData?.id || '');
      const qty = Math.max(0, Math.floor(Number(item?.quantity) || 0));
      if (!productId || !qty) continue;
      const entry = byProduct.get(productId) ?? { qty: 0, skus: new Map<string, number>() };
      entry.qty += qty;
      if (item?.skuId) entry.skus.set(String(item.skuId), (entry.skus.get(String(item.skuId)) ?? 0) + qty);
      byProduct.set(productId, entry);
    }

    const refs = [...byProduct.keys()].map(id => db.doc(`products/${id}`));
    const productSnaps = refs.length ? await tx.getAll(...refs) : [];
    const sign = apply ? -1 : 1;

    for (const p of productSnaps) {
      if (!p.exists) continue;
      const entry = byProduct.get(p.id)!;
      const data = p.data() || {};
      const patch: Record<string, unknown> = {};
      const stock = Number(data['stock']);
      if (Number.isFinite(stock)) patch['stock'] = Math.max(0, stock + sign * entry.qty);
      const sold = Number(data['soldCount']) || 0;
      patch['soldCount'] = Math.max(0, sold - sign * entry.qty);
      for (const [skuId, qty] of entry.skus) {
        const skuStock = Number(data['skus']?.[skuId]?.stock);
        if (Number.isFinite(skuStock)) patch[`skus.${skuId}.stock`] = Math.max(0, skuStock + sign * qty);
      }
      tx.update(p.ref, patch);
    }

    tx.update(ref, apply
      ? { 'inventory.applied': true, 'inventory.appliedAt': FieldValue.serverTimestamp() }
      : { 'inventory.restored': true, 'inventory.restoredAt': FieldValue.serverTimestamp() });
    return { paidNow: apply };
  });
}
