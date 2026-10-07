// Bateria das integrações contra os emuladores, com Melhor Envio e Evolution
// API (WhatsApp) FALSOS (functions/scripts/fake-integrations.mjs):
// frete, etiqueta da loja, configuração do Melhor Envio no admin, WhatsApp do
// admin, gatilhos, recuperação de senha por WhatsApp, bots e funções de admin.
//
//   1. functions/.env.local com MELHOR_ENVIO_API_URL, EVOLUTION_API_URL,
//      EVOLUTION_API_KEY e MELHOR_ENVIO_WEBHOOK_SECRET (ver fake-integrations.mjs)
//   2. node functions/scripts/fake-integrations.mjs
//   3. npm run emulators
//   4. node functions/scripts/integrations.test.mjs
//
// Roda o seed primeiro. Só funciona contra projeto `demo-*`.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = process.env.EMULATOR_PROJECT_ID || 'demo-vineon';
if (!PROJECT.startsWith('demo-')) throw new Error('Só roda em projeto demo.');
const HOST = '127.0.0.1';
const FN = `http://${HOST}:5001/${PROJECT}/us-central1`;
const FS = `http://${HOST}:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FAKE_LOG = process.env.FAKE_LOG || `${process.env.TEMP || '/tmp'}/fake-integrations.jsonl`;
const PASSWORD = 'vineon-teste';
const ME_TOKEN = 'token-falso-melhorenvio-9876';

process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:8080`;
process.env.GCLOUD_PROJECT = PROJECT;
execFileSync('node', [fileURLToPath(new URL('./emulator-seed.mjs', import.meta.url))], { stdio: 'ignore' });
initializeApp({ projectId: PROJECT });
const db = getFirestore();

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, extra = '') {
  if (ok) pass++;
  else { fail++; failures.push(`${name} ${extra}`); }
  console.log(`${ok ? '  ok ' : ' FALHA'}  ${name}${ok ? '' : ` ${String(extra).slice(0, 300)}`}`);
}

async function login(email) {
  const r = await fetch(`http://${HOST}:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const data = await r.json();
  if (!data.idToken) throw new Error(`login ${email}: ${JSON.stringify(data)}`);
  return data.idToken;
}

async function fn(name, token, { method = 'POST', body } = {}) {
  const r = await fetch(`${FN}/${name}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* não-JSON */ }
  return { status: r.status, json, text };
}

const fakeCalls = () => (existsSync(FAKE_LOG) ? readFileSync(FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const callsSince = (t, service, pathPart) => fakeCalls().filter(c => c.at >= t && c.service === service && (!pathPart || c.path.includes(pathPart)));

const admin = await login('admin@vineon.test');
const seller = await login('vendedor@vineon.test');
const otherSeller = await login('atelie@vineon.test');
const buyer = await login('comprador@vineon.test');

// ============================================== Melhor Envio: configuração
console.log('\nMelhor Envio — configuração no admin');
let r = await fn('melhorEnvioSettings', admin, { method: 'GET' });
check('admin lê a configuração (vazia no seed)', r.status === 200 && r.json.hasToken === false, r.text);
check('loja NÃO lê a configuração', (await fn('melhorEnvioSettings', seller, { method: 'GET' })).status === 403);
check('sem login NÃO lê', (await fn('melhorEnvioSettings', null, { method: 'GET' })).status === 401);

const settings = {
  accessToken: ME_TOKEN, isSandbox: true,
  senderName: 'Vineon Envios', senderPhone: '(11) 98888-7777', senderEmail: 'envios@vineon.test', senderCpfCnpj: '12.345.678/0001-95',
  address: { street: 'Rua das Flores', number: '100', complement: 'Galpão 2', district: 'Centro', city: 'São Paulo', state: 'sp', zipCode: '01001-000' },
};
r = await fn('melhorEnvioSettings', admin, { body: settings });
check('admin salva a configuração', r.status === 200 && r.json.hasToken === true && r.json.tokenEnd === '9876', r.text);
check('a resposta NUNCA traz o token', !r.text.includes(ME_TOKEN) && !('accessToken' in (r.json.config || {})), r.text);
check('UF vai em maiúscula', r.json.config?.address?.state === 'SP');
r = await fn('melhorEnvioSettings', admin, { body: { ...settings, accessToken: '', senderName: 'Vineon Envios Ltda' } });
const stored = (await db.doc('settings/melhor_envio').get()).data();
check('salvar com token vazio mantém o token e troca o resto', stored.accessToken === ME_TOKEN && stored.senderName === 'Vineon Envios Ltda', JSON.stringify(stored));
check('loja NÃO salva a configuração', (await fn('melhorEnvioSettings', seller, { body: { ...settings, accessToken: 'roubado' } })).status === 403);
const ruleRead = await fetch(`${FS}/settings/melhor_envio`, { headers: { Authorization: `Bearer ${admin}` } });
check('nem admin lê settings/ direto no Firestore (token fica no servidor)', ruleRead.status === 403);

// ===================================================== Melhor Envio: frete
console.log('\nMelhor Envio — cotação do checkout');
let t0 = Date.now();
r = await fn('calculateMelhorEnvioShipping', buyer, { body: { zipTo: '01310-100', products: [{ id: 'fone', width: 20, height: 10, length: 20, weight: 0.5, insurance_value: 399.9, quantity: 1 }] } });
check('comprador cota o frete', r.status === 200 && Array.isArray(r.json) && r.json.some(q => q.name === 'PAC'), r.text);
let calc = callsSince(t0, 'melhorenvio', '/shipment/calculate')[0];
check('cotação sai do CEP de origem configurado e com o token salvo', calc?.body?.from?.postal_code === '01001000' && calc?.auth === `Bearer ${ME_TOKEN}`, JSON.stringify(calc));
check('cotação sem login: 401', (await fn('calculateMelhorEnvioShipping', null, { body: { zipTo: '01310100', products: [{ id: 'x' }] } })).status === 401);
check('cotação sem CEP: 400', (await fn('calculateMelhorEnvioShipping', buyer, { body: { products: [] } })).status === 400);

// ===================================================== Melhor Envio: etiqueta
console.log('\nMelhor Envio — etiqueta da loja');
// Pedido pago da Loja de Teste, ainda sem etiqueta.
const paidSnap = await db.collection('orders').where('sellerIds', 'array-contains', 'test-vendedor').get();
const sellerOrders = paidSnap.docs.filter(d => !(d.get('sellerIds') || []).includes('test-atelie'));
const [o1, o2, o3, o4, o5] = sellerOrders.map(d => d.ref);
for (const ref of [o1, o2, o3, o4, o5]) {
  await ref.update({ status: 'RECEIVED', shipmentStatus: null, deliveredAt: null, 'shippingInfo.shipmentId': null, 'shippingInfo.labelStatus': null, 'shippingInfo.serviceId': 1, refundInfo: null });
}

check('comprador NÃO gera etiqueta (404)', (await fn('createMelhorEnvioShipment', buyer, { body: { orderId: o1.id } })).status === 404);
check('outra loja NÃO gera etiqueta (404)', (await fn('createMelhorEnvioShipment', otherSeller, { body: { orderId: o1.id } })).status === 404);
check('pedido inexistente: 404', (await fn('createMelhorEnvioShipment', seller, { body: { orderId: 'naoexiste' } })).status === 404);
check('formato antigo (payload do navegador) é recusado', (await fn('createMelhorEnvioShipment', seller, { body: { service: 1, from: {}, to: {} } })).status === 400);
await o2.update({ status: 'PENDING' });
r = await fn('createMelhorEnvioShipment', seller, { body: { orderId: o2.id } });
check('pedido não pago: 409', r.status === 409 && /pagamento/i.test(r.json.error || ''), r.text);

t0 = Date.now();
r = await fn('createMelhorEnvioShipment', seller, { body: { orderId: o1.id } });
check('loja gera a etiqueta do pedido pago', r.status === 200 && r.json.labelStatus === 'generated' && /^fake-ord-/.test(r.json.shipmentId || ''), r.text);
const cart = callsSince(t0, 'melhorenvio', '/me/cart')[0];
const order1 = (await o1.get()).data();
check('remetente vem da configuração (não do navegador)', cart?.body?.from?.name === 'Vineon Envios Ltda' && cart?.body?.from?.postal_code === '01001000' && cart?.body?.from?.state_abbr === 'SP', JSON.stringify(cart?.body?.from));
check('CNPJ do remetente vai em company_document (CPF do comprador em document)', cart?.body?.from?.company_document === '12345678000195' && !cart?.body?.from?.document && /^\d{11}$/.test(cart?.body?.to?.document || ''), JSON.stringify({ from: cart?.body?.from, to: cart?.body?.to?.document }));
check('um volume só (regra dos Correios)', cart?.body?.volumes?.length === 1, JSON.stringify(cart?.body?.volumes));
check('destinatário vem do pedido', cart?.body?.to?.postal_code === String(order1.addressData.postalCode).replace(/\D/g, '') && cart?.body?.to?.name === order1.customerData.name, JSON.stringify(cart?.body?.to));
check('serviço do frete escolhido no checkout', cart?.body?.service === 1);
check('compra e geração chamadas com o envio criado', callsSince(t0, 'melhorenvio', '/shipment/checkout')[0]?.body?.orders?.[0] === r.json.shipmentId && callsSince(t0, 'melhorenvio', '/shipment/generate')[0]?.body?.orders?.[0] === r.json.shipmentId);
check('pedido guarda o envio e o passo final', order1.shippingInfo.shipmentId === r.json.shipmentId && order1.shippingInfo.labelStatus === 'generated' && !!order1.shippingInfo.labelGeneratedAt, JSON.stringify(order1.shippingInfo));

t0 = Date.now();
r = await fn('createMelhorEnvioShipment', seller, { body: { orderId: o1.id } });
check('gerar de novo não compra outra etiqueta', r.status === 200 && r.json.existing === true && callsSince(t0, 'melhorenvio', '/me/cart').length === 0, r.text);

// Parou no meio (carrinho criado, compra falhou): retoma sem criar outro carrinho.
await o3.update({ 'shippingInfo.shipmentId': 'fake-ord-retomar', 'shippingInfo.labelStatus': 'cart' });
t0 = Date.now();
r = await fn('createMelhorEnvioShipment', seller, { body: { orderId: o3.id } });
check('retoma de onde parou (sem novo carrinho)', r.status === 200 && r.json.shipmentId === 'fake-ord-retomar' && callsSince(t0, 'melhorenvio', '/me/cart').length === 0 && callsSince(t0, 'melhorenvio', '/shipment/checkout').length === 1, r.text);

// Dois cliques ao mesmo tempo: uma etiqueta só.
t0 = Date.now();
const both = await Promise.all([1, 2].map(() => fn('createMelhorEnvioShipment', seller, { body: { orderId: o4.id } })));
check('dois cliques ao mesmo tempo: só uma compra', callsSince(t0, 'melhorenvio', '/me/cart').length === 1 && both.some(x => x.status === 200), both.map(x => `${x.status}:${x.json.error || x.json.labelStatus}`).join(' | '));

// Configuração incompleta: erro claro, nada comprado.
await db.doc('settings/melhor_envio').update({ senderCpfCnpj: '' });
await o2.update({ status: 'RECEIVED' });
t0 = Date.now();
r = await fn('createMelhorEnvioShipment', seller, { body: { orderId: o2.id } });
check('configuração incompleta: 503 explicando o que falta', r.status === 503 && /CPF\/CNPJ/.test(r.json.error || '') && callsSince(t0, 'melhorenvio', '/me/cart').length === 0, r.text);
await db.doc('settings/melhor_envio').update({ senderCpfCnpj: '12.345.678/0001-95' });

// Pedido com vários produtos: continua uma caixa só, com os pesos somados.
const o2data = (await o2.get()).data();
const base = o2data.items[0];
await o2.update({ items: [
  { ...base, quantity: 2, productData: { ...base.productData, weight: 0.5, height: 10, width: 20, length: 20 } },
  { ...base, productId: 'camiseta', quantity: 1, productData: { ...base.productData, id: 'camiseta', name: 'Camiseta', weight: 0.3, height: 4, width: 30, length: 25 } },
] });
t0 = Date.now();
r = await fn('createMelhorEnvioShipment', seller, { body: { orderId: o2.id } });
const multi = callsSince(t0, 'melhorenvio', '/me/cart')[0]?.body;
check('pedido com vários produtos: etiqueta aceita', r.status === 200 && r.json.labelStatus === 'generated', r.text);
check('caixa única: maior largura/comprimento, alturas empilhadas, peso somado', JSON.stringify(multi?.volumes) === JSON.stringify([{ height: 24, width: 30, length: 25, weight: 1.3 }]), JSON.stringify(multi?.volumes));
check('declaração de conteúdo com cada produto', multi?.products?.length === 2 && multi.products[0].quantity === '2', JSON.stringify(multi?.products));

console.log('\nMelhor Envio — imprimir, rastrear, admin e webhook');
r = await fn('printMelhorEnvioLabel', seller, { body: { orderId: o1.id } });
check('loja abre o PDF da etiqueta', r.status === 200 && /\/label\/fake-ord-.*\.pdf$/.test(r.json.url || ''), r.text);
check('comprador NÃO imprime (404)', (await fn('printMelhorEnvioLabel', buyer, { body: { orderId: o1.id } })).status === 404);
check('imprimir antes de gerar: 409', (await fn('printMelhorEnvioLabel', seller, { body: { orderId: o5.id } })).status === 409);
check('loja NÃO imprime por id solto de envio (só admin)', (await fn('printMelhorEnvioLabel', seller, { body: { shipmentIds: ['qualquer'] } })).status === 403);
check('admin imprime por id de envio', (await fn('printMelhorEnvioLabel', admin, { body: { shipmentIds: [order1.shippingInfo.shipmentId] } })).status === 200);
r = await fn('trackMelhorEnvioShipment', buyer, { body: { orderId: o1.id } });
check('comprador rastreia o próprio pedido', r.status === 200 && JSON.stringify(r.json).includes('BR123456789BR'), r.text);
check('outra loja NÃO rastreia (404)', (await fn('trackMelhorEnvioShipment', otherSeller, { body: { orderId: o1.id } })).status === 404);
check('loja NÃO compra envio avulso (checkout é só admin)', (await fn('checkoutMelhorEnvioShipment', seller, { body: { shipmentIds: ['x'] } })).status === 403);
check('loja NÃO gera envio avulso (só admin)', (await fn('generateMelhorEnvioLabel', seller, { body: { shipmentIds: ['x'] } })).status === 403);
r = await fn('getMelhorEnvioMe', admin, { method: 'GET' });
check('admin vê a conta do Melhor Envio', r.status === 200 && r.json.firstname === 'Vineon', r.text);
r = await fn('listMelhorEnvioShipments', admin, { method: 'GET' });
check('admin lista os envios', r.status === 200 && Array.isArray(r.json.data) && r.json.data.length >= 1, r.text);
check('loja NÃO lista os envios', (await fn('listMelhorEnvioShipments', seller, { method: 'GET' })).status === 403);

const hook = (secret, payload) => fetch(`${FN}/melhorEnvioWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) }, body: JSON.stringify(payload) });
check('webhook sem segredo: 401', (await hook(null, { id: order1.shippingInfo.shipmentId, status: 'posted' })).status === 401);
check('webhook com segredo: 200', (await hook('segredo-falso-local', { id: order1.shippingInfo.shipmentId, status: 'posted' })).status === 200);
check('webhook atualiza o status do envio no pedido', (await o1.get()).get('shippingInfo.status') === 'posted');

// ===================================================== WhatsApp (admin)
console.log('\nWhatsApp — instâncias e conversas');
r = await fn('listWhatsappInstances', admin, { method: 'GET' });
check('admin lista as instâncias', r.status === 200 && (r.json.instances || []).some(i => i.name === 'vineon-teste'), r.text);
check('loja NÃO lista instâncias', (await fn('listWhatsappInstances', seller, { method: 'GET' })).status === 403);
r = await fn('createWhatsappInstance', admin, { body: { instanceName: 'vineon-nova' } });
check('admin cria instância', r.status === 200 && r.json.instanceName === 'vineon-nova', r.text);
r = await fn('getWhatsappQrCode?instanceName=vineon-nova', admin, { method: 'GET' });
check('QR code para conectar', r.status === 200 && /^data:image\/png;base64,/.test(r.json.base64 || ''), r.text);
t0 = Date.now();
r = await fn('sendWhatsappTestMessage', admin, { body: { instanceName: 'vineon-teste', phoneNumber: '(11) 99999-8888', message: 'Teste da Vineon' } });
const sent = callsSince(t0, 'evolution', '/message/sendText/vineon-teste')[0];
check('mensagem de teste sai pela instância', r.status === 200 && !!sent, r.text);
check('número vai só com dígitos (e DDI)', /^55?\d{10,13}$/.test(String(sent?.body?.number || '')), JSON.stringify(sent?.body));
r = await fn('listWhatsappEvolutionChats', admin, { body: { instanceName: 'vineon-teste' } });
check('lista as conversas', r.status === 200 && JSON.stringify(r.json).includes('Cliente Teste'), r.text);
r = await fn('listWhatsappEvolutionMessages', admin, { body: { instanceName: 'vineon-teste', remoteJid: '5511988887777@s.whatsapp.net', limit: 20, page: 1 } });
check('abre as mensagens de uma conversa', r.status === 200 && JSON.stringify(r.json).includes('meu pedido chegou'), r.text);
r = await fn('resolveWhatsappEvolutionMedia', admin, { body: { instanceName: 'vineon-teste', message: { key: { id: 'm9', remoteJid: '5511988887777@s.whatsapp.net' }, messageType: 'imageMessage', message: { imageMessage: { mimetype: 'image/png' } } } } });
check('baixa mídia de uma mensagem', r.status === 200, r.text);
r = await fn(`getWhatsappInstanceLockStatus?instanceName=vineon-teste`, admin, { method: 'GET' });
check('status da trava da instância', r.status === 200, r.text);
check('admin desconecta instância', (await fn('disconnectWhatsappInstance', admin, { body: { instanceName: 'vineon-nova' } })).status === 200);
check('admin apaga instância', (await fn('deleteWhatsappInstance', admin, { method: 'DELETE', body: { instanceName: 'vineon-nova' } })).status === 200);
r = await fn('listWhatsappInstances', admin, { method: 'GET' });
check('instância apagada some da lista', r.status === 200 && !(r.json.instances || []).some(i => i.name === 'vineon-nova'), r.text);

console.log('\nWhatsApp — gatilhos automáticos');
r = await fn('getWhatsappTriggers', admin, { method: 'GET' });
check('admin lê os gatilhos', r.status === 200 && Array.isArray(r.json.triggers) && r.json.triggers.length > 0, r.text);
r = await fn('saveWhatsappTrigger', admin, { body: { eventType: 'product_sold', enabled: true, instanceName: 'vineon-teste', phoneNumber: '11977776666', message: 'Venda {{pedido}} de {{nome}}: {{valor}}' } });
check('admin liga o gatilho de venda', r.status === 200, r.text);
check('loja NÃO mexe em gatilho', (await fn('saveWhatsappTrigger', seller, { body: { eventType: 'product_sold', enabled: true } })).status === 403);
t0 = Date.now();
r = await fn('dispatchWhatsappTrigger', buyer, { body: { eventType: 'product_sold', data: { pedido: 'ABC123', nome: 'Comprador', valor: 'R$ 10,00' } } });
const trig = callsSince(t0, 'evolution', '/message/sendText/')[0];
check('compra dispara o aviso no WhatsApp da equipe', r.status === 200 && r.json.sent === true && trig?.body?.text === 'Venda ABC123 de Comprador: R$ 10,00', `${r.text} | ${JSON.stringify(trig?.body)}`);
check('evento desconhecido: 400', (await fn('dispatchWhatsappTrigger', buyer, { body: { eventType: 'qualquer' } })).status === 400);

console.log('\nRecuperação de senha por WhatsApp');
t0 = Date.now();
r = await fn('requestPasswordResetCode', null, { body: { email: 'comprador@vineon.test', method: 'whatsapp' } });
const resetMsg = callsSince(t0, 'evolution', '/message/sendText/')[0];
check('código chega pelo WhatsApp com a marca Vineon', r.status === 200 && r.json.whatsapp === true && /Vineon/.test(resetMsg?.body?.text || '') && /\*\d{8}\*/.test(resetMsg?.body?.text || ''), `${r.text} | ${resetMsg?.body?.text}`);
check('e a resposta não traz o código', !!resetMsg && !r.text.includes((resetMsg.body.text.match(/\d{8}/) || [''])[0]));

// ===================================================== bots e admin
console.log('\nBots e funções de admin');
r = await fn('createBotJob', admin, { body: { botType: 'teste', botLabel: 'Bot de teste', script: 'console.log(1)', priority: 1 } });
const jobId = r.json.jobId;
check('admin cria tarefa de bot', r.status === 200 && !!jobId, r.text);
r = await fn('listBotJobs?limit=10', admin, { method: 'GET' });
check('lista as tarefas', r.status === 200 && (r.json.jobs || []).some(j => j.id === jobId || j.jobId === jobId), r.text);
check('cancela a tarefa', (await fn('cancelBotJob', admin, { body: { jobId } })).status === 200);
check('reenvia a tarefa', (await fn('retryBotJob', admin, { body: { jobId } })).status === 200);
r = await fn(`listBotJobLogs?jobId=${jobId}`, admin, { method: 'GET' });
check('lê o log da tarefa', r.status === 200 && Array.isArray(r.json.logs), r.text);
r = await fn('getBotOpsSummary', admin, { method: 'GET' });
check('resumo dos bots', r.status === 200 && !!r.json.summary, r.text);
check('loja NÃO cria bot', (await fn('createBotJob', seller, { body: { botType: 'teste' } })).status === 403);

r = await fn('refreshMetricsNow', admin, {});
check('admin atualiza as métricas', r.status === 200, r.text);
check('loja NÃO atualiza métricas', (await fn('refreshMetricsNow', seller, {})).status === 403);
r = await fn('setAdminClaim', admin, { body: { uid: 'test-atelie', admin: true } });
check('admin dá acesso de admin', r.status === 200, r.text);
r = await fn('setAdminClaim', admin, { body: { uid: 'test-atelie', admin: false } });
check('admin tira o acesso', r.status === 200, r.text);
check('loja NÃO se dá admin', (await fn('setAdminClaim', seller, { body: { uid: 'test-vendedor', admin: true } })).status === 403);
r = await fn('getMyAdminStatus', admin, { method: 'GET' });
check('getMyAdminStatus responde para admin', r.status === 200, r.text);
r = await fn('sendTestNotification', buyer, {});
check('notificação de teste responde (com ou sem push configurado)', r.status === 200 || (r.status < 500 && !!r.json.error), r.text);

console.log('\nPagamentos (só autorização; não chama o Asaas)');
check('cliente Asaas sem login: 401', (await fn('createAsaasCustomer', null, { body: {} })).status === 401);
check('estorno por não-admin: 403', (await fn('refundAsaasPayment', buyer, { body: { paymentId: 'pay_x' } })).status === 403);

console.log(`\n${pass} ok, ${fail} falha(s)`);
if (fail) {
  console.log(failures.map(f => ` - ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
