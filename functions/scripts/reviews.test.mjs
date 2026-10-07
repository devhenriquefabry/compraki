// Bateria das avaliações contra os emuladores: regras do Firestore (com o SDK
// do cliente e as contas do seed, como o app faz) e as Cloud Functions
// `onProductReviewWritten` (selo, nota agregada, avaliação fora do pedido) e
// `onReviewVotesWritten` ("útil").
//
//   npm run emulators            (num terminal)
//   node functions/scripts/reviews.test.mjs
//
// Roda o seed primeiro (zera tudo e recria o cenário conhecido), então dá para
// repetir quantas vezes quiser. Só funciona contra projeto `demo-*`.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PROJECT = process.env.EMULATOR_PROJECT_ID || 'demo-vineon';
if (!PROJECT.startsWith('demo-')) throw new Error('Só roda em projeto demo.');

const seed = fileURLToPath(new URL('./emulator-seed.mjs', import.meta.url));
execFileSync(process.execPath, [seed], { stdio: 'ignore' });
// Os gatilhos do seed (nota agregada) rodam em segundo plano.
await new Promise(r => setTimeout(r, 6000));

// SDK do cliente vem do app (raiz); o Admin, das functions.
const fromRoot = createRequire(new URL('../../package.json', import.meta.url));
const { initializeApp, deleteApp } = fromRoot('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = fromRoot('firebase/auth');
const {
  getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, collectionGroup,
  query, where, getDocs, deleteField, setLogLevel,
} = fromRoot('firebase/firestore');
setLogLevel('silent');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const admin = createRequire(import.meta.url);
const adminApp = admin('firebase-admin/app').initializeApp({ projectId: PROJECT }, 'admin');
const adminDb = admin('firebase-admin/firestore').getFirestore(adminApp);
const read = async path => (await adminDb.doc(path).get()).data();
const settle = () => new Promise(r => setTimeout(r, 4000));

let n = 0, ok = 0, tests = 0;
async function as(email) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-api-key' }, `t${n++}`);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  if (email) await signInWithEmailAndPassword(auth, email, 'vineon-teste');
  return { app, db };
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
const base = (uid, orderId, extra = {}) => ({
  userId: uid, userName: 'Teste T.', rating: 5, comment: 'ok', orderId, photos: [], matchesListing: 'yes',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
});

const buyer = await as('comprador@vineon.test');
const seller = await as('vendedor@vineon.test');
const marina = await as('atelie@vineon.test');
const guest = await as(null);

await expect('avaliar pedido pago mas não entregue (seed-01)', false, () =>
  setDoc(doc(buyer.db, 'products/fone/reviews/test-comprador'), base('test-comprador', 'seed-01')));
await expect('avaliar gravando helpfulCount/selo junto', false, () =>
  setDoc(doc(buyer.db, 'products/fone/reviews/test-comprador'), base('test-comprador', 'seed-09', { helpfulCount: 50, verifiedPurchase: true })));
await expect('avaliar com 6 fotos', false, () =>
  setDoc(doc(buyer.db, 'products/fone/reviews/test-comprador'), base('test-comprador', 'seed-09', { photos: ['a', 'b', 'c', 'd', 'e', 'f'] })));
await expect('avaliar em nome de outra pessoa', false, () =>
  setDoc(doc(buyer.db, 'products/fone/reviews/test-atelie'), base('test-comprador', 'seed-09')));
await expect('avaliar pedido de outra pessoa (seed-r1 é da Marina)', false, () =>
  setDoc(doc(buyer.db, 'products/fone/reviews/test-comprador'), base('test-comprador', 'seed-r1')));
await expect('loja avaliando o próprio produto', false, () =>
  setDoc(doc(seller.db, 'products/fone/reviews/test-vendedor'), base('test-vendedor', 'seed-09')));
await expect('avaliação válida (pedido entregue seed-09)', true, () =>
  setDoc(doc(buyer.db, 'products/fone/reviews/test-comprador'), base('test-comprador', 'seed-09')));
await expect('avaliação válida da panela (pedido entregue seed-06)', true, () =>
  setDoc(doc(buyer.db, 'products/panela/reviews/test-comprador'), base('test-comprador', 'seed-06', { rating: 3 })));
await settle(); // a função grava o selo antes das edições abaixo
await expect('autor muda o pedido citado', false, () =>
  updateDoc(doc(buyer.db, 'products/panela/reviews/test-comprador'), { orderId: 'seed-10', updatedAt: serverTimestamp() }));
await expect('autor infla o próprio "útil"', false, () =>
  updateDoc(doc(buyer.db, 'products/panela/reviews/test-comprador'), { helpfulCount: 99, updatedAt: serverTimestamp() }));
await expect('autor escreve a resposta da loja', false, () =>
  updateDoc(doc(buyer.db, 'products/panela/reviews/test-comprador'), { sellerReply: { text: 'oi', createdAt: new Date(), updatedAt: serverTimestamp() } }));
await expect('autor edita nota e texto', true, () =>
  updateDoc(doc(buyer.db, 'products/panela/reviews/test-comprador'), { rating: 4, comment: 'editado', updatedAt: serverTimestamp() }));
await expect('loja muda a nota do cliente', false, () =>
  updateDoc(doc(seller.db, 'products/panela/reviews/test-comprador'), { rating: 5 }));
await expect('loja de outro produto responde', false, () =>
  updateDoc(doc(marina.db, 'products/panela/reviews/test-comprador'), { sellerReply: { text: 'resposta', createdAt: new Date(), updatedAt: serverTimestamp() } }));
await expect('loja dona responde', true, () =>
  updateDoc(doc(seller.db, 'products/panela/reviews/test-comprador'), { sellerReply: { text: 'Obrigado!', createdAt: new Date(), updatedAt: serverTimestamp() } }));
await expect('loja apaga a própria resposta', true, () =>
  updateDoc(doc(seller.db, 'products/panela/reviews/test-comprador'), { sellerReply: deleteField() }));
await expect('loja apaga a avaliação do cliente', false, () =>
  deleteDoc(doc(seller.db, 'products/panela/reviews/test-comprador')));
await expect('voto em nome de outra pessoa', false, () =>
  setDoc(doc(marina.db, 'products/panela/reviewVotes/test-comprador'), { reviewIds: ['test-atelie'], updatedAt: serverTimestamp() }));
await expect('voto com 201 ids', false, () =>
  setDoc(doc(marina.db, 'products/panela/reviewVotes/test-atelie'), { reviewIds: Array.from({ length: 201 }, (_, i) => 'x' + i), updatedAt: serverTimestamp() }));
await expect('denunciar a própria avaliação', false, () =>
  setDoc(doc(buyer.db, 'contentReports/review_panela~test-comprador_test-comprador'), {
    targetType: 'review', targetId: 'panela~test-comprador', sellerId: 'test-comprador', targetName: 'x', targetPhoto: null,
    reason: 'spam', details: '', reporterId: 'test-comprador', reporterName: 'C', status: 'open', createdAt: serverTimestamp() }));
await expect('denunciar avaliação de outra pessoa', true, () =>
  setDoc(doc(marina.db, 'contentReports/review_panela~test-comprador_test-atelie'), {
    targetType: 'review', targetId: 'panela~test-comprador', sellerId: 'test-comprador', targetName: 'x', targetPhoto: null,
    reason: 'off_topic', details: '', reporterId: 'test-atelie', reporterName: 'M', status: 'open', createdAt: serverTimestamp() }));
await expect('visitante lista avaliações de uma pessoa (grupo)', true, () =>
  getDocs(query(collectionGroup(guest.db, 'reviews'), where('userId', '==', 'test-atelie'))));

console.log('\n— functions');
await settle();
const fone = await read('products/fone/reviews/test-comprador');
check('avaliação válida ganha selo e dados da loja', fone?.verifiedPurchase === true && fone?.sellerId === 'test-vendedor' && !!fone?.productName);
const foneProduct = await read('products/fone');
check('nota do produto recalculada', foneProduct.reviewCount === 2 && foneProduct.rating === 5, `${foneProduct.rating} / ${foneProduct.reviewCount}`);

// Pedido entregue e da pessoa (a regra deixa), mas sem este produto: a função apaga.
await setDoc(doc(buyer.db, 'products/bicicleta/reviews/test-comprador'), base('test-comprador', 'seed-06'));
await settle();
check('avaliação de produto fora do pedido é apagada', !(await read('products/bicicleta/reviews/test-comprador')));

const before = (await read('products/panela/reviews/test-comprador')).helpfulCount ?? 0;
await expect('voto "útil" válido', true, () =>
  setDoc(doc(marina.db, 'products/panela/reviewVotes/test-atelie'), { reviewIds: ['test-comprador'], updatedAt: serverTimestamp() }));
await settle();
const after = (await read('products/panela/reviews/test-comprador')).helpfulCount ?? 0;
check('voto "útil" soma 1 na avaliação', after === before + 1, `${before} -> ${after}`);
await deleteDoc(doc(marina.db, 'products/panela/reviewVotes/test-atelie'));
await settle();
check('tirar o voto desconta', ((await read('products/panela/reviews/test-comprador')).helpfulCount ?? 0) === after - 1);

await expect('autor exclui a própria avaliação', true, () =>
  deleteDoc(doc(buyer.db, 'products/fone/reviews/test-comprador')));
await settle();
check('nota volta ao excluir', (await read('products/fone')).reviewCount === 1);

console.log(`\n${ok} de ${tests} testes passaram`);
for (const c of [buyer, seller, marina, guest]) await deleteApp(c.app);
process.exit(ok === tests ? 0 : 1);
