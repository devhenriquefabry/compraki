// Bateria da entrega grátis da loja (`products/{id}.localDelivery`): o
// `placeOrder` só aceita "Entrega da loja" quando todos os itens são
// entregues pela loja na cidade do endereço, item "só entrego nessas cidades"
// não vai por transportadora, o pedido sai sem frete e sem etiqueta, e a regra
// do Firestore barra configuração malformada.
//
//   functions/.env.local apontando para os falsos (ver docs/testes-com-emulador.md)
//   node functions/scripts/fake-integrations.mjs   (Melhor Envio falso)
//   npm run emulators
//   node functions/scripts/local-delivery.test.mjs
//
// Roda o seed primeiro. Só funciona contra projeto `demo-*`.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

const fieldPath = dotted => dotted.split('.').map(seg => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg) ? seg : `\`${seg}\``)).join('.');

function patch(path, data, now = []) {
  return {
    update: { name: docName(path), fields: fields(data) },
    updateMask: { fieldPaths: Object.keys(data).map(fieldPath) },
    ...(now.length ? { updateTransforms: now.map(p => ({ fieldPath: fieldPath(p), setToServerValue: 'REQUEST_TIME' })) } : {}),
  };
}

function create(path, data) {
  return { update: { name: docName(path), fields: fields(data) }, currentDocument: { exists: false } };
}

async function fn(name, body, token) {
  const response = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

const order = async id => (await db.doc(`orders/${id}`).get()).data();

/** Pedido de teste fora do caminho: o teto de 10 pedidos esperando pagamento é por pessoa. */
async function park(orderId) {
  if (orderId) await db.doc(`orders/${orderId}`).update({ status: 'CANCELLED' });
}

// ---------------------------------------------------------------- cenário
// Melhor Envio falso: PAC (1) R$ 24,90, SEDEX (2) R$ 39,50.
await db.doc('settings/melhor_envio').set({
  accessToken: 'token-falso', isSandbox: true,
  senderName: 'Vineon Envios', senderPhone: '11999999999', senderEmail: 'envios@vineon.test', senderCpfCnpj: '11222333000181',
  address: { street: 'Rua A', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01001000' },
});
await db.doc('appConfig/storefront').set({ freeShipping: { enabled: false, minValue: 0 } }, { merge: true });

const baseProduct = (name, price, sellerId) => ({
  name, price, description: `${name}. Teste da entrega da loja.`, photoURL: [], condition: 'novo', stock: 50, soldCount: 0,
  categoryIds: ['casa'], subcategoryIds: ['cozinha'], paymentMethods: ['PIX'], shipping: 'A combinar',
  weight: 0.5, width: 20, height: 10, length: 20, sellerId,
});
// Loja de Teste: entrega em São Paulo em 1 dia e também envia pelos Correios.
await db.doc('products/ld-cesta').set({
  ...baseProduct('Cesta de café da manhã', 120, 'test-vendedor'),
  localDelivery: { cities: [{ city: 'São Paulo', state: 'SP' }, { city: 'Osasco', state: 'SP' }], days: 1, onlyLocal: false },
});
// Ateliê: só entrega em São Paulo, no mesmo dia (grafia sem acento e UF minúscula de propósito).
await db.doc('products/ld-bolo').set({
  ...baseProduct('Bolo de pote', 45, 'test-atelie'),
  localDelivery: { cities: [{ city: 'Sao  Paulo', state: 'sp' }], days: 0, onlyLocal: true },
});

const buyerTok = await login('comprador@vineon.test');
const sellerTok = await login('vendedor@vineon.test');

const BUYER = {
  name: 'Comprador de Teste',
  cpf: (await db.doc('users/test-comprador').get()).get('cpf'),
  phone: '11990000003',
};
const SAO_PAULO = { street: 'Avenida Paulista', number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', postalCode: '01310-100' };
const CAMPINAS = { street: 'Rua Barão de Jaguara', number: '50', neighborhood: 'Centro', city: 'Campinas', state: 'SP', postalCode: '13015-000' };
const line = (productId, quantity = 1) => ({ productId, skuId: null, quantity });
const place = (items, shippingServiceId, address = SAO_PAULO, extra = {}) =>
  fn('placeOrder', { items, shippingServiceId, address, buyer: BUYER, method: 'PIX', ...extra }, buyerTok);

// ====================================================== entrega da loja
console.log('\nEntrega da loja no placeOrder');
let r = await place([line('ld-cesta')], 'local', SAO_PAULO, { expectedTotal: 120 });
check('cesta em São Paulo com entrega da loja: só o produto (R$ 120,00)', r.status === 200 && r.json.total === 120 && r.json.shipping === 0, JSON.stringify(r.json));
let o = await order(r.json.orderId);
check('pedido marca entrega da loja, sem serviço do Melhor Envio', o?.shippingInfo?.localDelivery === true && o?.shippingInfo?.serviceId === null && o?.shippingInfo?.serviceName === 'Entrega da loja', JSON.stringify(o?.shippingInfo));
check('pedido sem frete: grátis, custo de etiqueta zero, prazo da loja', o?.shippingCost === 0 && o?.shippingInfo?.freeShipping === true && o?.shippingInfo?.quotedPrice === 0 && o?.shippingInfo?.deliveryTime === 1);
check('item guarda a configuração da entrega da loja', o?.items?.[0]?.productData?.localDelivery?.cities?.length === 2 && o?.items?.[0]?.productData?.localDelivery?.days === 1);
const localOrderId = r.json.orderId;

r = await place([line('ld-cesta'), line('ld-bolo', 2)], 'local');
check('duas lojas que entregam em São Paulo: grátis, prazo da mais lenta', r.status === 200 && r.json.shipping === 0 && r.json.total === 210, JSON.stringify(r.json));
o = await order(r.json.orderId);
check('pedido com duas lojas: prazo 1 dia e as duas em sellerIds', o?.shippingInfo?.deliveryTime === 1 && o?.sellerIds?.length === 2);
await park(r.json.orderId);

r = await place([line('ld-bolo')], 'local');
check('grafia e UF diferentes no anúncio ("Sao  Paulo"/"sp") ainda batem', r.status === 200 && r.json.total === 45, JSON.stringify(r.json));
o = await order(r.json.orderId);
check('"mesmo dia" vira prazo 0', o?.shippingInfo?.deliveryTime === 0);
await park(r.json.orderId);

r = await place([line('ld-cesta')], 'local', { ...SAO_PAULO, city: 'Osasco', postalCode: '06010-000' });
check('segunda cidade da lista (Osasco) também tem entrega da loja', r.status === 200 && r.json.shipping === 0, JSON.stringify(r.json));
await park(r.json.orderId);

console.log('\nTransportadora e recusas');
r = await place([line('ld-cesta')], 'local', CAMPINAS);
check('entrega da loja fora das cidades dela: 409 SHIPPING_UNAVAILABLE', r.status === 409 && r.json.reason === 'SHIPPING_UNAVAILABLE', JSON.stringify(r.json));
r = await place([line('ld-cesta')], 1, CAMPINAS);
check('fora das cidades, a cesta vai pelo PAC: R$ 120,00 + R$ 24,90', r.status === 200 && r.json.shipping === 24.9 && r.json.total === 144.9, JSON.stringify(r.json));
await park(r.json.orderId);
r = await place([line('ld-cesta')], 1);
check('app antigo pedindo PAC em São Paulo: aceito (a loja também envia)', r.status === 200 && r.json.shipping === 24.9, JSON.stringify(r.json));
await park(r.json.orderId);

r = await place([line('ld-bolo')], 1, CAMPINAS);
check('produto só da cidade, comprador fora: 409 explicando onde a loja entrega', r.status === 409 && r.json.reason === 'SHIPPING_UNAVAILABLE' && /só pela própria loja, em Sao Paulo\/SP/.test(r.json.error || ''), JSON.stringify(r.json));
r = await place([line('ld-bolo')], 'local', CAMPINAS);
check('... e também pela entrega da loja', r.status === 409 && r.json.reason === 'SHIPPING_UNAVAILABLE', JSON.stringify(r.json));
r = await place([line('ld-bolo')], 1);
check('produto só da cidade não vai por transportadora nem para quem mora lá', r.status === 409 && /entregue pela própria loja/.test(r.json.error || ''), JSON.stringify(r.json));

r = await place([line('ld-bolo'), line('fone')], 1);
check('só-da-cidade junto com item sem entrega da loja: 409 (faça pedidos separados)', r.status === 409 && /pedido só com ele/.test(r.json.error || ''), JSON.stringify(r.json));
r = await place([line('ld-cesta'), line('fone')], 'local');
check('carrinho misto não tem entrega da loja: 409', r.status === 409 && r.json.reason === 'SHIPPING_UNAVAILABLE', JSON.stringify(r.json));
r = await place([line('ld-cesta'), line('fone')], 1);
check('carrinho misto vai inteiro pela transportadora: frete cobrado', r.status === 200 && r.json.shipping === 24.9 && r.json.total === Math.round((120 + 399.9 + 24.9) * 100) / 100, JSON.stringify(r.json));
await park(r.json.orderId);

r = await place([line('ld-cesta')], 'retirada');
check('forma de entrega desconhecida: 400', r.status === 400, JSON.stringify(r.json));
r = await place([line('ld-cesta')], 'local', SAO_PAULO, { expectedTotal: 144.9 });
check('total visto com frete, servidor sem frete: 409 TOTAL_CHANGED', r.status === 409 && r.json.reason === 'TOTAL_CHANGED' && r.json.total === 120, JSON.stringify(r.json));

// Anúncio desligou a entrega depois que o item entrou no carrinho.
await db.doc('products/ld-cesta').update({ localDelivery: null });
r = await place([line('ld-cesta')], 'local');
check('loja desligou a entrega: o servidor recusa a entrega da loja', r.status === 409 && r.json.reason === 'SHIPPING_UNAVAILABLE', JSON.stringify(r.json));
await db.doc('products/ld-cesta').update({ localDelivery: { cities: [{ city: 'São Paulo', state: 'SP' }], days: 1, onlyLocal: false } });

// ======================================================== depois de pago
console.log('\nVenda com entrega da loja');
await db.doc(`orders/${localOrderId}`).update({ status: 'CONFIRMED' });
r = await fn('createMelhorEnvioShipment', { orderId: localOrderId }, sellerTok);
check('sem etiqueta do Melhor Envio (nada sai do saldo da Vineon)', r.status === 409 && /não tem forma de entrega do Melhor Envio/.test(r.json.error || ''), JSON.stringify(r.json));
let w = await fsCommit(patch(`orders/${localOrderId}`, { shipmentStatus: 'SHIPPED' }, ['shippedAt', 'updatedAt']), sellerTok);
check('loja marca "saiu para entrega" sem rastreio', w.ok, JSON.stringify(w.body));
w = await fsCommit(patch(`orders/${localOrderId}`, { shipmentStatus: 'DELIVERED' }, ['deliveredAt', 'updatedAt']), sellerTok);
check('loja marca entregue', w.ok, JSON.stringify(w.body));
o = await order(localOrderId);
check('pedido entregue com data do servidor', o?.shipmentStatus === 'DELIVERED' && !!o?.deliveredAt);

// ================================================================ regras
console.log('\nRegra do anúncio (localDelivery)');
// Sem `soldCount`: a regra não deixa o vendedor escrever o contador de vendidos.
const listing = extra => {
  const { soldCount, ...data } = baseProduct('Anúncio de teste', 50, 'test-vendedor');
  return { ...data, ...extra };
};
const tryCreate = async (id, extra) => (await fsCommit(create(`products/${id}`, listing(extra)), sellerTok)).ok;
check('anúncio com entrega da loja válida: aceito', await tryCreate('ld-rule-ok', { localDelivery: { cities: [{ city: 'Curitiba', state: 'PR' }], days: 2, onlyLocal: true } }));
check('anúncio com entrega desligada (null): aceito', await tryCreate('ld-rule-null', { localDelivery: null }));
check('anúncio sem o campo: aceito', await tryCreate('ld-rule-none', {}));
check('prazo de 30 dias: negado', !(await tryCreate('ld-rule-days', { localDelivery: { cities: [{ city: 'Curitiba', state: 'PR' }], days: 30, onlyLocal: false } })));
check('sem cidade: negado', !(await tryCreate('ld-rule-empty', { localDelivery: { cities: [], days: 1, onlyLocal: false } })));
check('21 cidades: negado', !(await tryCreate('ld-rule-many', { localDelivery: { cities: Array.from({ length: 21 }, (_, i) => ({ city: `Cidade ${i}`, state: 'PR' })), days: 1, onlyLocal: false } })));
check('campo a mais (preço do frete): negado', !(await tryCreate('ld-rule-extra', { localDelivery: { cities: [{ city: 'Curitiba', state: 'PR' }], days: 1, onlyLocal: false, price: -10 } })));
check('onlyLocal que não é booleano: negado', !(await tryCreate('ld-rule-bool', { localDelivery: { cities: [{ city: 'Curitiba', state: 'PR' }], days: 1, onlyLocal: 'sim' } })));
w = await fsCommit(patch('products/ld-rule-ok', { localDelivery: { cities: [{ city: 'Curitiba', state: 'PR' }], days: 99, onlyLocal: true } }), sellerTok);
check('editar para prazo inválido: negado', !w.ok);
w = await fsCommit(patch('products/ld-rule-ok', { localDelivery: null }), sellerTok);
check('desligar a entrega na edição: aceito', w.ok, JSON.stringify(w.body));

console.log(`\n${pass} ok, ${fail} falha(s)`);
if (fail) {
  console.log(failures.map(f => ` - ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
