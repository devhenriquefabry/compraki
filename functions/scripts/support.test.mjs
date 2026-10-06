// Bateria do "Fale com a Vineon" contra os emuladores: regras do Firestore e do
// Storage + as duas Cloud Functions (createSupportTicket e replySupportTicket).
//
//   npm run emulators            (num terminal)
//   node functions/scripts/support.test.mjs
//
// Roda o seed primeiro (zera tudo e recria o cenário conhecido), então dá para
// repetir quantas vezes quiser. Só funciona contra projeto `demo-*`.
// Login: senha do seed no Auth emulator -> ID token -> REST com `Bearer`.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT = process.env.EMULATOR_PROJECT_ID || 'demo-vineon';
if (!PROJECT.startsWith('demo-')) throw new Error('Só roda em projeto demo.');

const HOST = '127.0.0.1';
const FS = `http://${HOST}:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://${HOST}:5001/${PROJECT}/us-central1`;
const STORAGE = `http://${HOST}:9199/v0/b/${PROJECT}.appspot.com/o`;
const PASSWORD = 'vineon-teste';
const YEAR = new Date().getFullYear();

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

async function fsGet(path, token) {
  const response = await fetch(`${FS}/${path}`, { headers: auth(token) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

/** Consulta de lista. `where`: [campo, valor] ou null. */
async function fsList(collection, token, where = null, parent = '') {
  const structuredQuery = { from: [{ collectionId: collection }], limit: 50 };
  if (where) {
    structuredQuery.where = { fieldFilter: { field: { fieldPath: where[0] }, op: 'EQUAL', value: { stringValue: where[1] } } };
  }
  const response = await fetch(`${FS}${parent}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ structuredQuery }),
  });
  const body = await response.json().catch(() => []);
  const docs = Array.isArray(body) ? body.filter(row => row.document) : [];
  const denied = !response.ok || (Array.isArray(body) && body.some(row => row.error));
  return { status: response.status, denied, count: docs.length };
}

async function fsCommit(write, token) {
  const response = await fetch(`${FS}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ writes: [write] }),
  });
  return { status: response.status, ok: response.ok, body: await response.json().catch(() => ({})) };
}

const doc = path => `projects/${PROJECT}/databases/(default)/documents/${path}`;

function patch(path, fields, mask, transforms = []) {
  return {
    update: { name: doc(path), fields },
    updateMask: { fieldPaths: mask },
    currentDocument: { exists: true },
    ...(transforms.length ? { updateTransforms: transforms } : {}),
  };
}

const REQUEST_TIME = fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' });

async function fn(name, body, token) {
  const response = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify(body),
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

async function storageRead(path, token) {
  const response = await fetch(`${STORAGE}/${encodeURIComponent(path)}?alt=media`, { headers: auth(token) });
  return response.status;
}

async function storageDelete(path, token) {
  const response = await fetch(`${STORAGE}/${encodeURIComponent(path)}`, { method: 'DELETE', headers: auth(token) });
  return response.status;
}

const newId = () => Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ------------------------------------------------------------------ login
const buyer = await login('comprador@vineon.test');
const seller = await login('vendedor@vineon.test');
const other = await login('atelie@vineon.test');
const staff = await login('admin@vineon.test');

const NOTE = { authorId: { stringValue: 'test-admin' }, authorName: { stringValue: 'Admin' }, text: { stringValue: 'nota interna' } };

// ============================================================ REGRAS: leitura
console.log('\nRegras do Firestore — leitura');
check('dono lê o próprio atendimento', (await fsGet('supportTickets/seedticket0000000001', buyer)).status === 200);
check('outra conta NÃO lê atendimento alheio', (await fsGet('supportTickets/seedticket0000000005', buyer)).status === 403);
check('vendedor NÃO lê o do comprador', (await fsGet('supportTickets/seedticket0000000001', seller)).status === 403);
check('sem login NÃO lê', (await fsGet('supportTickets/seedticket0000000001', null)).status === 403);
check('admin lê qualquer um', (await fsGet('supportTickets/seedticket0000000005', staff)).status === 200);

const mine = await fsList('supportTickets', buyer, ['userId', 'test-comprador']);
check('"meus atendimentos" (userId == uid) funciona', !mine.denied && mine.count === 4, `(count=${mine.count})`);
const all = await fsList('supportTickets', buyer);
check('lista sem filtro de dono é negada', all.denied);
const spy = await fsList('supportTickets', buyer, ['userId', 'test-vendedor']);
check('lista filtrando o userId de outra pessoa é negada', spy.denied);
const adminList = await fsList('supportTickets', staff);
check('admin lista todos', !adminList.denied && adminList.count === 5, `(count=${adminList.count})`);

check('dono lê a conversa', (await fsGet('supportTickets/seedticket0000000001/replies/r1', buyer)).status === 200);
check('outra conta NÃO lê a conversa', (await fsGet('supportTickets/seedticket0000000005/replies/r1', buyer)).status === 403);
const replyList = await fsList('replies', buyer, null, '/supportTickets/seedticket0000000002');
check('dono lista a conversa', !replyList.denied && replyList.count === 2, `(count=${replyList.count})`);
const replySpy = await fsList('replies', buyer, null, '/supportTickets/seedticket0000000005');
check('lista da conversa alheia é negada', replySpy.denied);

// ============================================================ REGRAS: escrita
console.log('\nRegras do Firestore — escrita do cliente');
const createTicket = {
  update: { name: doc('supportTickets/forjado'), fields: { userId: { stringValue: 'test-comprador' }, status: { stringValue: 'waiting_staff' } } },
  currentDocument: { exists: false },
};
check('cliente NÃO cria atendimento direto', !(await fsCommit(createTicket, buyer)).ok);
check('admin NÃO cria atendimento direto (só a function)', !(await fsCommit(createTicket, staff)).ok);
check('cliente NÃO grava mensagem direto', !(await fsCommit({
  update: { name: doc('supportTickets/seedticket0000000001/replies/forjada'), fields: { senderRole: { stringValue: 'staff' }, text: { stringValue: 'oi' } } },
  currentDocument: { exists: false },
}, buyer)).ok);
check('cliente NÃO muda o status', !(await fsCommit(patch('supportTickets/seedticket0000000001', { status: { stringValue: 'resolved' } }, ['status']), buyer)).ok);
check('cliente NÃO muda a prioridade', !(await fsCommit(patch('supportTickets/seedticket0000000001', { priority: { stringValue: 'normal' } }, ['priority']), buyer)).ok);
check('cliente NÃO muda o assunto', !(await fsCommit(patch('supportTickets/seedticket0000000001', { subject: { stringValue: 'outro' } }, ['subject']), buyer)).ok);
check('cliente NÃO se atribui como equipe', !(await fsCommit(patch('supportTickets/seedticket0000000001', { assigneeId: { stringValue: 'test-comprador' } }, ['assigneeId']), buyer)).ok);
check('cliente NÃO apaga', (await fetch(`${FS}/supportTickets/seedticket0000000001`, { method: 'DELETE', headers: auth(buyer) })).status === 403);
check('outra conta NÃO marca como lido', !(await fsCommit(patch('supportTickets/seedticket0000000002', { userUnread: { booleanValue: false } }, ['userUnread']), seller)).ok);
check('dono marca como lido', (await fsCommit(patch('supportTickets/seedticket0000000002', { userUnread: { booleanValue: false } }, ['userUnread']), buyer)).ok);
check('dono NÃO marca como não lido', !(await fsCommit(patch('supportTickets/seedticket0000000001', { userUnread: { booleanValue: true } }, ['userUnread']), buyer)).ok);

const csat = (score, comment = 'ótimo') => ({
  csat: { mapValue: { fields: { score: { integerValue: String(score) }, comment: { stringValue: comment } } } },
});
check('avaliar com atendimento em aberto é negado', !(await fsCommit(patch('supportTickets/seedticket0000000001', csat(5), ['csat'], [REQUEST_TIME('csat.at')]), buyer)).ok);
check('nota fora de 1–5 é negada', !(await fsCommit(patch('supportTickets/seedticket0000000003', csat(9), ['csat'], [REQUEST_TIME('csat.at')]), buyer)).ok);
check('comentário gigante é negado', !(await fsCommit(patch('supportTickets/seedticket0000000003', csat(5, 'x'.repeat(501)), ['csat'], [REQUEST_TIME('csat.at')]), buyer)).ok);
check('outra conta NÃO avalia', !(await fsCommit(patch('supportTickets/seedticket0000000003', csat(5), ['csat'], [REQUEST_TIME('csat.at')]), seller)).ok);
check('dono avalia atendimento resolvido', (await fsCommit(patch('supportTickets/seedticket0000000003', csat(4), ['csat'], [REQUEST_TIME('csat.at')]), buyer)).ok);
check('avaliar de novo é negado', !(await fsCommit(patch('supportTickets/seedticket0000000003', csat(1), ['csat'], [REQUEST_TIME('csat.at')]), buyer)).ok);
check('data da avaliação precisa ser do servidor', !(await fsCommit(patch('supportTickets/seedticket0000000004', {
  csat: { mapValue: { fields: { score: { integerValue: '1' }, comment: { stringValue: '' }, at: { timestampValue: '2020-01-01T00:00:00Z' } } } },
}, ['csat']), buyer)).ok);

console.log('\nRegras do Firestore — equipe e notas');
check('admin atribui responsável', (await fsCommit(patch('supportTickets/seedticket0000000001', { assigneeId: { stringValue: 'test-admin' }, assigneeName: { stringValue: 'Admin' } }, ['assigneeId', 'assigneeName']), staff)).ok);
check('admin muda prioridade', (await fsCommit(patch('supportTickets/seedticket0000000001', { priority: { stringValue: 'normal' } }, ['priority']), staff)).ok);
check('admin NÃO põe prioridade inválida', !(await fsCommit(patch('supportTickets/seedticket0000000001', { priority: { stringValue: 'urgentissimo' } }, ['priority']), staff)).ok);
check('admin NÃO muda status direto (só pela function)', !(await fsCommit(patch('supportTickets/seedticket0000000001', { status: { stringValue: 'closed' } }, ['status']), staff)).ok);
check('admin NÃO mexe no dono do atendimento', !(await fsCommit(patch('supportTickets/seedticket0000000001', { userId: { stringValue: 'test-vendedor' } }, ['userId']), staff)).ok);
const noteWrite = fields => ({ update: { name: doc(`supportTickets/seedticket0000000001/notes/n-${newId()}`), fields }, currentDocument: { exists: false }, updateTransforms: [REQUEST_TIME('createdAt')] });
check('admin cria nota interna', (await fsCommit(noteWrite(NOTE), staff)).ok);
check('nota com autor falso é negada', !(await fsCommit(noteWrite({ ...NOTE, authorId: { stringValue: 'test-vendedor' } }), staff)).ok);
check('nota vazia é negada', !(await fsCommit(noteWrite({ ...NOTE, text: { stringValue: '' } }), staff)).ok);
check('cliente NÃO cria nota', !(await fsCommit(noteWrite(NOTE), buyer)).ok);
const noteId = (await fsList('notes', staff, null, '/supportTickets/seedticket0000000001'));
check('admin lê as notas', !noteId.denied && noteId.count === 1, `(count=${noteId.count})`);
check('cliente NÃO lê as notas', (await fsList('notes', buyer, null, '/supportTickets/seedticket0000000001')).denied);
check('cliente NÃO lê uma nota específica', (await fsGet('supportTickets/seedticket0000000001/notes/qualquer', buyer)).status === 403);
check('contador do protocolo é fechado ao cliente', (await fsGet(`supportCounters/${YEAR}`, buyer)).status === 403);

// ============================================================ REGRAS: Storage
console.log('\nRegras do Storage');
const mineFile = `support/test-comprador/${newId()}/foto.png`;
check('dono envia foto para a própria pasta', (await upload(mineFile, buyer)) === 200);
check('dono lê o próprio anexo', (await storageRead(mineFile, buyer)) === 200);
check('admin lê o anexo', (await storageRead(mineFile, staff)) === 200);
check('outra conta NÃO lê o anexo', (await storageRead(mineFile, seller)) === 403);
check('NÃO envia para a pasta de outra pessoa', (await upload(`support/test-vendedor/${newId()}/x.png`, buyer)) === 403);
check('NÃO envia HTML', (await upload(`support/test-comprador/${newId()}/x.html`, buyer, { contentType: 'text/html' })) === 403);
check('NÃO envia arquivo acima de 5 MB', (await upload(`support/test-comprador/${newId()}/grande.png`, buyer, { size: 5 * 1024 * 1024 + 10 })) === 403);
check('aceita PDF', (await upload(`support/test-comprador/${newId()}/doc.pdf`, buyer, { contentType: 'application/pdf' })) === 200);
check('equipe envia anexo para a pasta do cliente', (await upload(`support/test-comprador/${newId()}/resposta.png`, staff)) === 200);
check('sem login NÃO envia', (await upload(`support/test-comprador/${newId()}/x.png`, null)) === 403);
check('cliente NÃO apaga anexo enviado', (await storageDelete(mineFile, buyer)) === 403);

// ============================================================ FUNCTION: abrir
console.log('\ncreateSupportTicket');
const order = (await admin.doc('orders/seed-04').get()).data();
const ownsOrder = order.sellerIds[0];
const strangerToken = ownsOrder === 'test-atelie' ? seller : other;
const strangerUid = ownsOrder === 'test-atelie' ? 'test-vendedor' : 'test-atelie';

const base = { topic: 'pedido-atraso', role: 'buyer', subject: 'Pedido atrasado', message: 'Meu pedido está atrasado há alguns dias e o rastreio não anda.' };
const png = `support/test-comprador/${'a'.repeat(20)}/anexo.png`;
await upload(png, buyer);

check('sem login: 401', (await fn('createSupportTicket', { ...base, ticketId: newId() }, null)).status === 401);

const id1 = newId();
const created = await fn('createSupportTicket', { ...base, ticketId: id1, orderId: 'seed-04' }, buyer);
check('abre atendimento com pedido', created.status === 200 && created.json.protocol === `VN-${YEAR}-000006`, JSON.stringify(created.json));
const t1 = (await admin.doc(`supportTickets/${id1}`).get()).data();
check('status inicial é "aguardando a Vineon"', t1?.status === 'waiting_staff' && t1?.staffUnread === true && t1?.userUnread === false);
check('prioridade alta para pedido atrasado', t1?.priority === 'high');
check('grava o resumo do pedido', t1?.orderSnapshot?.shortId === 'SEED-04' && t1?.orderSnapshot?.stage === 'preparing' && t1?.orderSnapshot?.asRole === 'buyer');
check('prazo da 1ª resposta ~8 h úteis', t1?.firstResponseDueAt && t1.firstResponseDueAt.toMillis() > Date.now());
check('grava a 1ª mensagem', (await admin.collection(`supportTickets/${id1}/replies`).get()).size === 1);
check('papel (senderRole) é "user", definido pelo servidor', (await admin.collection(`supportTickets/${id1}/replies`).get()).docs[0].get('senderRole') === 'user');

const again = await fn('createSupportTicket', { ...base, ticketId: id1, orderId: 'seed-04' }, buyer);
check('repetir o mesmo ticketId não duplica', again.status === 200 && again.json.duplicate === true && again.json.protocol === created.json.protocol);
check('ticketId de outra pessoa é recusado', (await fn('createSupportTicket', { ...base, ticketId: id1 }, seller)).status === 409);

const quick = await fn('createSupportTicket', { ...base, ticketId: newId() }, buyer);
check('segundo atendimento em seguida: 429 (respiro)', quick.status === 429, JSON.stringify(quick.json));

check('mensagem curta: 400', (await fn('createSupportTicket', { ...base, ticketId: newId(), message: 'curta' }, other)).status === 400);
check('título vazio: 400', (await fn('createSupportTicket', { ...base, ticketId: newId(), subject: ' ' }, other)).status === 400);
check('assunto inexistente: 400', (await fn('createSupportTicket', { ...base, ticketId: newId(), topic: 'hackeado' }, other)).status === 400);
check('ticketId inválido: 400', (await fn('createSupportTicket', { ...base, ticketId: 'curto' }, other)).status === 400);
check('pedido de outra pessoa: 404', (await fn('createSupportTicket', { ...base, ticketId: newId(), orderId: 'seed-04' }, strangerToken)).status === 404);
check('anexo da pasta de outra pessoa: 400', (await fn('createSupportTicket', { ...base, ticketId: newId(), attachments: [{ path: png }] }, other)).status === 400);
check('anexo que não existe: 400', (await fn('createSupportTicket', { ...base, ticketId: newId(), attachments: [{ path: `support/test-atelie/${'b'.repeat(20)}/nao-existe.png` }] }, other)).status === 400);
check('mais de 3 anexos: 400', (await fn('createSupportTicket', { ...base, ticketId: newId(), attachments: [1, 2, 3, 4].map(n => ({ path: `support/test-atelie/x/${n}.png` })) }, other)).status === 400);

// Vendedor abre pelo lado da loja: o resumo mostra só a parte dela.
const sellerOwnsOrder = ownsOrder === 'test-vendedor';
if (sellerOwnsOrder) {
  const sid = newId();
  const sale = await fn('createSupportTicket', { ...base, ticketId: sid, topic: 'venda-envio', role: 'seller', orderId: 'seed-04' }, seller);
  const st = (await admin.doc(`supportTickets/${sid}`).get()).data();
  check('vendedor abre pelo pedido da loja (asRole = seller)', sale.status === 200 && st?.orderSnapshot?.asRole === 'seller' && st?.userRole === 'seller', JSON.stringify(sale.json));
}

// Limite de 5 abertos (semeado direto para não esperar o respiro).
const limitUid = 'test-atelie';
const base5 = Date.now() - 3_600_000;
for (let i = 0; i < 5; i++) {
  await admin.doc(`supportTickets/limite-${i}`).set({
    userId: limitUid, status: 'waiting_staff', createdAt: Timestamp.fromMillis(base5 - i * 1000), updatedAt: Timestamp.fromMillis(base5 - i * 1000),
  });
}
const limited = await fn('createSupportTicket', { ...base, ticketId: newId() }, other);
check('6º atendimento aberto: 429', limited.status === 429, JSON.stringify(limited.json));

// ============================================================ FUNCTION: responder
console.log('\nreplySupportTicket');
check('sem login: 401', (await fn('replySupportTicket', { ticketId: 'seedticket0000000001x'.padEnd(20, '0'), message: 'oi' }, null)).status === 401);
check('atendimento inexistente: 404', (await fn('replySupportTicket', { ticketId: newId(), message: 'oi' }, buyer)).status === 404);
check('cliente em atendimento alheio: 404 (não revela que existe)', (await fn('replySupportTicket', { ticketId: id1, message: 'oi, é outra pessoa' }, seller)).status === 404);

// Os ids semeados têm menos de 20 caracteres: a function exige o formato do Firestore, então
// os testes de resposta usam atendimentos recém-criados e semeados com id de 20 letras.
async function seedTicket(id, data, replies = 1) {
  const now = Date.now();
  await admin.doc(`supportTickets/${id}`).set({
    protocol: `VN-${YEAR}-9${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
    userId: 'test-comprador', userName: 'Compradora de Teste', userEmail: 'comprador@vineon.test', userRole: 'buyer',
    topic: 'outro', topicLabel: 'Outro assunto', subject: 'Teste', orderId: null, orderSnapshot: null, status: 'waiting_staff', priority: 'normal',
    assigneeId: null, assigneeName: null, channel: 'app', createdAt: Timestamp.fromMillis(now - 7_200_000), updatedAt: Timestamp.fromMillis(now - 7_200_000),
    lastReplyAt: Timestamp.fromMillis(now - 7_200_000), lastReplyBy: 'user', replyCount: replies, firstResponseDueAt: Timestamp.fromMillis(now + 3_600_000),
    firstResponseAt: null, userUnread: false, staffUnread: true, csat: null, ...data,
  });
}

const A = 'aaaaaaaaaaaaaaaaaaaa'; // waiting_staff
const B = 'bbbbbbbbbbbbbbbbbbbb'; // resolved há 1 dia
const C = 'cccccccccccccccccccc'; // resolved há 10 dias
const D = 'dddddddddddddddddddd'; // closed
const E = 'eeeeeeeeeeeeeeeeeeee'; // waiting_customer
const F = 'ffffffffffffffffffff'; // para o limite de mensagens
await seedTicket(A, {});
await seedTicket(B, { status: 'resolved', resolvedAt: Timestamp.fromMillis(Date.now() - 86_400_000), resolvedBy: 'staff' });
await seedTicket(C, { status: 'resolved', resolvedAt: Timestamp.fromMillis(Date.now() - 10 * 86_400_000), resolvedBy: 'staff' });
await seedTicket(D, { status: 'closed', closedAt: Timestamp.now() });
await seedTicket(E, { status: 'waiting_customer', lastReplyBy: 'staff', firstResponseAt: Timestamp.now(), assigneeId: 'test-admin', assigneeName: 'Admin' });
await seedTicket(F, { replyCount: 100 });

const r1 = await fn('replySupportTicket', { ticketId: A, message: 'Mais um detalhe do meu caso.' }, buyer);
check('cliente responde: 200 e segue na fila da Vineon', r1.status === 200 && r1.json.status === 'waiting_staff', JSON.stringify(r1.json));
const tA = (await admin.doc(`supportTickets/${A}`).get()).data();
check('contagem de mensagens sobe e a equipe vê "não lido"', tA.replyCount === 2 && tA.staffUnread === true && tA.lastReplyBy === 'user');
check('resposta rápida demais: 429', (await fn('replySupportTicket', { ticketId: A, message: 'outra, logo em seguida' }, buyer)).status === 429);
check('cliente NÃO pode encerrar: 400', (await fn('replySupportTicket', { ticketId: A, status: 'closed' }, buyer)).status === 400);
check('cliente NÃO pode devolver à fila da equipe por status: 400', (await fn('replySupportTicket', { ticketId: A, status: 'waiting_customer' }, buyer)).status === 400);
check('mensagem vazia sem status: 400', (await fn('replySupportTicket', { ticketId: A, message: '   ' }, staff)).status === 400);
check('mensagem acima de 2000 vira 2000 (não passa do limite)', (await fn('replySupportTicket', { ticketId: E, message: 'x'.repeat(3000) }, buyer)).status === 200);
check('anexo da pasta de outra pessoa: 400', (await fn('replySupportTicket', { ticketId: A, message: 'veja', attachments: [{ path: `support/test-vendedor/${A}/x.png` }] }, staff)).status === 400);

const resolveByUser = await fn('replySupportTicket', { ticketId: E, status: 'resolved' }, buyer);
check('cliente marca como resolvido', resolveByUser.status === 200 && resolveByUser.json.status === 'resolved');
const events = (await admin.collection(`supportTickets/${E}/replies`).get()).docs.map(d => d.data()).filter(d => d.senderRole === 'system');
check('registra o marco "resolvido" (por cliente) na conversa', events.some(e => e.event === 'resolved' && e.eventBy === 'user'));
check('resolver de novo: 409', (await fn('replySupportTicket', { ticketId: E, status: 'resolved' }, buyer)).status === 409);

const reopen = await fn('replySupportTicket', { ticketId: B, message: 'Na verdade ainda preciso de ajuda.' }, buyer);
const tB = (await admin.doc(`supportTickets/${B}`).get()).data();
check('responder resolvido (até 7 dias) reabre', reopen.status === 200 && tB.status === 'waiting_staff' && tB.resolvedAt === undefined && tB.reopenCount === 1, JSON.stringify(reopen.json));
check('registra o marco "reaberto"', (await admin.collection(`supportTickets/${B}/replies`).get()).docs.some(d => d.get('event') === 'reopened'));
check('resolvido há mais de 7 dias NÃO reabre: 409', (await fn('replySupportTicket', { ticketId: C, message: 'Voltei.' }, buyer)).status === 409);
check('encerrado NÃO recebe mensagem: 409', (await fn('replySupportTicket', { ticketId: D, message: 'Alô?' }, buyer)).status === 409);
check('encerrado NÃO recebe da equipe também: 409', (await fn('replySupportTicket', { ticketId: D, message: 'Alô?' }, staff)).status === 409);
check('limite de 100 mensagens: 429', (await fn('replySupportTicket', { ticketId: F, message: 'mais uma' }, buyer)).status === 429);

// Equipe
const adminReply = await fn('replySupportTicket', { ticketId: A, message: 'Olá! Estamos verificando com a transportadora.' }, staff);
const tA2 = (await admin.doc(`supportTickets/${A}`).get()).data();
check('equipe responde: passa a bola ao cliente', adminReply.status === 200 && tA2.status === 'waiting_customer' && tA2.lastReplyBy === 'staff' && tA2.userUnread === true && tA2.staffUnread === false);
check('1ª resposta da equipe grava firstResponseAt e responsável', !!tA2.firstResponseAt && tA2.assigneeId === 'test-admin');
const staffMsg = (await admin.collection(`supportTickets/${A}/replies`).get()).docs.map(d => d.data()).find(d => d.senderRole === 'staff');
check('nome da equipe vem do servidor ("Admin · Vineon")', staffMsg?.senderName === 'Admin · Vineon', `(${staffMsg?.senderName})`);
await sleep(300);
const bell = await admin.doc(`users/test-comprador/notifications/support-${A}`).get();
check('cliente recebe aviso no app (kind support)', bell.exists && bell.get('kind') === 'support' && bell.get('link') === `/support/${A}`);

const resolveStaff = await fn('replySupportTicket', { ticketId: A, message: 'Resolvido por aqui.', status: 'resolved' }, staff);
const tA3 = (await admin.doc(`supportTickets/${A}`).get()).data();
check('equipe responde e resolve', resolveStaff.status === 200 && tA3.status === 'resolved' && tA3.resolvedBy === 'staff' && !!tA3.resolvedAt);
const closeStaff = await fn('replySupportTicket', { ticketId: A, status: 'closed' }, staff);
const tA4 = (await admin.doc(`supportTickets/${A}`).get()).data();
check('equipe encerra e mantém a data da resolução', closeStaff.status === 200 && tA4.status === 'closed' && !!tA4.closedAt && !!tA4.resolvedAt);
check('equipe NÃO muda para status inventado: 400', (await fn('replySupportTicket', { ticketId: E, status: 'hackeado' }, staff)).status === 400);
check('equipe reabre atendimento resolvido', (await fn('replySupportTicket', { ticketId: E, status: 'waiting_customer' }, staff)).json.status === 'waiting_customer');

// ============================================================ LGPD: excluir conta
console.log('\nExcluir conta com atendimento (LGPD)');
const signup = await fetch(`http://${HOST}:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'excluir@vineon.test', password: PASSWORD, returnSecureToken: true }),
}).then(r => r.json());
const goneToken = signup.idToken;
const goneUid = signup.localId;
await admin.doc(`users/${goneUid}`).set({ email: 'excluir@vineon.test', displayName: 'Pessoa Que Sai', isSeller: true });

const goneTicket = newId();
const goneFile = `support/${goneUid}/${goneTicket}/comprovante.png`;
check('conta nova envia anexo', (await upload(goneFile, goneToken)) === 200);
const goneCreated = await fn('createSupportTicket', {
  ...base, topic: 'privacidade', role: 'buyer', ticketId: goneTicket, subject: 'Quero meus dados', attachments: [{ path: goneFile, name: 'comprovante.png' }],
}, goneToken);
check('conta nova abre atendimento com anexo', goneCreated.status === 200, JSON.stringify(goneCreated.json));
const goneDoc = (await admin.doc(`supportTickets/${goneTicket}`).get()).data();
check('LGPD vira prioridade alta', goneDoc?.priority === 'high' && goneDoc?.userEmail === 'excluir@vineon.test');
await fn('replySupportTicket', { ticketId: goneTicket, message: 'Olá! Vamos cuidar disso.' }, staff);

const dry = await fn('deleteMyAccount', { dryRun: true }, goneToken);
check('conferência da exclusão conta o atendimento', dry.status === 200 && dry.json.summary?.tickets === 1, JSON.stringify(dry.json));
const removed = await fn('deleteMyAccount', {}, goneToken);
check('exclui a conta', removed.status === 200 && removed.json.ok === true, JSON.stringify(removed.json));

const afterTicket = (await admin.doc(`supportTickets/${goneTicket}`).get()).data();
check('atendimento fica como registro, sem nome e e-mail', !!afterTicket && afterTicket.userName === 'Conta excluída' && afterTicket.userEmail === null);
const afterReplies = (await admin.collection(`supportTickets/${goneTicket}/replies`).get()).docs.map(d => d.data());
check('mensagem da pessoa perde o nome', afterReplies.filter(r => r.senderRole === 'user').every(r => r.senderName === 'Conta excluída'));
check('texto das mensagens continua', afterReplies.some(r => String(r.text).includes('Quero') || String(r.text).length > 10));
check('anexos saem das mensagens', afterReplies.every(r => Array.isArray(r.attachments) && r.attachments.length === 0));
check('arquivo do anexo é apagado do Storage', (await storageRead(goneFile, staff)) === 404);
check('resumo da exclusão guarda só a contagem', (await admin.doc(`accountDeletions/${goneUid}`).get()).get('tickets') === 1);

console.log(`\n${pass} passaram, ${fail} falharam.`);
if (fail) {
  console.log('\nFalhas:');
  failures.forEach(line => console.log(` - ${line}`));
}
process.exit(fail ? 1 : 0);
