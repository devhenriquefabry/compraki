// Bateria dos cupons contra os emuladores: regras do Firestore, as Cloud
// Functions `couponQuote` e `saveCoupon`, o gatilho `onOrderWrittenCoupon` e a
// trava do pagamento (`asaasWebhook` recusa pedido com cupom inválido).
//
//   npm run emulators            (num terminal)
//   node functions/scripts/coupons.test.mjs
//
// Roda o seed primeiro (zera tudo e recria o cenário conhecido), então dá para
// repetir quantas vezes quiser. Só funciona contra projeto `demo-*`.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT = process.env.EMULATOR_PROJECT_ID || 'demo-vineon';
if (!PROJECT.startsWith('demo-')) throw new Error('Só roda em projeto demo.');

const HOST = '127.0.0.1';
const FS = `http://${HOST}:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://${HOST}:5001/${PROJECT}/us-central1`;
const PASSWORD = 'vineon-teste';

process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:8080`;
process.env.GCLOUD_PROJECT = PROJECT;

execFileSync('node', [fileURLToPath(new URL('./emulator-seed.mjs', import.meta.url))], { stdio: 'ignore' });

initializeApp({ projectId: PROJECT });
const admin = getFirestore();

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
const doc = path => `projects/${PROJECT}/databases/(default)/documents/${path}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fsGet(path, token) {
  const response = await fetch(`${FS}/${path}`, { headers: auth(token) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

/** Consulta com filtros de igualdade: [[campo, valor], ...]. */
async function fsList(collection, token, filters = []) {
  const structuredQuery = { from: [{ collectionId: collection }], limit: 50 };
  const clauses = filters.map(([field, value]) => ({
    fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } },
  }));
  if (clauses.length === 1) structuredQuery.where = clauses[0];
  if (clauses.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters: clauses } };
  const response = await fetch(`${FS}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ structuredQuery }),
  });
  const body = await response.json().catch(() => []);
  const docs = Array.isArray(body) ? body.filter(row => row.document) : [];
  const denied = !response.ok || (Array.isArray(body) && body.some(row => row.error));
  return { denied, count: docs.length };
}

async function fsCommit(writes, token) {
  const response = await fetch(`${FS}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ writes: Array.isArray(writes) ? writes : [writes] }),
  });
  return { ok: response.ok, body: await response.json().catch(() => ({})) };
}

/** JS -> valor REST do Firestore. */
function v(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(v) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'object') return { mapValue: { fields: fields(value) } };
  return { stringValue: String(value) };
}
const fields = obj => Object.fromEntries(Object.entries(obj).map(([k, val]) => [k, v(val)]));

async function fn(name, body, token) {
  const response = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

const quote = (code, items, shippingPrice, token, action = 'preview') =>
  fn('couponQuote', { action, code, items, shippingPrice }, token);

const line = (productId, quantity = 1) => ({ productId, quantity });

/** Espera o gatilho gravar algo (até 15 s). */
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

let orderSeq = 0;
/** Pedido como o checkout grava (só o que a regra olha + o cupom). */
function orderWrite(uid, coupon, extra = {}) {
  const id = `cupom-${Date.now()}-${++orderSeq}`;
  const data = {
    userId: uid,
    status: 'PENDING',
    total: 100,
    items: [{ productId: 'smartphone', quantity: 1, productData: { id: 'smartphone', name: 'Smartphone', price: 1899.9, sellerId: 'test-vendedor' } }],
    sellerIds: ['test-vendedor'],
    paymentMethod: 'PIX',
    escrowInfo: { status: 'HOLDING' },
    ...(coupon ? { coupon } : {}),
    ...extra,
  };
  return {
    id,
    write: {
      update: { name: doc(`orders/${id}`), fields: fields(data) },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
    },
  };
}

/** O `coupon` que o checkout copia da reserva. */
const couponOf = (redemptionId, q) => ({
  redemptionId,
  code: q.code,
  scope: q.scope,
  sellerId: q.sellerId,
  type: q.type,
  discount: q.discount,
  itemsDiscount: q.itemsDiscount,
  shippingDiscount: q.shippingDiscount,
});

const couponDoc = async code => (await admin.doc(`coupons/${code}`).get()).data();
const redemption = async id => (await admin.doc(`couponRedemptions/${id}`).get()).data();

// ------------------------------------------------------------------ login
const buyer = await login('comprador@vineon.test');
const seller = await login('vendedor@vineon.test');
const atelie = await login('atelie@vineon.test');
const staff = await login('admin@vineon.test');

// ===================================================== cálculo (preview)
console.log('\nCálculo do desconto (preview)');
let r = await quote('vineon10', [line('smartphone')], 20, buyer);
check('VINEON10: 10% de R$ 1.699,90 com teto de R$ 50 dá R$ 50', r.status === 200 && r.json.quote?.discount === 50, JSON.stringify(r.json));
check('código em minúsculas é aceito (normaliza)', r.json.quote?.code === 'VINEON10');
r = await quote('VINEON10', [line('fone')], 20, buyer);
check('VINEON10 sem teto estourado: 10% de R$ 399,90 = R$ 39,99', r.json.quote?.discount === 39.99, JSON.stringify(r.json));
r = await quote('VINEON10', [line('camiseta')], 20, buyer);
check('VINEON10 abaixo do mínimo: recusa e diz quanto falta', r.status === 409 && /Faltam R\$\s?50,10/.test(r.json.error || ''), JSON.stringify(r.json));
r = await quote('VINEON10', [line('camiseta', 3)], 20, buyer);
check('VINEON10 com 3 camisetas (R$ 149,70) passa do mínimo: R$ 14,97', r.json.quote?.discount === 14.97, JSON.stringify(r.json));

r = await quote('FRETEGRATIS', [line('fone')], 45, buyer);
check('FRETEGRATIS: frete de R$ 45 com teto de R$ 30 desconta R$ 30', r.json.quote?.shippingDiscount === 30 && r.json.quote?.itemsDiscount === 0, JSON.stringify(r.json));
r = await quote('FRETEGRATIS', [line('fone')], 18.5, buyer);
check('FRETEGRATIS: frete de R$ 18,50 sai de graça', r.json.quote?.shippingDiscount === 18.5, JSON.stringify(r.json));
r = await quote('FRETEGRATIS', [line('fone')], 0, buyer);
check('FRETEGRATIS com frete já grátis: recusa', r.status === 409 && /frete cobrado/.test(r.json.error || ''));

r = await quote('LOJA15', [line('smartphone'), line('bolsa-palha')], 20, buyer);
check('LOJA15 (Loja de Teste): só os itens da loja, 15% com teto de R$ 100', r.json.quote?.discount === 100 && r.json.quote?.eligibleSubtotal === 1699.9, JSON.stringify(r.json));
r = await quote('LOJA15', [line('fone')], 20, buyer);
check('LOJA15 em R$ 399,90 da loja: R$ 59,98', r.json.quote?.discount === 59.98, JSON.stringify(r.json));
r = await quote('LOJA15', [line('bolsa-palha')], 20, buyer);
check('LOJA15 com carrinho só de outra loja: recusa nomeando a loja', r.status === 409 && /Loja de Teste/.test(r.json.error || ''), JSON.stringify(r.json));

r = await quote('MARE20', [line('bolsa-palha')], 20, buyer);
check('MARE20 (privado, produtos escolhidos): R$ 20 na bolsa', r.json.quote?.discount === 20, JSON.stringify(r.json));
r = await quote('MARE20', [line('colar-conchas', 3)], 20, buyer);
check('MARE20 com produto da loja fora da lista: recusa', r.status === 409 && /alguns produtos/.test(r.json.error || ''), JSON.stringify(r.json));

check('VENCIDO: recusa', (await quote('VENCIDO', [line('fone')], 20, buyer)).json.error === 'Este cupom já venceu.');
check('PAUSADO: recusa', /pausado/.test((await quote('PAUSADO', [line('fone')], 20, buyer)).json.error || ''));
r = await quote('NAOEXISTE', [line('fone')], 20, buyer);
check('código inexistente: 404', r.status === 404);
check('código com símbolo: 400', (await quote('ABC-10', [line('fone')], 20, buyer)).status === 400);
check('carrinho vazio: 400', (await quote('VINEON10', [], 20, buyer)).status === 400);
check('quantidade 0: 400', (await quote('VINEON10', [line('fone', 0)], 20, buyer)).status === 400);
check('produto inexistente: 409', (await quote('VINEON10', [line('nao-existe')], 20, buyer)).status === 409);
check('sem login: 401', (await quote('VINEON10', [line('fone')], 20, null)).status === 401);

r = await quote('BEMVINDO20', [line('fone')], 20, buyer);
check('BEMVINDO20 (1ª compra) para quem já comprou: recusa', r.status === 409 && /primeira compra/.test(r.json.error || ''));
r = await quote('BEMVINDO20', [line('fone')], 20, staff);
check('BEMVINDO20 para quem nunca comprou: R$ 20', r.json.quote?.discount === 20, JSON.stringify(r.json));
r = await quote('LOJA15', [line('fone')], 20, seller);
check('loja NÃO usa o próprio cupom', r.status === 409 && /própria loja/.test(r.json.error || ''));

// Piso de R$ 5,00 (Cora/Asaas): produto barato com cupom fixo.
await admin.doc('products/chaveiro').set({ name: 'Chaveiro', price: 6, stock: 10, sellerId: 'test-vendedor', categoryIds: [], subcategoryIds: [] });
r = await quote('ULTIMO1', [line('chaveiro')], 0, buyer);
check('cupom nunca deixa o pedido abaixo de R$ 5,00 (R$ 6 - R$ 5 => desconto R$ 1)', r.json.quote?.discount === 1, JSON.stringify(r.json));

// Preço que o navegador mandar é ignorado: vale o de products/.
r = await fn('couponQuote', { action: 'preview', code: 'VINEON10', items: [{ productId: 'fone', quantity: 1, price: 99999 }], shippingPrice: 20 }, buyer);
check('preço enviado pelo navegador é ignorado', r.json.quote?.subtotal === 399.9, JSON.stringify(r.json));

// ============================================================ reserva
console.log('\nReserva e limites');
r = await quote('LOJA15', [line('fone')], 20, buyer, 'reserve');
const res1 = r.json.redemptionId;
check('reserva LOJA15 devolve id e validade', r.status === 200 && /^[A-Za-z0-9]{20}$/.test(res1 || '') && r.json.expiresAt > Date.now(), JSON.stringify(r.json));
check('reserva conta no cupom (redeemedCount 1)', (await couponDoc('LOJA15')).redeemedCount === 1);
r = await quote('LOJA15', [line('fone')], 20, buyer, 'reserve');
const res2 = r.json.redemptionId;
check('reservar de novo troca a reserva (sem gastar 2 usos)', r.status === 200 && (await couponDoc('LOJA15')).redeemedCount === 1 && (await redemption(res1)).status === 'released');

check('comprador lê a própria reserva', (await fsGet(`couponRedemptions/${res2}`, buyer)).status === 200);
check('outra conta NÃO lê a reserva', (await fsGet(`couponRedemptions/${res2}`, atelie)).status === 403);
check('cliente NÃO escreve reserva', !(await fsCommit({ update: { name: doc(`couponRedemptions/${res2}`), fields: fields({ status: 'reserved', discount: 999 }) } }, buyer)).ok);

// ULTIMO1: 1 uso no total.
r = await quote('ULTIMO1', [line('fone')], 20, buyer, 'reserve');
const lastRes = r.json.redemptionId;
check('ULTIMO1 reservado pelo comprador', r.status === 200);
r = await quote('ULTIMO1', [line('fone')], 20, atelie, 'reserve');
check('ULTIMO1 esgotado para a 2ª pessoa', r.status === 409 && /esgotou/.test(r.json.error || ''));
check('liberar reserva', (await fn('couponQuote', { action: 'release', redemptionId: lastRes }, buyer)).status === 200);
check('liberar devolve a vaga', (await couponDoc('ULTIMO1')).redeemedCount === 0);
r = await quote('ULTIMO1', [line('fone')], 20, atelie, 'reserve');
check('ULTIMO1 agora sai para a 2ª pessoa', r.status === 200, JSON.stringify(r.json));
// Reserva vencida volta para o limite na próxima tentativa.
await admin.doc(`couponRedemptions/${r.json.redemptionId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
r = await quote('ULTIMO1', [line('fone')], 20, buyer, 'reserve');
check('reserva vencida de outra pessoa é varrida e a vaga volta', r.status === 200, JSON.stringify(r.json));
check('a vencida fica como expired', (await admin.collection('couponRedemptions').where('couponId', '==', 'ULTIMO1').where('status', '==', 'expired').get()).size === 1);

// Duas reservas ao mesmo tempo no último cupom: só uma passa.
await admin.doc('coupons/ULTIMO1').update({ redeemedCount: 0 });
await admin.collection('couponRedemptions').where('couponId', '==', 'ULTIMO1').get().then(s => Promise.all(s.docs.map(d => d.ref.delete())));
const race = await Promise.all([
  quote('ULTIMO1', [line('fone')], 20, buyer, 'reserve'),
  quote('ULTIMO1', [line('fone')], 20, atelie, 'reserve'),
  quote('ULTIMO1', [line('fone')], 20, staff, 'reserve'),
]);
check('corrida no último cupom: exatamente 1 reserva', race.filter(x => x.status === 200).length === 1 && (await couponDoc('ULTIMO1')).redeemedCount === 1,
  race.map(x => x.status).join(','));

// ============================================================ pedido
console.log('\nPedido com cupom (regra + gatilho)');
r = await quote('LOJA15', [line('fone')], 20, buyer, 'reserve');
const live = r.json;
const goodCoupon = couponOf(live.redemptionId, live.quote);

let o = orderWrite('test-comprador', { ...goodCoupon, discount: 200, itemsDiscount: 200 });
check('pedido com desconto inflado é negado', !(await fsCommit(o.write, buyer)).ok);
o = orderWrite('test-comprador', { ...goodCoupon, redemptionId: 'aaaaaaaaaaaaaaaaaaaa' });
check('pedido com reserva inexistente é negado', !(await fsCommit(o.write, buyer)).ok);
o = orderWrite('test-atelie', goodCoupon);
check('pedido com a reserva de outra pessoa é negado', !(await fsCommit(o.write, atelie)).ok);
o = orderWrite('test-comprador', { ...goodCoupon, extra: 1 });
check('pedido com campo extra no cupom é negado', !(await fsCommit(o.write, buyer)).ok);
o = orderWrite('test-comprador', goodCoupon, { couponCheck: 'ok' });
check('cliente NÃO grava couponCheck', !(await fsCommit(o.write, buyer)).ok);
o = orderWrite('test-comprador', null);
check('pedido sem cupom continua passando', (await fsCommit(o.write, buyer)).ok);

const order1 = orderWrite('test-comprador', goodCoupon);
const order2 = orderWrite('test-comprador', goodCoupon);
// As duas no mesmo commit: as duas passam na regra (reserva aberta), o gatilho
// decide qual leva o cupom.
check('pedido com a reserva certa é aceito', (await fsCommit([order1.write, order2.write], buyer)).ok);
const checks = await waitFor(
  async () => Promise.all([order1.id, order2.id].map(async id => (await admin.doc(`orders/${id}`).get()).get('couponCheck'))),
  list => list.every(Boolean),
);
check('reserva usada 2x: um pedido ok e o outro inválido', checks.sort().join(',') === 'invalid,ok', checks.join(','));
const okOrder = checks[0] === 'ok' ? order1.id : order2.id;
const ok1 = (await admin.doc(`orders/${order1.id}`).get()).get('couponCheck') === 'ok';
const goodId = ok1 ? order1.id : order2.id;
const badId = ok1 ? order2.id : order1.id;
check('o inválido diz por quê', (await admin.doc(`orders/${badId}`).get()).get('couponCheckReason') === 'ALREADY_USED');
const used = await redemption(live.redemptionId);
check('reserva virou uso com o id do pedido', used.status === 'used' && used.orderId === goodId);
let c = await couponDoc('LOJA15');
check('cupom conta pedido e desconto dado', c.ordersCount === 1 && c.discountTotal === 59.98 && c.redeemedCount === 1, JSON.stringify(c));
r = await quote('LOJA15', [line('fone')], 20, buyer, 'reserve');
check('limite por pessoa (1): não reserva de novo', r.status === 409 && /já usou/.test(r.json.error || ''));
r = await quote('LOJA15', [line('fone')], 20, buyer);
check('o preview já avisa que usou', r.status === 409 && /já usou/.test(r.json.error || ''));
check('comprador NÃO troca o cupom do pedido', !(await fsCommit({
  update: { name: doc(`orders/${goodId}`), fields: fields({ coupon: { ...goodCoupon, discount: 300 } }) },
  updateMask: { fieldPaths: ['coupon'] },
}, buyer)).ok);
check('comprador NÃO limpa o couponCheck', !(await fsCommit({
  update: { name: doc(`orders/${badId}`), fields: fields({ couponCheck: 'ok' }) },
  updateMask: { fieldPaths: ['couponCheck'] },
}, buyer)).ok);
void okOrder;

// Cancelado: o uso volta.
await admin.doc(`orders/${goodId}`).update({ status: 'CANCELLED' });
const back = await waitFor(() => redemption(live.redemptionId), x => x.status === 'cancelled');
check('pedido cancelado devolve o uso', back.status === 'cancelled');
c = await couponDoc('LOJA15');
check('contadores voltam', c.ordersCount === 0 && c.redeemedCount === 0 && Math.abs(c.discountTotal) < 0.001, JSON.stringify(c));
r = await quote('LOJA15', [line('fone')], 20, buyer, 'reserve');
check('depois do cancelamento a pessoa pode usar de novo', r.status === 200, JSON.stringify(r.json));

// ============================================================ pagamento
console.log('\nConfirmação de pagamento');
const env = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8');
const hookToken = (env.match(/^ASAAS_WEBHOOK_TOKEN=(.*)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '');
if (!hookToken) {
  check('ASAAS_WEBHOOK_TOKEN no functions/.env (para testar a trava)', false);
} else {
  const hook = async (paymentId, value) => {
    const response = await fetch(`${FN}/asaasWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'asaas-access-token': hookToken },
      body: JSON.stringify({ id: `evt_${paymentId}`, event: 'PAYMENT_RECEIVED', payment: { id: paymentId, status: 'RECEIVED', value } }),
    });
    return response.json().catch(() => ({}));
  };
  await admin.doc(`orders/${badId}`).update({ asaasPaymentId: 'pay_cupom_invalido', total: 100 });
  await hook('pay_cupom_invalido', 100);
  const bad = (await admin.doc(`orders/${badId}`).get()).data();
  check('pagamento de pedido com cupom inválido NÃO aprova', bad.status === 'PENDING' && bad.paymentAlert?.reason === 'COUPON_INVALID', JSON.stringify({ s: bad.status, a: bad.paymentAlert }));

  const fresh = await quote('VINEON10', [line('fone')], 20, buyer, 'reserve');
  const paid = orderWrite('test-comprador', couponOf(fresh.json.redemptionId, fresh.json.quote), { asaasPaymentId: 'pay_cupom_ok', total: 379.91 });
  await fsCommit(paid.write, buyer);
  await waitFor(async () => (await admin.doc(`orders/${paid.id}`).get()).get('couponCheck'), Boolean);
  await hook('pay_cupom_ok', 379.91);
  const good = (await admin.doc(`orders/${paid.id}`).get()).data();
  check('pagamento de pedido com cupom válido aprova', good.status === 'RECEIVED' && !good.paymentAlert, JSON.stringify({ s: good.status, a: good.paymentAlert }));
}

// ============================================================ criar/editar
console.log('\nCriar e editar cupons (saveCoupon)');
const week = Date.now() + 7 * 86_400_000;
r = await fn('saveCoupon', { action: 'create', code: 'novaloja10', type: 'percent', value: 10, endsAt: week }, seller);
check('loja cria cupom', r.status === 200 && r.json.code === 'NOVALOJA10', JSON.stringify(r.json));
c = await couponDoc('NOVALOJA10');
check('cupom da loja nasce com dono, nome da loja e ativo', c?.scope === 'seller' && c.sellerId === 'test-vendedor' && c.sellerName === 'Loja de Teste' && c.status === 'active', JSON.stringify(c));
check('código repetido: 409', (await fn('saveCoupon', { action: 'create', code: 'VINEON10', type: 'percent', value: 10, endsAt: week }, seller)).status === 409);
check('código curto: 400', (await fn('saveCoupon', { action: 'create', code: 'AB', type: 'percent', value: 10, endsAt: week }, seller)).status === 400);
check('loja sem data final: 400', (await fn('saveCoupon', { action: 'create', code: 'SEMFIM10', type: 'percent', value: 10 }, seller)).status === 400);
check('loja com frete grátis: 400', (await fn('saveCoupon', { action: 'create', code: 'FRETELOJA', type: 'shipping', value: 0, endsAt: week }, seller)).status === 400);
check('porcentagem acima de 90: 400', (await fn('saveCoupon', { action: 'create', code: 'METADE95', type: 'percent', value: 95, endsAt: week }, seller)).status === 400);
check('desconto maior que a compra mínima: 400', (await fn('saveCoupon', { action: 'create', code: 'FIXO50', type: 'fixed', value: 50, minSubtotal: 30, endsAt: week }, seller)).status === 400);
check('loja escolhendo produto de outra loja: 400', (await fn('saveCoupon', { action: 'create', code: 'ALHEIO10', type: 'percent', value: 10, endsAt: week, productIds: ['bolsa-palha'] }, seller)).status === 400);
r = await fn('saveCoupon', { action: 'create', code: 'SOFONE10', type: 'fixed', value: 10, endsAt: week, productIds: ['fone'], visibility: 'private' }, seller);
check('loja escolhe produtos dela', r.status === 200 && (await couponDoc('SOFONE10')).productIds.join() === 'fone');
check('cliente NÃO cria cupom direto no Firestore', !(await fsCommit({ update: { name: doc('coupons/HACK50'), fields: fields({ code: 'HACK50', status: 'active', visibility: 'public', type: 'percent', value: 50 }) } }, seller)).ok);

check('outra conta NÃO edita o cupom da loja', (await fn('saveCoupon', { action: 'update', code: 'LOJA15', type: 'percent', value: 50, endsAt: week }, atelie)).status === 403);
r = await fn('saveCoupon', { action: 'update', code: 'LOJA15', type: 'percent', value: 20, maxDiscount: 80, endsAt: week }, seller);
check('loja edita o próprio cupom', r.status === 200 && (await couponDoc('LOJA15')).value === 20);
check('admin NÃO edita regra do cupom da loja', (await fn('saveCoupon', { action: 'update', code: 'LOJA15', type: 'percent', value: 90, endsAt: week }, staff)).status === 403);
check('admin pausa cupom da loja (moderação)', (await fn('saveCoupon', { action: 'status', code: 'LOJA15', status: 'paused' }, staff)).status === 200 && (await couponDoc('LOJA15')).pausedByAdmin === true);
check('loja NÃO reativa o que a Vineon pausou', (await fn('saveCoupon', { action: 'status', code: 'LOJA15', status: 'active' }, seller)).status === 403);
check('admin reativa', (await fn('saveCoupon', { action: 'status', code: 'LOJA15', status: 'active' }, staff)).status === 200);
check('loja pausa o próprio', (await fn('saveCoupon', { action: 'status', code: 'NOVALOJA10', status: 'paused' }, seller)).status === 200);
check('loja reativa o próprio', (await fn('saveCoupon', { action: 'status', code: 'NOVALOJA10', status: 'active' }, seller)).status === 200);

r = await fn('saveCoupon', { action: 'create', code: 'BLACK30', type: 'shipping', value: 0, minSubtotal: 99, visibility: 'public', firstPurchaseOnly: true }, staff);
c = await couponDoc('BLACK30');
check('admin cria cupom da Vineon (frete grátis, sem data final)', r.status === 200 && c.scope === 'platform' && c.sellerId === null && c.endsAt === null && c.firstPurchaseOnly === true, JSON.stringify(r.json));
check('apagar cupom já usado: 409', (await fn('saveCoupon', { action: 'delete', code: 'VINEON10' }, staff)).status === 409);
check('apagar cupom nunca usado', (await fn('saveCoupon', { action: 'delete', code: 'SOFONE10' }, seller)).status === 200 && !(await couponDoc('SOFONE10')));
check('encerrar', (await fn('saveCoupon', { action: 'status', code: 'NOVALOJA10', status: 'ended' }, seller)).status === 200);
check('encerrado não volta', (await fn('saveCoupon', { action: 'status', code: 'NOVALOJA10', status: 'active' }, seller)).status === 409);

// ============================================================ leitura
console.log('\nRegras do Firestore — leitura de cupons');
check('visitante sem conta lê cupom público ativo', (await fsGet('coupons/VINEON10', null)).status === 200);
check('visitante NÃO lê cupom privado', (await fsGet('coupons/MARE20', null)).status === 403);
check('comprador NÃO lê cupom privado', (await fsGet('coupons/MARE20', buyer)).status === 403);
check('dona lê o próprio cupom privado', (await fsGet('coupons/MARE20', atelie)).status === 200);
check('admin lê privado', (await fsGet('coupons/MARE20', staff)).status === 200);
check('ninguém lê cupom pausado de outra loja', (await fsGet('coupons/PAUSADO', buyer)).status === 403);
let list = await fsList('coupons', null, [['visibility', 'public'], ['status', 'active']]);
check('lista de públicos ativos funciona sem conta', !list.denied && list.count >= 4, `(count=${list.count})`);
list = await fsList('coupons', null, [['sellerId', 'test-vendedor'], ['visibility', 'public'], ['status', 'active']]);
check('cupons públicos de uma loja (ficha do produto)', !list.denied && list.count === 1, `(count=${list.count})`);
check('lista sem filtro é negada', (await fsList('coupons', buyer)).denied);
list = await fsList('coupons', seller, [['sellerId', 'test-vendedor']]);
check('loja lista todos os dela (inclusive pausado/encerrado)', !list.denied && list.count === 3, `(count=${list.count})`);
check('lista dos cupons de outra loja é negada', (await fsList('coupons', buyer, [['sellerId', 'test-atelie']])).denied);
check('admin lista tudo', !(await fsList('coupons', staff)).denied);

// ============================================================ força bruta
console.log('\nTentativa e erro de código');
let blocked = 0;
for (let i = 0; i < 17; i++) {
  const x = await quote(`CHUTE${i}X`, [line('fone')], 20, seller);
  if (x.status === 429) blocked++;
}
check('depois de 15 códigos errados, 429', blocked >= 1, `(bloqueados=${blocked})`);

console.log(`\n${pass} ok, ${fail} falha(s)`);
if (fail) {
  console.log(failures.map(f => ` - ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
