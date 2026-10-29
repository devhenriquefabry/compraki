// Bateria de quem paga o frete grátis (`shippingInfo.sellerShippingCost`):
// a loja paga a etiqueta quando ELA marcou "Frete Grátis" no anúncio; frete
// grátis da Vineon (regra por valor) a Vineon paga; pedido de várias lojas
// divide pelo valor dos produtos; entrega da loja e frete cobrado não geram custo.
//
//   functions/.env.local apontando para os falsos (ver docs/testes-com-emulador.md)
//   node functions/scripts/fake-integrations.mjs   (Melhor Envio falso)
//   npm run emulators
//   node functions/scripts/free-shipping-cost.test.mjs

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
// Melhor Envio falso: PAC (1) R$ 24,90. Seed: smartphone (Loja de Teste,
// "Frete Grátis", R$ 1.699,90), camiseta (Loja de Teste, "Frete Grátis",
// R$ 49,90), colar-conchas (Ateliê, "Frete Grátis", R$ 79,90), fone (Loja de
// Teste, "A combinar", R$ 399,90).
await db.doc('settings/melhor_envio').set({
  accessToken: 'token-falso', isSandbox: true,
  senderName: 'Vineon Envios', senderPhone: '11999999999', senderEmail: 'envios@vineon.test', senderCpfCnpj: '11222333000181',
  address: { street: 'Rua A', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01001000' },
});
const rule = minValue => db.doc('appConfig/storefront').set({ freeShipping: { enabled: minValue > 0, minValue } }, { merge: true });
await rule(0);

const buyerTok = await login('comprador@vineon.test');
const BUYER = { name: 'Comprador de Teste', cpf: (await db.doc('users/test-comprador').get()).get('cpf'), phone: '11990000003' };
const ADDRESS = { street: 'Avenida Paulista', number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', postalCode: '01310-100' };
const line = (productId, quantity = 1) => ({ productId, skuId: null, quantity });
const place = (items, shippingServiceId = 1) =>
  fn('placeOrder', { items, shippingServiceId, address: ADDRESS, buyer: BUYER, method: 'PIX' }, buyerTok);
const costOf = async r => {
  const o = await order(r.json.orderId);
  await park(r.json.orderId);
  return o?.shippingInfo?.sellerShippingCost;
};

console.log('\nFrete grátis escolhido pela loja');
let r = await place([line('smartphone')]);
let cost = await costOf(r);
check('loja marcou frete grátis: comprador paga R$ 0', r.status === 200 && r.json.shipping === 0, JSON.stringify(r.json));
check('... e a etiqueta inteira (R$ 24,90) fica com a loja', JSON.stringify(cost) === '{"test-vendedor":24.9}', JSON.stringify(cost));

r = await place([line('smartphone'), line('colar-conchas')]);
cost = await costOf(r);
check('duas lojas com frete grátis: dividido pelo valor (R$ 23,78 + R$ 1,11)', r.status === 200 && cost?.['test-vendedor'] === 23.78 && cost?.['test-atelie'] === 1.11, JSON.stringify(cost));
check('a soma nunca passa da etiqueta', Math.round(((cost?.['test-vendedor'] ?? 0) + (cost?.['test-atelie'] ?? 0)) * 100) <= 2490);

console.log('\nFrete grátis da Vineon');
await rule(300);
r = await place([line('fone')]);
cost = await costOf(r);
check('regra da Vineon (R$ 300+) num produto "A combinar": nada para a loja', r.status === 200 && r.json.shipping === 0 && cost === undefined, JSON.stringify(cost));
r = await place([line('smartphone')]);
cost = await costOf(r);
check('loja marcou, mas a regra da Vineon já cobre: a Vineon paga', r.status === 200 && r.json.shipping === 0 && cost === undefined, JSON.stringify(cost));
r = await place([line('smartphone'), line('camiseta')]);
cost = await costOf(r);
check('misto: a loja paga só a parte do item abaixo do mínimo (R$ 0,71)', r.status === 200 && r.json.shipping === 0 && JSON.stringify(cost) === '{"test-vendedor":0.71}', JSON.stringify(cost));
await rule(0);

console.log('\nSem frete grátis');
r = await place([line('smartphone'), line('fone')]);
cost = await costOf(r);
check('frete cobrado do comprador: nada para a loja', r.status === 200 && r.json.shipping === 24.9 && cost === undefined, JSON.stringify(cost));
await db.doc('products/fone').update({ localDelivery: { cities: [{ city: 'São Paulo', state: 'SP' }], days: 1, onlyLocal: false } });
r = await place([line('fone')], 'local');
cost = await costOf(r);
check('entrega da própria loja: sem etiqueta, nada a descontar', r.status === 200 && r.json.shipping === 0 && cost === undefined, JSON.stringify(cost));

console.log(`\n${pass} ok, ${fail} falha(s)`);
if (fail) {
  console.log(failures.map(f => ` - ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
