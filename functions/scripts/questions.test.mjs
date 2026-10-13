// Bateria das "Perguntas aos vendedores" contra os emuladores: regras do Firestore
// (com o SDK do cliente e as contas do seed, como o app faz) e as três Cloud
// Functions (askProductQuestion, answerProductQuestion, deleteProductQuestion).
//
//   npm run emulators            (num terminal)
//   node functions/scripts/questions.test.mjs
//
// Roda o seed primeiro (zera tudo e recria o cenário conhecido), então dá para
// repetir quantas vezes quiser. Só funciona contra projeto `demo-*`.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PROJECT = process.env.EMULATOR_PROJECT_ID || 'demo-vineon';
if (!PROJECT.startsWith('demo-')) throw new Error('Só roda em projeto demo.');

const HOST = '127.0.0.1';
const FN = `http://${HOST}:5001/${PROJECT}/us-central1`;

const seed = fileURLToPath(new URL('./emulator-seed.mjs', import.meta.url));
execFileSync(process.execPath, [seed], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 4000));

// SDK do cliente vem do app (raiz); o Admin, das functions.
const fromRoot = createRequire(new URL('../../package.json', import.meta.url));
const { initializeApp, deleteApp } = fromRoot('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = fromRoot('firebase/auth');
const {
  getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, serverTimestamp,
  collection, query, where, setLogLevel,
} = fromRoot('firebase/firestore');
setLogLevel('silent');

process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:8080`;
const admin = createRequire(import.meta.url);
const adminApp = admin('firebase-admin/app').initializeApp({ projectId: PROJECT }, 'admin');
const adminDb = admin('firebase-admin/firestore').getFirestore(adminApp);
const { Timestamp } = admin('firebase-admin/firestore');
const read = async path => (await adminDb.doc(path).get()).data();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let n = 0, ok = 0, tests = 0;
async function as(email) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-api-key' }, `t${n++}`);
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, HOST, 8080);
  let token = null;
  if (email) {
    const cred = await signInWithEmailAndPassword(auth, email, 'vineon-teste');
    token = await cred.user.getIdToken();
  }
  return { app, db, token };
}

async function expect(label, allow, fn) {
  tests++;
  let got;
  try { await fn(); got = true; } catch (e) { got = false; if (allow) console.log('   ', e.code, String(e.message).slice(0, 120)); }
  const pass = got === allow; if (pass) ok++;
  console.log(`${pass ? 'ok    ' : 'FALHOU'} ${allow ? 'permite' : 'nega   '} · ${label}`);
}

function check(label, cond, detail = '') {
  tests++;
  if (cond) ok++;
  console.log(`${cond ? 'ok    ' : 'FALHOU'} função  · ${label}${detail ? ` (${detail})` : ''}`);
}

/** Chama uma function como a pessoa logada. Devolve `{ status, body }`. */
async function call(name, who, body) {
  const response = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const buyer = await as('comprador@vineon.test');
const seller = await as('vendedor@vineon.test');
const marina = await as('atelie@vineon.test');
const adminUser = await as('admin@vineon.test');
const guest = await as(null);

const Q = id => `productQuestions/${id}`;
const OPEN_BUYER = 'seedquestion00000006'; // comprador -> fone (loja de teste), sem resposta
const ANSWERED_MARINA = 'seedquestion00000001'; // Marina -> fone, respondida
const UNREAD_BUYER = 'seedquestion00000004'; // comprador -> smartphone, resposta ainda não vista

console.log('— regras do Firestore');

await expect('visitante lista as respondidas de um anúncio', true, () =>
  getDocs(query(collection(guest.db, 'productQuestions'), where('productId', '==', 'fone'), where('status', '==', 'answered'))));
await expect('visitante lê uma respondida', true, () => getDoc(doc(guest.db, Q(ANSWERED_MARINA))));
await expect('visitante lê uma que ainda espera resposta', false, () => getDoc(doc(guest.db, Q(OPEN_BUYER))));
await expect('visitante lista o anúncio sem filtrar por "respondida"', false, () =>
  getDocs(query(collection(guest.db, 'productQuestions'), where('productId', '==', 'fone'))));
await expect('autor lista as próprias (inclui as sem resposta)', true, () =>
  getDocs(query(collection(buyer.db, 'productQuestions'), where('userId', '==', 'test-comprador'))));
await expect('autor lista as perguntas de outra pessoa', false, () =>
  getDocs(query(collection(buyer.db, 'productQuestions'), where('userId', '==', 'test-atelie'))));
await expect('loja lista as perguntas dos anúncios dela', true, () =>
  getDocs(query(collection(seller.db, 'productQuestions'), where('sellerId', '==', 'test-vendedor'))));
await expect('outra loja lista as perguntas da Loja de Teste', false, () =>
  getDocs(query(collection(marina.db, 'productQuestions'), where('sellerId', '==', 'test-vendedor'))));
await expect('outra loja lê pergunta aberta alheia', false, () => getDoc(doc(marina.db, Q(OPEN_BUYER))));
await expect('admin lê pergunta aberta', true, () => getDoc(doc(adminUser.db, Q(OPEN_BUYER))));

await expect('criar pergunta direto pelo app', false, () =>
  setDoc(doc(buyer.db, Q('forjada000000000001')), {
    productId: 'fone', sellerId: 'test-vendedor', userId: 'test-comprador', userName: 'C', text: 'oi, tudo bem?',
    status: 'open', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
await expect('autor edita o texto da pergunta', false, () =>
  updateDoc(doc(buyer.db, Q(OPEN_BUYER)), { text: 'outro texto' }));
await expect('loja grava a resposta direto', false, () =>
  updateDoc(doc(seller.db, Q(OPEN_BUYER)), { answer: { text: 'resposta' }, status: 'answered' }));
await expect('autor marca a resposta como vista', true, () =>
  updateDoc(doc(buyer.db, Q(UNREAD_BUYER)), { askerUnread: false }));
await expect('autor volta a marcar como não vista', false, () =>
  updateDoc(doc(buyer.db, Q(UNREAD_BUYER)), { askerUnread: true }));
await expect('outra pessoa marca a resposta como vista', false, () =>
  updateDoc(doc(seller.db, Q('seedquestion00000005')), { askerUnread: false }));
await expect('autor apaga direto', false, () => deleteDoc(doc(buyer.db, Q(OPEN_BUYER))));
await expect('loja apaga direto', false, () => deleteDoc(doc(seller.db, Q(OPEN_BUYER))));

await expect('loja salva respostas rápidas', true, () =>
  setDoc(doc(seller.db, 'sellerQuickReplies/test-vendedor'), { items: ['Olá!'], updatedAt: serverTimestamp() }));
await expect('loja salva 11 respostas rápidas', false, () =>
  setDoc(doc(seller.db, 'sellerQuickReplies/test-vendedor'), { items: Array.from({ length: 11 }, (_, i) => `r${i}`), updatedAt: serverTimestamp() }));
await expect('outra pessoa lê as respostas rápidas da loja', false, () => getDoc(doc(marina.db, 'sellerQuickReplies/test-vendedor')));
await expect('outra pessoa grava respostas rápidas em nome da loja', false, () =>
  setDoc(doc(marina.db, 'sellerQuickReplies/test-vendedor'), { items: ['golpe'], updatedAt: serverTimestamp() }));

const report = (reporterUid, qid, sellerId) => ({
  targetType: 'question', targetId: qid, sellerId, targetName: 'Pergunta de X', targetPhoto: null,
  reason: 'spam', details: '', reporterId: reporterUid, reporterName: 'R', status: 'open', createdAt: serverTimestamp(),
});
await expect('loja denuncia pergunta aberta do anúncio dela', true, () =>
  setDoc(doc(seller.db, `contentReports/question_${OPEN_BUYER}_test-vendedor`), report('test-vendedor', OPEN_BUYER, 'test-comprador')));
await expect('outra loja denuncia pergunta aberta (não é pública)', false, () =>
  setDoc(doc(marina.db, `contentReports/question_${OPEN_BUYER}_test-atelie`), report('test-atelie', OPEN_BUYER, 'test-comprador')));
await expect('qualquer pessoa denuncia pergunta respondida (é pública)', true, () =>
  setDoc(doc(buyer.db, `contentReports/question_${ANSWERED_MARINA}_test-comprador`), report('test-comprador', ANSWERED_MARINA, 'test-atelie')));
await expect('denúncia aponta outra conta como autora da pergunta', false, () =>
  setDoc(doc(seller.db, `contentReports/question_seedquestion00000007_test-vendedor`), report('test-vendedor', 'seedquestion00000007', 'test-atelie')));
await expect('denunciar pergunta que não existe', false, () =>
  setDoc(doc(seller.db, `contentReports/question_naoexiste_test-vendedor`), report('test-vendedor', 'naoexiste', 'test-comprador')));
await expect('admin apaga a pergunta denunciada', true, () => deleteDoc(doc(adminUser.db, Q('seedquestion00000008'))));

console.log('\n— functions: perguntar');

let r = await call('askProductQuestion', guest, { productId: 'camiseta', text: 'Tem no tamanho G?' });
check('sem login é recusado', r.status === 401, String(r.status));

r = await call('askProductQuestion', buyer, { productId: 'camiseta', text: 'oi' });
check('pergunta curta demais', r.status === 400, `${r.status} ${r.body.error ?? ''}`);
r = await call('askProductQuestion', buyer, { productId: 'camiseta', text: 'x'.repeat(501) });
check('pergunta longa demais', r.status === 400, String(r.status));
r = await call('askProductQuestion', buyer, { productId: 'nao-existe-123', text: 'Tem no tamanho G?' });
check('anúncio que não existe', r.status === 404, String(r.status));
r = await call('askProductQuestion', seller, { productId: 'camiseta', text: 'Tem no tamanho G?' });
check('loja perguntando no próprio anúncio', r.status === 403, String(r.status));

const blocked = [
  ['telefone com DDD', 'Me liga: (11) 99999-9999 que eu fecho agora'],
  ['telefone colado', 'meu numero 11999998888 pode chamar'],
  ['e-mail', 'manda no joao@gmail.com a foto'],
  ['link', 'olha https://loja-concorrente.com.br/produto por favor'],
  ['site sem http', 'tem mais barato em lojaxyz.com.br'],
  ['WhatsApp', 'chama no zap que eu mando foto'],
  ['perfil de rede social', 'segue @minhaloja_oficial'],
  ['pagar por fora', 'faço pix direto pra você, sem taxa'],
];
for (const [label, text] of blocked) {
  r = await call('askProductQuestion', buyer, { productId: 'camiseta', text });
  check(`contato por fora barrado: ${label}`, r.status === 422, `${r.status} ${r.body.error ?? ''}`);
}

const allowed = [
  'O iPhone 15 de 128 GB e 256 GB vem com cabo e carregador?',
  'Serve em quem usa tamanho 42 ou 43? Calço 41,5 em outros tênis.',
  'Tem a versão de 2024? O código do modelo é SM-A566B?',
  'Vocês entregam em 01310-100 até sexta-feira? Preciso para 25/12.',
];
// Texto legítimo não pode ser barrado. Só valida o filtro: o envio real vem depois.
const filtered = [];
for (const text of allowed) {
  const probe = await call('askProductQuestion', buyer, { productId: 'nao-existe-123', text });
  filtered.push(probe.status);
}
check('perguntas normais (números, medidas, CEP) passam pelo filtro', filtered.every(s => s === 404), filtered.join(','));

r = await call('askProductQuestion', buyer, { productId: 'camiseta', text: 'Tem no tamanho G? Vem com etiqueta?' });
check('pergunta válida é criada', r.status === 200 && !!r.body.id, `${r.status} ${JSON.stringify(r.body)}`);
const firstId = r.body.id;
const created = await read(Q(firstId));
check('grava loja, produto e nome público copiados do anúncio',
  created?.sellerId === 'test-vendedor' && created?.productName === 'Camiseta de algodão' && created?.userName === 'Comprador T.' && created?.status === 'open',
  JSON.stringify({ s: created?.sellerId, n: created?.productName, u: created?.userName }));
const notice = await read(`users/test-vendedor/notifications/question-${firstId}`);
check('loja recebe aviso da pergunta nova', notice?.kind === 'question' && notice?.link === '/my-questions?aba=loja', JSON.stringify(notice?.kind));

r = await call('askProductQuestion', buyer, { productId: 'camiseta', text: 'Qual o prazo de entrega para Curitiba?' });
check('segunda pergunta em seguida espera a pausa', r.status === 429, `${r.status} ${r.body.error ?? ''}`);

await sleep(8500);
r = await call('askProductQuestion', buyer, { productId: 'camiseta', text: 'Tem no tamanho G? Vem com etiqueta?' });
check('mesma pergunta duas vezes no anúncio', r.status === 409, `${r.status} ${r.body.error ?? ''}`);

// Limite de perguntas abertas por anúncio (3): cria duas a mais direto no banco.
const nowMs = Date.now();
for (const [i, text] of ['Primeira de teste', 'Segunda de teste'].entries()) {
  await adminDb.doc(Q(`limite00000000000${i}01`)).set({
    productId: 'camiseta', productName: 'Camiseta de algodão', sellerId: 'test-vendedor', userId: 'test-comprador', userName: 'Comprador T.',
    text, status: 'open', answer: null, askerUnread: false,
    createdAt: Timestamp.fromMillis(nowMs - 60_000 - i), updatedAt: Timestamp.fromMillis(nowMs - 60_000), answeredAt: null, responseMs: null,
  });
}
r = await call('askProductQuestion', buyer, { productId: 'camiseta', text: 'Mais uma pergunta sobre este anúncio?' });
check('quarta pergunta aberta no mesmo anúncio', r.status === 429 && /3 perguntas/.test(r.body.error ?? ''), `${r.status} ${r.body.error ?? ''}`);
r = await call('askProductQuestion', buyer, { productId: 'panela', text: 'Serve em fogão de indução mesmo?' });
check('o limite é por anúncio: em outro anúncio pode', r.status === 200, `${r.status} ${r.body.error ?? ''}`);

await adminDb.doc('accountSuspensions/test-atelie').set({ suspended: true });
r = await call('askProductQuestion', marina, { productId: 'camiseta', text: 'Tem estampa lisa também?' });
check('conta suspensa não pergunta', r.status === 403, `${r.status} ${r.body.error ?? ''}`);
await adminDb.doc('accountSuspensions/test-atelie').delete();

console.log('\n— functions: responder');

r = await call('answerProductQuestion', marina, { questionId: firstId, text: 'Tem sim, vem com etiqueta.' });
check('outra loja não responde', r.status === 403, String(r.status));
r = await call('answerProductQuestion', buyer, { questionId: firstId, text: 'Eu mesmo respondo.' });
check('quem perguntou não responde', r.status === 403, String(r.status));
r = await call('answerProductQuestion', seller, { questionId: firstId, text: '.' });
check('resposta curta demais', r.status === 400, String(r.status));
r = await call('answerProductQuestion', seller, { questionId: firstId, text: 'Compra pelo meu zap 11 98888-7777 que sai mais barato' });
check('resposta com contato por fora barrada', r.status === 422, `${r.status} ${r.body.error ?? ''}`);
r = await call('answerProductQuestion', seller, { questionId: 'naoexiste1234567890', text: 'Tem sim.' });
check('pergunta que não existe', r.status === 404, String(r.status));

await sleep(1200);
r = await call('answerProductQuestion', seller, { questionId: firstId, text: 'Tem sim, vem com etiqueta e lacre.' });
check('a loja dona responde', r.status === 200 && r.body.first === true, `${r.status} ${JSON.stringify(r.body)}`);
let answered = await read(Q(firstId));
check('vira "respondida" com tempo de resposta e marca de não vista',
  answered.status === 'answered' && answered.responseMs > 0 && answered.askerUnread === true && answered.answer?.text.startsWith('Tem sim'),
  JSON.stringify({ s: answered.status, ms: answered.responseMs, u: answered.askerUnread }));
const answerNotice = await read(`users/test-comprador/notifications/question-answer-${firstId}`);
check('quem perguntou recebe aviso', answerNotice?.kind === 'question' && answerNotice?.link === '/my-questions?aba=minhas');

const firstMs = answered.responseMs;
r = await call('answerProductQuestion', seller, { questionId: firstId, text: 'Tem sim, vem com etiqueta, lacre e nota.' });
answered = await read(Q(firstId));
check('editar a resposta não refaz o tempo nem avisa de novo',
  r.status === 200 && r.body.first === false && answered.responseMs === firstMs && answered.answer.text.endsWith('nota.'), JSON.stringify(r.body));

console.log('\n— functions: apagar');

r = await call('deleteProductQuestion', buyer, { questionId: firstId, scope: 'answer' });
check('quem perguntou não retira a resposta da loja', r.status === 403, String(r.status));
r = await call('deleteProductQuestion', seller, { questionId: firstId, scope: 'answer' });
answered = await read(Q(firstId));
check('loja retira a resposta: pergunta volta para a fila',
  r.status === 200 && answered.status === 'open' && answered.answer === null && answered.responseMs === null, `${r.status} ${answered?.status}`);
r = await call('deleteProductQuestion', marina, { questionId: firstId, scope: 'question' });
check('terceiro não apaga a pergunta', r.status === 403, String(r.status));
r = await call('deleteProductQuestion', buyer, { questionId: firstId, scope: 'question' });
check('quem perguntou apaga a própria pergunta', r.status === 200 && !(await read(Q(firstId))), String(r.status));
r = await call('deleteProductQuestion', seller, { questionId: OPEN_BUYER, scope: 'question' });
check('loja apaga pergunta do anúncio dela', r.status === 200 && !(await read(Q(OPEN_BUYER))), String(r.status));
r = await call('deleteProductQuestion', seller, { questionId: OPEN_BUYER, scope: 'question' });
check('apagar de novo não dá erro', r.status === 200 && r.body.already === true, String(r.status));

console.log('\n— anúncio apagado');

await adminDb.doc('products/camiseta').delete();
await sleep(5000);
const orphans = await adminDb.collection('productQuestions').where('productId', '==', 'camiseta').get();
check('apagar o anúncio apaga as perguntas dele', orphans.empty, `${orphans.size} sobraram`);
const others = await adminDb.collection('productQuestions').where('productId', '==', 'fone').get();
check('perguntas de outros anúncios ficam', !others.empty);

console.log('\n— excluir conta');

const dry = await call('deleteMyAccount', marina, { dryRun: true });
const marinaQuestions = (await adminDb.collection('productQuestions').where('userId', '==', 'test-atelie').get()).size;
check('a exclusão de conta conta as perguntas feitas', dry.body.summary?.questions === marinaQuestions && marinaQuestions > 0,
  `${dry.status} ${dry.body.summary?.questions} / ${marinaQuestions}`);

console.log(`\n${ok} de ${tests} testes passaram`);
for (const c of [buyer, seller, marina, adminUser, guest]) await deleteApp(c.app);
process.exit(ok === tests ? 0 : 1);
