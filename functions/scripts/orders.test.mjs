// Bateria do fechamento do pedido no servidor (`placeOrder`, `cancelOrder`),
// do estoque na confirmação do pagamento (`onOrderWrittenInventory`) e das
// regras endurecidas na auditoria de 2026-10-18 (pedidos, anúncios, conversas,
// denúncias, recebimentos, Storage) e das functions expostas.
//
//   functions/.env.local apontando para os falsos (ver docs/testes-com-emulador.md)
//   node functions/scripts/fake-integrations.mjs   (Melhor Envio falso)
//   npm run emulators
//   node functions/scripts/orders.test.mjs
//
// O Cora é o falso do próprio emulador (CORA_FAKE=1 em .env.demo-vineon).
// Roda o seed primeiro. Só funciona contra projeto `demo-*`.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT = process.env.EMULATOR_PROJECT_ID || 'demo-vineon';
if (!PROJECT.startsWith('demo-')) throw new Error('Só roda em projeto demo.');

const HOST = '127.0.0.1';
const FS = `http://${HOST}:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://${HOST}:5001/${PROJECT}/us-central1`;
const STORAGE = `http://${HOST}:9199/v0/b/${PROJECT}.appspot.com/o`;
const PASSWORD = 'vineon-teste';

process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:8080`;
process.env.GCLOUD_PROJECT = PROJECT;

execFileSync('node', [fileURLToPath(new URL('./emulator-seed.mjs', import.meta.url))], { stdio: 'ignore' });

initializeApp({ projectId: PROJECT });
const db = getFirestore();

// ------------------------------------------------------------------ apoio
let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = '') {
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${name} ${extra}`);
  }
  console.log(`${ok ? '  ok ' : ' FALHA'}  ${name}${ok ? '' : ` ${extra}`}`);
}

async function login(email) {
  const response = await fetch(`http://${HOST}:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const data = await response.json();
  if (!data.idToken) throw new Error(`login falhou para ${email}: ${JSON.stringify(data)}`);
  return data.idToken;
}

const auth = token => (token ? { Authorization: `Bearer ${token}` } : {});
const docName = path => `projects/${PROJECT}/databases/(default)/documents/${path}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function v(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(v) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'object') return { mapValue: { fields: fields(value) } };
  return { stringValue: String(value) };
}
const fields = obj => Object.fromEntries(Object.entries(obj).map(([k, val]) => [k, v(val)]));

async function fsCommit(writes, token) {
  const response = await fetch(`${FS}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ writes: Array.isArray(writes) ? writes : [writes] }),
  });
  return { ok: response.ok, body: await response.json().catch(() => ({})) };
}

async function fsGet(path, token) {
  const response = await fetch(`${FS}/${path}`, { headers: auth(token) });
  return response.status;
}

/** Caminho de campo do REST: segmento fora de [A-Za-z_][A-Za-z0-9_]* vai entre crases. */
const fieldPath = dotted => dotted.split('.').map(seg => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg) ? seg : `\`${seg}\``)).join('.');

/** {'a.b': 1} -> {a: {b: 1}}: no REST o corpo é aninhado e a máscara diz o que muda. */
function nest(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('.');
    let node = out;
    parts.slice(0, -1).forEach(part => { node = node[part] ??= {}; });
    node[parts.at(-1)] = value;
  }
  return out;
}

/** Atualiza só os campos dados (dot path permitido), com carimbos de hora do servidor. */
function patch(path, data, { now = [], mask } = {}) {
  return {
    update: { name: docName(path), fields: fields(nest(data)) },
    updateMask: { fieldPaths: (mask ?? Object.keys(data)).map(fieldPath) },
    ...(now.length ? { updateTransforms: now.map(p => ({ fieldPath: fieldPath(p), setToServerValue: 'REQUEST_TIME' })) } : {}),
  };
}

function create(path, data, now = []) {
  return {
    update: { name: docName(path), fields: fields(data) },
    currentDocument: { exists: false },
    ...(now.length ? { updateTransforms: now.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
  };
}

async function fn(name, body, token, method = 'POST') {
  const response = await fetch(`${FN}/${name}${method === 'GET' && body ? `?${new URLSearchParams(body)}` : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

async function upload(path, token, { contentType = 'image/png', size = 200 } = {}) {
  const boundary = 'vineonboundary';
  const meta = JSON.stringify({ name: path, contentType });
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, Buffer.alloc(size, 7), tail]);
  const response = await fetch(`${STORAGE}?name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, 'X-Goog-Upload-Protocol': 'multipart', ...auth(token) },
    body,
  });
  return response.status;
}

async function storageDelete(path, token) {
  const response = await fetch(`${STORAGE}/${encodeURIComponent(path)}`, { method: 'DELETE', headers: auth(token) });
  return response.status;
}

async function waitFor(read, ok, ms = 15_000) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    last = await read();
    if (ok(last)) return last;
    await sleep(300);
  }
  return last;
}

const order = async id => (await db.doc(`orders/${id}`).get()).data();
const product = async id => (await db.doc(`products/${id}`).get()).data();

// ---------------------------------------------------------------- cenário
// Melhor Envio configurado (o falso responde PAC R$ 24,90, SEDEX R$ 39,50 e
// "Mini Envios" com erro). Sem regra de frete grátis da loja.
await db.doc('settings/melhor_envio').set({
  accessToken: 'token-falso', isSandbox: true,
  senderName: 'Vineon Envios', senderPhone: '11999999999', senderEmail: 'envios@vineon.test', senderCpfCnpj: '11222333000181',
  address: { street: 'Rua A', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01001000' },
});
await db.doc('appConfig/storefront').set({ freeShipping: { enabled: false, minValue: 0 } }, { merge: true });

const buyerTok = await login('comprador@vineon.test');
const sellerTok = await login('vendedor@vineon.test');
const atelieTok = await login('atelie@vineon.test');
const adminTok = await login('admin@vineon.test');

const BUYER = {
  name: 'Comprador de Teste',
  cpf: (await db.doc('users/test-comprador').get()).get('cpf'),
  phone: '11990000003',
};
const ADDRESS = { street: 'Avenida Paulista', number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', postalCode: '01310-100' };
const body = (items, extra = {}) => ({ items, shippingServiceId: 1, address: ADDRESS, buyer: BUYER, method: 'PIX', ...extra });
const line = (productId, quantity = 1, skuId = null) => ({ productId, skuId, quantity });
const place = (payload, token = buyerTok) => fn('placeOrder', payload, token);

// ====================================================== preço no servidor
console.log('\nPreço, frete e total calculados no servidor');
let r = await place(body([line('fone')], { expectedTotal: 424.8 }));
check('fone + PAC: R$ 399,90 + R$ 24,90 = R$ 424,80', r.status === 200 && r.json.total === 424.8, JSON.stringify(r.json));
const order1 = r.json.orderId;
let o = await order(order1);
check('pedido gravado pelo servidor (pricedBy, PENDING)', o?.pricedBy === 'server' && o?.status === 'PENDING');
check('pedido guarda subtotal, frete e itens com o preço de products/', o?.subtotal === 399.9 && o?.shippingCost === 24.9 && o?.items?.[0]?.productData?.price === 399.9 && o?.items?.[0]?.productData?.sellerId === 'test-vendedor');
check('pedido guarda as medidas reais para a etiqueta', o?.items?.[0]?.productData?.weight === 0.5 && o?.items?.[0]?.productData?.width === 20);
check('sellerIds sai do anúncio', JSON.stringify(o?.sellerIds) === '["test-vendedor"]');
check('cobrança do Cora com o total do servidor', /^inv_fake_/.test(o?.coraInvoiceId || '') && !!o?.coraPayment?.pixCode);
const fakeInvoice = (await db.doc(`_fakeCoraInvoices/${o.coraInvoiceId}`).get()).data();
check('fatura emitida em centavos = 42480', fakeInvoice?.total_amount === 42480, JSON.stringify(fakeInvoice?.total_amount));
check('dono da fatura registrado em coraCharges', (await db.doc(`coraCharges/${o.coraInvoiceId}`).get()).get('uid') === 'test-comprador');
check('e-mail do comprador vem do login, não do corpo', o?.customerData?.email === 'comprador@vineon.test');

r = await place(body([line('fone')], { expectedTotal: 5 }));
check('total que o navegador viu diferente: 409 TOTAL_CHANGED com o total certo', r.status === 409 && r.json.reason === 'TOTAL_CHANGED' && r.json.total === 424.8, JSON.stringify(r.json));
r = await place(body([{ productId: 'fone', quantity: 1, price: 0.01, productData: { price: 0.01 } }], { expectedTotal: 424.8 }));
check('preço mandado no item é ignorado (vale products/)', r.status === 200 && r.json.total === 424.8, JSON.stringify(r.json));
r = await place(body([line('smartphone')]));
check('smartphone com frete grátis do vendedor e promoção: R$ 1.699,90', r.status === 200 && r.json.total === 1699.9 && r.json.shipping === 0, JSON.stringify(r.json));
r = await place(body([line('smartphone'), line('fone')]));
check('carrinho misto: frete cobrado (nem todo item é grátis)', r.status === 200 && r.json.total === Math.round((1699.9 + 399.9 + 24.9) * 100) / 100, JSON.stringify(r.json));
r = await place(body([line('fone')], { shippingServiceId: 2 }));
check('SEDEX recotado no servidor: R$ 39,50', r.status === 200 && r.json.shipping === 39.5, JSON.stringify(r.json));

await db.doc('appConfig/storefront').set({ freeShipping: { enabled: true, minValue: 300 } }, { merge: true });
r = await place(body([line('fone')]));
check('regra de frete grátis da loja (R$ 300+) vale no servidor', r.status === 200 && r.json.shipping === 0 && r.json.total === 399.9, JSON.stringify(r.json));
await db.doc('appConfig/storefront').set({ freeShipping: { enabled: false, minValue: 0 } }, { merge: true });

console.log('\nRecusas');
r = await place(body([line('luminaria')]));
check('produto sem estoque: 409', r.status === 409 && /esgotou/.test(r.json.error || ''), JSON.stringify(r.json));
r = await place(body([line('celular-usado', 2)]));
check('quantidade acima do estoque: 409 com o máximo', r.status === 409 && /só 1/.test(r.json.error || ''), JSON.stringify(r.json));
r = await place(body([line('celular-usado', 1), line('celular-usado', 1)]));
check('duas linhas do mesmo item somam no estoque', r.status === 409, JSON.stringify(r.json));
r = await place(body([line('fone')]), sellerTok);
check('loja não compra o próprio anúncio', r.status === 409 && /anúncio seu/.test(r.json.error || ''), JSON.stringify(r.json));
await db.doc('products/tenis').update({ moderation: { hidden: true, reason: 'removed_by_admin' } });
r = await place(body([line('tenis')]));
check('anúncio fora do ar: 409', r.status === 409, JSON.stringify(r.json));
r = await place(body([line('nao-existe')]));
check('produto inexistente: 409', r.status === 409);
r = await place(body([line('fone')], { buyer: { ...BUYER, cpf: '12345678900' } }));
check('CPF inválido: 400', r.status === 400 && /CPF/.test(r.json.error || ''));
r = await place(body([line('fone')], { address: { ...ADDRESS, postalCode: '123' } }));
check('CEP inválido: 400', r.status === 400);
r = await place(body([line('fone')], { shippingServiceId: 17 }));
check('serviço de entrega com erro na cotação: 409 SHIPPING_UNAVAILABLE', r.status === 409 && r.json.reason === 'SHIPPING_UNAVAILABLE', JSON.stringify(r.json));
r = await place(body([line('fone', 0)]));
check('quantidade 0: 400', r.status === 400);
r = await place(body([line('fone')], { method: 'DINHEIRO' }));
check('forma de pagamento inválida: 400', r.status === 400);
r = await place(body([line('fone')]), null);
check('sem login: 401', r.status === 401);
await db.doc('accountSuspensions/test-comprador').set({ at: Timestamp.now() });
r = await place(body([line('fone')]));
check('conta suspensa: 403', r.status === 403);
await db.doc('accountSuspensions/test-comprador').delete();

// Teto de pedidos esperando pagamento (10).
const pendingNow = (await db.collection('orders').where('userId', '==', 'test-comprador').where('status', '==', 'PENDING').get()).size;
const fillers = [];
for (let i = pendingNow; i < 10; i++) {
  const ref = db.collection('orders').doc();
  fillers.push(ref);
  await ref.set({ userId: 'test-comprador', status: 'PENDING', total: 10, items: [], sellerIds: ['test-vendedor'], createdAt: Timestamp.now() });
}
r = await place(body([line('fone')]));
check('11º pedido esperando pagamento: 429', r.status === 429, JSON.stringify(r.json));
await Promise.all(fillers.map(ref => ref.delete()));

// =========================================================== cupom
console.log('\nCupom reservado + placeOrder');
r = await fn('couponQuote', { action: 'reserve', code: 'LOJA15', items: [line('fone')], shippingPrice: 24.9 }, buyerTok);
const res1 = r.json.redemptionId;
check('reserva LOJA15 (R$ 59,98)', r.status === 200 && r.json.quote?.discount === 59.98, JSON.stringify(r.json));
r = await place(body([line('fone')], { couponRedemptionId: res1, expectedTotal: 364.82 }));
const couponOrder = r.json.orderId;
check('pedido com cupom: R$ 424,80 - R$ 59,98 = R$ 364,82', r.status === 200 && r.json.total === 364.82 && r.json.discount === 59.98, JSON.stringify(r.json));
o = await waitFor(() => order(couponOrder), x => !!x?.couponCheck);
check('gatilho do cupom confere a reserva (couponCheck ok)', o?.couponCheck === 'ok' && o?.coupon?.code === 'LOJA15', JSON.stringify(o?.couponCheck));
r = await place(body([line('fone')], { couponRedemptionId: res1 }));
check('mesma reserva de novo: 409 COUPON_EXPIRED', r.status === 409 && r.json.reason === 'COUPON_EXPIRED', JSON.stringify(r.json));
r = await fn('couponQuote', { action: 'reserve', code: 'FRETEGRATIS', items: [line('fone')], shippingPrice: 24.9 }, buyerTok);
const res2 = r.json.redemptionId;
check('reserva FRETEGRATIS para o teste seguinte', r.status === 200 && !!res2, JSON.stringify(r.json));
r = await place(body([line('fone', 2)], { couponRedemptionId: res2 }));
check('reserva feita para outro carrinho: 409 COUPON_STALE', r.status === 409 && r.json.reason === 'COUPON_STALE', JSON.stringify(r.json));
r = await place(body([line('fone')], { couponRedemptionId: res2 }), atelieTok);
check('reserva de outra pessoa: 409', r.status === 409, JSON.stringify(r.json));
r = await place(body([line('fone')], { couponRedemptionId: 'abc' }));
check('id de reserva inválido: 400', r.status === 400);

// ================================================ pagamento e estoque
console.log('\nPagamento confirmado: estoque e vendidos');
const foneBefore = await product('fone');
r = await fn('simulateCoraPayment', { invoiceId: (await order(order1)).coraInvoiceId }, buyerTok);
check('simulação de pagamento (Cora falso) confirma o pedido', r.status === 200 && r.json.orderStatus === 'RECEIVED', JSON.stringify(r.json));
o = await waitFor(() => order(order1), x => x?.inventory?.applied === true);
check('gatilho marca o estoque como baixado', o?.inventory?.applied === true);
let fone = await product('fone');
check('estoque do fone 12 -> 11 e vendidos 0 -> 1', fone.stock === foneBefore.stock - 1 && fone.soldCount === (foneBefore.soldCount || 0) + 1, `${fone.stock} ${fone.soldCount}`);
await db.doc(`orders/${order1}`).update({ updatedAt: Timestamp.now() });
await sleep(1500);
fone = await product('fone');
check('gatilho repetido não baixa duas vezes', fone.stock === foneBefore.stock - 1);
r = await fn('simulateCoraPayment', { invoiceId: (await order(order1)).coraInvoiceId }, atelieTok);
check('outra conta não simula pagamento da fatura alheia', r.status === 404);

await db.doc(`orders/${order1}`).update({ status: 'REFUNDED' });
await waitFor(() => order(order1), x => x?.inventory?.restored === true);
fone = await product('fone');
check('estorno devolve estoque e vendidos', fone.stock === foneBefore.stock && fone.soldCount === (foneBefore.soldCount || 0), `${fone.stock} ${fone.soldCount}`);

// ===================================================== cancelar sem pagar
console.log('\nCancelar pedido não pago');
r = await place(body([line('camiseta', 2)]));
const toCancel = r.json.orderId;
check('pedido de 2 camisetas criado', r.status === 200, JSON.stringify(r.json));
r = await fn('cancelOrder', { orderId: toCancel }, atelieTok);
check('outra conta não cancela: 404', r.status === 404);
r = await fn('cancelOrder', { orderId: toCancel }, buyerTok);
o = await order(toCancel);
check('comprador cancela: pedido CANCELLED por buyer', r.status === 200 && o?.status === 'CANCELLED' && o?.cancelledBy === 'buyer', JSON.stringify(r.json));
check('fatura do Cora cancelada junto', (await db.doc(`_fakeCoraInvoices/${o.coraInvoiceId}`).get()).get('status') === 'CANCELLED');
r = await fn('cancelOrder', { orderId: toCancel }, buyerTok);
check('cancelar de novo: 409', r.status === 409);
o = await waitFor(() => order(couponOrder), x => x?.couponCheck === 'ok');
r = await fn('cancelOrder', { orderId: couponOrder }, buyerTok);
check('cancelar pedido com cupom', r.status === 200, JSON.stringify(r.json));
const red = await waitFor(async () => (await db.doc(`couponRedemptions/${res1}`).get()).data(), x => x?.status === 'cancelled');
check('cupom volta para a pessoa (reserva cancelled)', red?.status === 'cancelled', JSON.stringify(red?.status));
r = await place(body([line('panela')]));
const paidThenCancel = r.json.orderId;
await fn('simulateCoraPayment', { invoiceId: (await order(paidThenCancel)).coraInvoiceId }, buyerTok);
r = await fn('cancelOrder', { orderId: paidThenCancel }, buyerTok);
check('pedido já pago não cancela por aqui: 409', r.status === 409 && (await order(paidThenCancel)).status === 'RECEIVED', JSON.stringify(r.json));

// ================================================================= regras
console.log('\nRegras de pedido');
r = await fsCommit(create('orders/hack-1', { userId: 'test-comprador', status: 'PENDING', total: 5, items: [], sellerIds: ['test-vendedor'] }), buyerTok);
check('comprador NÃO cria pedido direto no Firestore', !r.ok);
const paidId = paidThenCancel; // pago, loja test-vendedor
check('loja NÃO muda a forma de entrega (serviceId)', !(await fsCommit(patch(`orders/${paidId}`, { 'shippingInfo.serviceId': 2 }, { mask: ['shippingInfo.serviceId'] }), sellerTok)).ok);
check('loja NÃO aponta para etiqueta de outro pedido (shipmentId)', !(await fsCommit(patch(`orders/${paidId}`, { 'shippingInfo.shipmentId': 'outro' }, { mask: ['shippingInfo.shipmentId'] }), sellerTok)).ok);
check('loja NÃO muda total', !(await fsCommit(patch(`orders/${paidId}`, { total: 1 }), sellerTok)).ok);
check('loja NÃO muda status', !(await fsCommit(patch(`orders/${paidId}`, { status: 'DELIVERED' }), sellerTok)).ok);
check('loja NÃO libera o próprio repasse', !(await fsCommit(patch(`orders/${paidId}`, { 'escrowInfo.status': 'RELEASED' }, { mask: ['escrowInfo.status'] }), sellerTok)).ok);
check('loja NÃO marca entregue sem ter enviado', !(await fsCommit(patch(`orders/${paidId}`, { shipmentStatus: 'DELIVERED' }, { now: ['deliveredAt'] }), sellerTok)).ok);
check('loja marca enviada (com data do servidor)', (await fsCommit(patch(`orders/${paidId}`, { shipmentStatus: 'SHIPPED' }, { now: ['shippedAt', 'updatedAt'] }), sellerTok)).ok);
check('loja informa o rastreio', (await fsCommit(patch(`orders/${paidId}`, { 'shippingInfo.trackingCode': 'AB123456789BR' }, { mask: ['shippingInfo.trackingCode'] }), sellerTok)).ok);
check('loja NÃO volta a data de envio', !(await fsCommit(patch(`orders/${paidId}`, { shippedAt: '2020-01-01' }), sellerTok)).ok);
check('comprador NÃO muda o endereço depois de pago', !(await fsCommit(patch(`orders/${paidId}`, { 'addressData.street': 'Outra' }, { mask: ['addressData.street'] }), buyerTok)).ok);
check('comprador NÃO marca "problema na entrega"', !(await fsCommit(patch(`orders/${paidId}`, { shipmentStatus: 'PROBLEM' }, { now: ['shipmentProblemAt'] }), buyerTok)).ok);
check('comprador confirma o recebimento', (await fsCommit(patch(`orders/${paidId}`, { shipmentStatus: 'DELIVERED' }, { now: ['deliveryConfirmedAt'] }), buyerTok)).ok);
check('comprador NÃO confirma duas vezes', !(await fsCommit(patch(`orders/${paidId}`, { shipmentStatus: 'DELIVERED' }, { now: ['deliveryConfirmedAt'] }), buyerTok)).ok);
check('loja NÃO tira o "entregue"', !(await fsCommit(patch(`orders/${paidId}`, { shipmentStatus: 'SHIPPED' }, { now: ['shippedAt'] }), sellerTok)).ok);
check('comprador pede devolução', (await fsCommit(patch(`orders/${paidId}`, {
  'refundInfo.status': 'REQUESTED', 'refundInfo.reason': 'Veio com defeito na alça', 'refundInfo.requestedBy': 'test-comprador',
}, { mask: ['refundInfo.status', 'refundInfo.reason', 'refundInfo.requestedBy'], now: ['refundInfo.requestedAt'] }), buyerTok)).ok);

r = await place(body([line('fone')]));
const unpaid = r.json.orderId;
check('loja NÃO mexe em pedido não pago', !(await fsCommit(patch(`orders/${unpaid}`, { shipmentStatus: 'SHIPPED' }, { now: ['shippedAt'] }), sellerTok)).ok);

await db.doc('orders/multi-loja').set({
  userId: 'test-comprador', status: 'RECEIVED', total: 300, items: [], sellerIds: ['test-vendedor', 'test-atelie'], createdAt: Timestamp.now(),
});
const nf = (uid) => ({ type: 'NFE', url: 'https://x', path: `orders/multi-loja/fiscal/${uid}/a.pdf`, fileName: 'a.pdf', contentType: 'application/pdf', size: 1, number: null, uploadedBy: uid });
check('loja anexa a própria nota no pedido de duas lojas', (await fsCommit(patch('orders/multi-loja', { 'fiscalDocuments.test-vendedor': nf('test-vendedor') }, { mask: ['fiscalDocuments.test-vendedor'], now: ['fiscalDocuments.test-vendedor.uploadedAt'] }), sellerTok)).ok);
check('loja NÃO mexe na nota da outra loja', !(await fsCommit(patch('orders/multi-loja', { 'fiscalDocuments.test-atelie': nf('test-vendedor') }, { mask: ['fiscalDocuments.test-atelie'] }), sellerTok)).ok);

console.log('\nRegras de anúncio, conta, conversa e denúncia');
check('loja NÃO infla "vendidos"', !(await fsCommit(patch('products/fone', { soldCount: 999 }), sellerTok)).ok);
check('loja NÃO infla "salvos"', !(await fsCommit(patch('products/fone', { savedCount: 999 }), sellerTok)).ok);
check('loja NÃO põe preço negativo', !(await fsCommit(patch('products/fone', { price: -1 }), sellerTok)).ok);
check('loja NÃO põe preço como texto', !(await fsCommit(patch('products/fone', { price: '10' }), sellerTok)).ok);
check('loja muda preço e estoque normalmente', (await fsCommit(patch('products/fone', { price: 389.9, stock: 20 }), sellerTok)).ok);
check('loja NÃO cria anúncio já com vendidos', !(await fsCommit(create('products/novo-hack', { name: 'X', price: 10, stock: 1, sellerId: 'test-vendedor', soldCount: 50 }), sellerTok)).ok);
check('loja cria anúncio normal', (await fsCommit(create('products/novo-ok', { name: 'Produto novo', price: 10, stock: 1, sellerId: 'test-vendedor' }), sellerTok)).ok);
check('conta NÃO troca o próprio asaasCustomerId', !(await fsCommit(patch('users/test-comprador', { asaasCustomerId: 'cus_de_outro' }), buyerTok)).ok);
await db.doc('users/test-comprador').set({ createdAt: Timestamp.fromMillis(Date.now() - 86_400_000) }, { merge: true });
check('conta NÃO muda "na Vineon desde" (createdAt)', !(await fsCommit(patch('users/test-comprador', { createdAt: '2015-01-01' }), buyerTok)).ok);
check('conta muda o próprio nome', (await fsCommit(patch('users/test-comprador', { displayName: 'Comprador Teste' }), buyerTok)).ok);

await db.doc('chats/chat-teste').set({ participantIds: ['test-comprador', 'test-vendedor'], buyerId: 'test-comprador', sellerId: 'test-vendedor', lastMessage: 'oi' });
check('participante NÃO enfia outra conta na conversa', !(await fsCommit(patch('chats/chat-teste', { participantIds: ['test-comprador', 'test-vendedor', 'test-atelie'] }), buyerTok)).ok);
check('participante atualiza a última mensagem', (await fsCommit(patch('chats/chat-teste', { lastMessage: 'tudo bem?' }), buyerTok)).ok);
check('mensagem gigante é recusada', !(await fsCommit(create('chats/chat-teste/messages/m1', { senderId: 'test-comprador', text: 'x'.repeat(6000) }), buyerTok)).ok);
check('mensagem normal passa', (await fsCommit(create('chats/chat-teste/messages/m2', { senderId: 'test-comprador', text: 'Olá!' }), buyerTok)).ok);

const report = { senderId: 'test-comprador', senderName: 'Comprador', reportedUserId: 'test-vendedor', chatId: 'chat-teste', reason: 'spam', details: 'mandou link', status: 'pending' };
check('denúncia válida de conversa', (await fsCommit(create('reports/r-ok', report, ['createdAt']), buyerTok)).ok);
check('denúncia em nome de outra pessoa é recusada', !(await fsCommit(create('reports/r-1', { ...report, senderId: 'test-atelie' }, ['createdAt']), buyerTok)).ok);
check('denúncia com campo estranho é recusada', !(await fsCommit(create('reports/r-2', { ...report, extra: 'x'.repeat(10) }, ['createdAt']), buyerTok)).ok);

console.log('\nRecebimentos (chave Pix da loja)');
const payout = { method: 'pix', pixKeyType: 'cnpj', pixKey: '11222333000181', holderName: 'Loja de Teste Ltda', holderDocument: '11222333000181' };
check('loja salva a própria chave Pix', (await fsCommit(create('sellerPayouts/test-vendedor', payout, ['updatedAt']), sellerTok)).ok);
check('loja NÃO grava chave de outra loja', !(await fsCommit(create('sellerPayouts/test-atelie', payout, ['updatedAt']), sellerTok)).ok);
check('chave com tipo inválido é recusada', !(await fsCommit(create('sellerPayouts/test-atelie', { ...payout, pixKeyType: 'conta' }, ['updatedAt']), atelieTok)).ok);
check('documento do titular inválido é recusado', !(await fsCommit(create('sellerPayouts/test-atelie', { ...payout, holderDocument: '123' }, ['updatedAt']), atelieTok)).ok);
check('dono lê a própria chave', (await fsGet('sellerPayouts/test-vendedor', sellerTok)) === 200);
check('admin lê a chave (para pagar)', (await fsGet('sellerPayouts/test-vendedor', adminTok)) === 200);
check('outra conta NÃO lê a chave', (await fsGet('sellerPayouts/test-vendedor', buyerTok)) === 403);
check('visitante NÃO lê a chave', (await fsGet('sellerPayouts/test-vendedor', null)) === 403);

console.log('\nStorage: fotos de anúncio e mídia de conversa');
// Nomes novos a cada rodada: o seed não limpa o Storage do emulador.
const run = Date.now();
check('loja envia foto na própria pasta', (await upload(`products/test-vendedor/${run}.png`, sellerTok)) === 200);
check('outra conta NÃO sobrescreve a foto da loja', (await upload(`products/test-vendedor/${run}.png`, buyerTok)) === 403);
check('outra conta NÃO apaga a foto da loja', (await storageDelete(`products/test-vendedor/${run}.png`, buyerTok)) === 403);
check('formato antigo: cria arquivo novo', (await upload(`products/${run}_antiga.png`, sellerTok)) === 200);
check('formato antigo: outra conta NÃO sobrescreve', (await upload(`products/${run}_antiga.png`, buyerTok)) === 403);
check('foto de anúncio só aceita imagem', (await upload('products/test-vendedor/x.html', sellerTok, { contentType: 'text/html' })) === 403);
check('participante envia foto na conversa', (await upload(`chats/chat-teste/${run}.png`, buyerTok)) === 200);
check('participante NÃO apaga a mídia da conversa', (await storageDelete(`chats/chat-teste/${run}.png`, sellerTok)) === 403);

// ================================================== functions expostas
console.log('\nFunctions expostas');
r = await fn('createCoraCharge', { billingType: 'PIX', value: 5, dueDate: '2030-01-01', customer: { name: 'X', cpfCnpj: BUYER.cpf } }, buyerTok);
check('cobrança avulsa (valor do navegador) só para admin', r.status === 403, JSON.stringify(r.json));
r = await fn('createAsaasPayment', { billingType: 'CREDIT_CARD', value: 1, dueDate: '2030-01-01' }, buyerTok);
check('cobrança avulsa de cartão só para admin', r.status === 403);
r = await fn('dispatchWhatsappTrigger', { eventType: 'product_sold', data: { valor: 'R$ 1.000.000' } }, buyerTok);
check('aviso de "venda" pelo app é recusado (só o servidor manda)', r.status === 403, JSON.stringify(r.json));
const statuses = [];
for (let i = 0; i < 8; i++) statuses.push((await fn('dispatchWhatsappTrigger', { eventType: 'new_login', data: { nome: 'x'.repeat(500), extra: { a: 1 } } }, buyerTok)).status);
check('aviso pelo app tem teto por hora (429 depois de 6)', statuses.slice(0, 6).every(s => s !== 429) && statuses.slice(6).every(s => s === 429), statuses.join(','));
const lastLog = (await db.collection('whatsappTriggerLogs').where('userId', '==', 'test-comprador').get()).docs.map(d => d.data()).pop();
check('dados do aviso saem cortados (sem objeto, até 200 caracteres)', !lastLog || (String(lastLog.data?.nome || '').length <= 200 && lastLog.data?.extra === undefined), JSON.stringify(lastLog?.data || {}).slice(0, 120));
r = await fetch(`${FN}/meAuthorizer?code=codigo-de-outra-conta`);
check('volta do OAuth do Melhor Envio sem state é recusada', r.status === 403);
r = await fetch(`${FN}/meAuthorizer?code=x&state=adivinhado`);
check('state adivinhado é recusado', r.status === 403);

// ------------------------------------------------------------------ fim
console.log(`\n${pass} ok, ${fail} falha(s)`);
if (fail) {
  console.log('\nFalhas:');
  failures.forEach(f => console.log(' - ' + f));
  process.exit(1);
}
process.exit(0);
