// Bateria da verificação em duas etapas contra os emuladores.
//
//   npm run emulators
//   node functions/scripts/two-factor.test.mjs
//
// Roda o seed primeiro. Só funciona contra projeto `demo-*`. O emulador não manda
// e-mail: o código é lido de `twoFactor/{uid}.debugCode`, gravado só no emulador.
//
// Diferença do emulador: `auth_time` vem de `lastLoginAt`, um valor por usuário, e
// não da sessão como em produção. Depois de outro login, renovar o token de uma
// sessão antiga muda o `auth_time` dela. Por isso a bateria confere vários aparelhos
// pela lista `tfaSessions` e nunca renova uma sessão velha depois de um login novo.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = process.env.EMULATOR_PROJECT_ID || 'demo-vineon';
if (!PROJECT.startsWith('demo-')) throw new Error('Só roda em projeto demo.');

const HOST = '127.0.0.1';
const FN = `http://${HOST}:5001/${PROJECT}/us-central1`;
const AUTH = `http://${HOST}:9099`;
const FIRESTORE = `http://${HOST}:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const STORAGE = `http://${HOST}:9199/v0/b/${PROJECT}.appspot.com/o`;
const BOUNDARY = 'vineon2fa';
const PASSWORD = 'vineon-teste';
const BUYER = 'comprador@vineon.test';
const ADMIN = 'admin@vineon.test';

process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:8080`;
process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:9099`;
execFileSync('node', [fileURLToPath(new URL('./emulator-seed.mjs', import.meta.url))], { stdio: 'ignore' });
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, extra = '') {
  if (ok) pass++;
  else { fail++; failures.push(`${name} ${extra}`); }
  console.log(`${ok ? '  ok ' : ' FALHA'}  ${name}${ok ? '' : ` ${extra}`}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function signIn(email = BUYER, password = PASSWORD) {
  // `auth_time` tem resolução de segundo: sem a pausa, dois logins seguidos
  // viram a mesma sessão e o teste não prova nada.
  await sleep(1100);
  const response = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await response.json();
  if (!data.idToken) throw new Error(`Login falhou: ${JSON.stringify(data)}`);
  return data;
}

async function refresh(session) {
  const response = await fetch(`${AUTH}/securetoken.googleapis.com/v1/token?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
  });
  const data = await response.json();
  return { ...session, idToken: data.id_token };
}

async function tf(session, action, payload = {}) {
  const response = await fetch(`${FN}/twoFactor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.idToken}` } : {}) },
    body: JSON.stringify({ action, ...payload }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const debugCode = async uid => (await db.doc(`twoFactor/${uid}`).get()).data()?.debugCode;

/** Zera o intervalo de reenvio, para o teste não esperar 1 minuto. */
const clearCooldown = uid => db.doc(`twoFactor/${uid}`).set({ lastSentAt: 0, sendCount: 0 }, { merge: true });

async function askCode(session, purpose, uid) {
  await clearCooldown(uid);
  const sent = await tf(session, 'requestCode', { purpose });
  if (sent.status !== 200) throw new Error(`Código não enviado: ${JSON.stringify(sent)}`);
  return debugCode(uid);
}

async function readUserDoc(session, uid) {
  const response = await fetch(`${FIRESTORE}/users/${uid}`, { headers: { Authorization: `Bearer ${session.idToken}` } });
  return response.status;
}

async function writeUserDoc(session, uid) {
  const response = await fetch(`${FIRESTORE}/users/${uid}?updateMask.fieldPaths=bio`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
    body: JSON.stringify({ fields: { bio: { stringValue: 'teste 2fa' } } }),
  });
  return response.status;
}

async function uploadPhoto(session, uid) {
  // Só o upload multipart passa pelas regras no emulador.
  const name = `profile-photos/${uid}/2fa-${Date.now()}.png`;
  const meta = JSON.stringify({ name, contentType: 'image/png' });
  const body = `--${BOUNDARY}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${BOUNDARY}\r\nContent-Type: image/png\r\n\r\nx\r\n--${BOUNDARY}--`;
  const response = await fetch(`${STORAGE}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${BOUNDARY}`, 'X-Goog-Upload-Protocol': 'multipart', Authorization: `Bearer ${session.idToken}` },
    body,
  });
  return response.status;
}

async function protectedFunction(session) {
  const response = await fetch(`${FN}/placeOrder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
    body: JSON.stringify({}),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function deleteAccountCall(session) {
  const response = await fetch(`${FN}/deleteMyAccount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` },
    body: JSON.stringify({ dryRun: true }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const decodeToken = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const claimsOf = async uid => (await auth.getUser(uid)).customClaims ?? {};
const events = async (uid, type) => (await db.collection('twoFactorEvents').where('uid', '==', uid).where('type', '==', type).get()).size;

console.log('\n1. Conta sem verificação: nada muda');
const buyer = await auth.getUserByEmail(BUYER);
const uid = buyer.uid;
await db.doc(`twoFactor/${uid}`).delete();
await auth.setCustomUserClaims(uid, {});
let session = await signIn();
check('lê o próprio documento', await readUserDoc(session, uid) === 200);
check('escreve no próprio documento', await writeUserDoc(session, uid) === 200);
check('sobe foto no Storage', await uploadPhoto(session, uid) === 200);
check('function protegida passa da autorização', (await protectedFunction(session)).body.code !== 'two-factor-required');
check('status: desligada', (await tf(session, 'status')).body.enabled === false);
check('sem token: 401', (await tf(null, 'status')).status === 401);
check('ação desconhecida: 400', (await tf(session, 'xyz')).status === 400);
check('verifyLogin sem pendência: recusado', (await tf(session, 'verifyLogin', { code: '000000' })).status === 403);
check('useRecovery sem pendência: recusado', (await tf(session, 'useRecovery', { code: 'AAAAA-AAAAA' })).status === 403);
check('código de login sem pendência: recusado', (await tf(session, 'requestCode', { purpose: 'login' })).status === 403);
check('disable com a conta desligada: recusado', (await tf(session, 'requestCode', { purpose: 'disable' })).status === 409);

console.log('\n2. Ativar');
const firstCode = await askCode(session, 'enable', uid);
check('código tem 6 números', /^\d{6}$/.test(firstCode ?? ''), firstCode);
const stored = (await db.doc(`twoFactor/${uid}`).get()).data();
check('guarda hash, não o código', stored.code?.hash && stored.code.hash !== firstCode);
check('reenvio na hora: 429 com espera', await (async () => {
  const again = await tf(session, 'requestCode', { purpose: 'enable' });
  return again.status === 429 && again.body.retryAfter > 0;
})());
check('código errado: 400', (await tf(session, 'enable', { code: firstCode === '000000' ? '111111' : '000000' })).status === 400);
const enabled = await tf(session, 'enable', { code: firstCode });
check('ativa com o código certo', enabled.status === 200 && enabled.body.enabled === true, JSON.stringify(enabled));
const recovery = enabled.body.recoveryCodes ?? [];
check('devolve 10 códigos de recuperação', recovery.length === 10 && new Set(recovery).size === 10);
check('código de ativação não vale de novo', (await tf(session, 'enable', { code: firstCode })).status === 409 || (await tf(session, 'enable', { code: firstCode })).status === 400);
const afterEnable = await db.doc(`twoFactor/${uid}`).get();
check('hashes, nunca os códigos', !JSON.stringify(afterEnable.data()).includes(recovery[0]));
check('debugCode some depois de usar', afterEnable.data().debugCode === undefined);
check('claim tfa ligado', (await claimsOf(uid)).tfa === true);
check('evento registrado', await events(uid, 'enabled') === 1);
session = await refresh(session);
check('sessão que ativou segue lendo', await readUserDoc(session, uid) === 200);
check('sessão que ativou segue na function', (await protectedFunction(session)).body.code !== 'two-factor-required');

console.log('\n3. Login novo com a senha certa não abre nada');
let attacker = await signIn();
check('Firestore: leitura negada', await readUserDoc(attacker, uid) === 403);
check('Firestore: escrita negada', await writeUserDoc(attacker, uid) === 403);
check('Storage: upload negado', await uploadPhoto(attacker, uid) === 403);
const blocked = await protectedFunction(attacker);
check('function: 403 two-factor-required', blocked.status === 403 && blocked.body.code === 'two-factor-required', JSON.stringify(blocked));
check('deleteMyAccount: 403', (await deleteAccountCall(attacker)).body.code === 'two-factor-required');
const publicRead = await fetch(`${FIRESTORE}/categories?pageSize=1`, { headers: { Authorization: `Bearer ${attacker.idToken}` } });
check('o público continua público', publicRead.status === 200, String(publicRead.status));
check('status informa pendência', (await tf(attacker, 'status')).body.pending === true);
check('pendente não desativa', (await tf(attacker, 'disable', { code: '123456' })).status === 403);
check('pendente não pede código de desativar', (await tf(attacker, 'requestCode', { purpose: 'disable' })).status === 403);
check('pendente não pede códigos novos', (await tf(attacker, 'regenerateRecovery', { code: '123456' })).status === 403);

console.log('\n4. Confirmar o login');
let code = await askCode(attacker, 'login', uid);
const stranger = await signIn();
check('código de outra sessão não vale', (await tf(stranger, 'verifyLogin', { code })).status === 400);
attacker = await signIn();
code = await askCode(attacker, 'login', uid);
for (let i = 0; i < 4; i++) await tf(attacker, 'verifyLogin', { code: code === '000000' ? '111111' : '000000' });
check('5ª tentativa errada mata o código', await (async () => {
  await tf(attacker, 'verifyLogin', { code: code === '000000' ? '111111' : '000000' });
  return (await tf(attacker, 'verifyLogin', { code })).status === 400;
})());
code = await askCode(attacker, 'login', uid);
await db.doc(`twoFactor/${uid}`).set({ code: { expiresAt: 1 } }, { merge: true });
check('código expirado não vale', (await tf(attacker, 'verifyLogin', { code })).status === 400);
code = await askCode(attacker, 'login', uid);
check('código certo confirma', (await tf(attacker, 'verifyLogin', { code })).status === 200);
attacker = await refresh(attacker);
check('sessão confirmada lê', await readUserDoc(attacker, uid) === 200);
check('sessão confirmada usa functions', (await protectedFunction(attacker)).body.code !== 'two-factor-required');
const firstAuthTime = decodeToken(session.idToken).auth_time;
const confirmedAuthTime = decodeToken(attacker.idToken).auth_time;
const kept = (await claimsOf(uid)).tfaSessions ?? [];
check('o primeiro aparelho continua na lista', kept.includes(firstAuthTime) && kept.includes(confirmedAuthTime), JSON.stringify(kept));
check('sessão não confirmada segue barrada', await readUserDoc(stranger, uid) === 403);

console.log('\n5. Destino fixo do código');
await auth.updateUser(uid, { email: 'invasor@vineon.test' });
const hijack = await signIn('invasor@vineon.test');
const sent = await (async () => { await clearCooldown(uid); return tf(hijack, 'requestCode', { purpose: 'login' }); })();
check('código segue para o e-mail da ativação', sent.body.email === 'c***@vineon.test', JSON.stringify(sent.body));
await auth.updateUser(uid, { email: BUYER });

console.log('\n6. Reautenticação');
session = await signIn();
const verifiedCode = await askCode(session, 'login', uid);
await tf(session, 'verifyLogin', { code: verifiedCode });
session = await refresh(session);
const pendingProof = await signIn();
const reauth = await signIn();
check('token novo fica pendente', await readUserDoc(reauth, uid) === 403);
check('rebind sem prova: negado', (await tf(reauth, 'rebindSession', { previousToken: 'x' })).status === 403);
check('rebind com token pendente: negado', (await tf(reauth, 'rebindSession', { previousToken: pendingProof.idToken })).status === 403);
const other = await signIn('vendedor@vineon.test');
check('rebind com token de outra conta: negado', (await tf(reauth, 'rebindSession', { previousToken: other.idToken })).status === 403);
check('rebind com token confirmado: ok', (await tf(reauth, 'rebindSession', { previousToken: session.idToken })).status === 200);
check('sessão nova liberada', await readUserDoc(await refresh(reauth), uid) === 200);

console.log('\n7. Claims de admin sobrevivem');
await auth.setCustomUserClaims(uid, { ...(await claimsOf(uid)), admin: true });
session = await signIn();
const keepCode = await askCode(session, 'login', uid);
await tf(session, 'verifyLogin', { code: keepCode });
check('claim admin preservado', (await claimsOf(uid)).admin === true);
const { admin: _admin, ...withoutAdmin } = await claimsOf(uid);
await auth.setCustomUserClaims(uid, withoutAdmin);

console.log('\n8. Novos códigos de recuperação');
session = await refresh(session);
const regenCode = await askCode(session, 'regenerate', uid);
const regen = await tf(session, 'regenerateRecovery', { code: regenCode });
check('gera outra lista', regen.status === 200 && regen.body.recoveryCodes?.length === 10 && regen.body.recoveryCodes[0] !== recovery[0]);

console.log('\n9. Código de recuperação');
let pendingSession = await signIn();
check('lista antiga não vale', (await tf(pendingSession, 'useRecovery', { code: recovery[0] })).status === 400);
for (let i = 0; i < 3; i++) await tf(pendingSession, 'useRecovery', { code: 'ERRAD-OERRA' });
check('5ª falha ainda responde 400', (await tf(pendingSession, 'useRecovery', { code: 'ERRAD-OERRA' })).status === 400);
const locked = await tf(pendingSession, 'useRecovery', { code: regen.body.recoveryCodes[0] });
check('6ª tentativa trava, mesmo com código certo', locked.status === 429, JSON.stringify(locked));
await db.doc(`twoFactor/${uid}`).set({ recoveryFails: 0 }, { merge: true });
const typed = regen.body.recoveryCodes[1].toLowerCase().replace('-', ' ');
const used = await tf(pendingSession, 'useRecovery', { code: typed });
check('aceita minúscula e espaço, e desliga', used.status === 200 && used.body.enabled === false, JSON.stringify(used));
check('claim tfa removido', (await claimsOf(uid)).tfa === undefined);
check('documento apagado', !(await db.doc(`twoFactor/${uid}`).get()).exists);
check('evento registrado', await events(uid, 'recovery_used') === 1);
pendingSession = await refresh(pendingSession);
check('sessão volta a ler', await readUserDoc(pendingSession, uid) === 200);

console.log('\n10. Desativar pelo próprio usuário');
session = await signIn();
const enable2 = await askCode(session, 'enable', uid);
await tf(session, 'enable', { code: enable2 });
session = await refresh(session);
const disableCode = await askCode(session, 'disable', uid);
check('código de outra finalidade não vale', (await tf(session, 'regenerateRecovery', { code: disableCode })).status === 400);
check('desativa', (await tf(session, 'disable', { code: disableCode })).body.enabled === false);
check('login volta a ser direto', await readUserDoc(await signIn(), uid) === 200);

console.log('\n11. Reset pelo admin');
session = await signIn();
const enable3 = await askCode(session, 'enable', uid);
await tf(session, 'enable', { code: enable3 });
check('usuário comum não reseta', (await tf(await refresh(session), 'adminReset', { uid, reason: 'x' })).status === 403);
const admin = await signIn(ADMIN);
check('sem motivo: 400', (await tf(admin, 'adminReset', { uid })).status === 400);
const reset = await tf(admin, 'adminReset', { uid, reason: 'Identidade confirmada por documento' });
check('admin reseta', reset.status === 200, JSON.stringify(reset));
check('admin reset registrado', await events(uid, 'admin_reset') === 1);
check('reset em conta sem 2FA: 409', (await tf(admin, 'adminReset', { uid, reason: 'de novo' })).status === 409);
const adminUid = (await auth.getUserByEmail(ADMIN)).uid;
const adminSession = await signIn(ADMIN);
const enableAdmin = await askCode(adminSession, 'enable', adminUid);
await tf(adminSession, 'enable', { code: enableAdmin });
const pendingAdmin = await signIn(ADMIN);
check('admin pendente não reseta ninguém', (await tf(pendingAdmin, 'adminReset', { uid, reason: 'y' })).body.code === 'two-factor-required');
await db.doc(`twoFactor/${adminUid}`).delete();
const { tfa: _tfa, tfaSessions: _sessions, ...adminClaims } = await claimsOf(adminUid);
await auth.setCustomUserClaims(adminUid, adminClaims);

console.log('\n12. Limite de envios');
session = await signIn();
const enable4 = await askCode(session, 'enable', uid);
await tf(session, 'enable', { code: enable4 });
session = await refresh(session);
await db.doc(`twoFactor/${uid}`).set({ sendCount: 5, windowStartedAt: Date.now(), lastSentAt: 0 }, { merge: true });
check('6º envio na hora: 429', (await tf(session, 'requestCode', { purpose: 'disable' })).body.code === 'too-many');
await db.doc(`twoFactor/${uid}`).set({ sendCount: 0 }, { merge: true });
const finalCode = await askCode(session, 'disable', uid);
await tf(session, 'disable', { code: finalCode });

console.log(`\n${pass} ok, ${fail} falha(s)`);
if (failures.length) console.log(failures.map(item => ` - ${item}`).join('\n'));
process.exit(fail ? 1 : 0);
