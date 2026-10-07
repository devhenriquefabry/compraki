// Bateria da recuperação de senha contra os emuladores:
// requestPasswordResetCode, validateResetCode e completePasswordReset.
//
//   1. functions/.env.local com SMTP apontando para um SMTP falso local
//      (ex.: SMTP_HOST=127.0.0.1, SMTP_PORT=2525) — o código chega por e-mail
//      de verdade, e o teste lê do arquivo que o SMTP falso grava (MAILS_FILE).
//   2. npm run emulators
//   3. MAILS_FILE=<arquivo .jsonl do SMTP falso> node functions/scripts/password-reset.test.mjs
//
// Roda o seed primeiro. Só funciona contra projeto `demo-*`.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = process.env.EMULATOR_PROJECT_ID || 'demo-vineon';
if (!PROJECT.startsWith('demo-')) throw new Error('Só roda em projeto demo.');
const MAILS = process.env.MAILS_FILE;
if (!MAILS) throw new Error('Defina MAILS_FILE (arquivo do SMTP falso).');

const HOST = '127.0.0.1';
const FN = `http://${HOST}:5001/${PROJECT}/us-central1`;
const AUTH = `http://${HOST}:9099`;
const EMAIL = 'comprador@vineon.test';
const OLD_PASSWORD = 'vineon-teste';
const NEW_PASSWORD = 'nova-senha-teste-123';

process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:8080`;
process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:9099`;
execFileSync('node', [fileURLToPath(new URL('./emulator-seed.mjs', import.meta.url))], { stdio: 'ignore' });
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const resetDoc = () => db.doc(`passwordResets/${EMAIL}`);

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, extra = '') {
  if (ok) pass++;
  else { fail++; failures.push(`${name} ${extra}`); }
  console.log(`${ok ? '  ok ' : ' FALHA'}  ${name}${ok ? '' : ` ${extra}`}`);
}

async function fn(name, body) {
  const response = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* corpo não-JSON */ }
  return { status: response.status, json, text };
}

async function signIn(password) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true }),
  });
  return r.json();
}

/**
 * Quando as sessões da conta foram invalidadas. O emulador de Auth não recusa o
 * refresh depois de `revokeRefreshTokens` (em produção recusa); o que dá para
 * conferir aqui é que a function chamou a revogação: esta data avança.
 */
const revokedAt = async () => {
  const user = await getAuth().getUserByEmail(EMAIL);
  return new Date(user.tokensValidAfterTime || 0).getTime();
};

function mails() {
  if (!existsSync(MAILS)) return [];
  return readFileSync(MAILS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/** O e-mail chega em quoted-printable; o código de 8 dígitos está no texto puro. */
async function latestCode(after) {
  for (let i = 0; i < 40; i++) {
    const m = mails().filter(x => x.at >= after && x.to.some(t => t.includes(EMAIL))).pop();
    const code = m?.body.match(/recupera[^\n]*?(\d{8})/i)?.[1] || m?.body.match(/\b(\d{8})\b/)?.[1];
    if (code) return { code, mail: m };
    await new Promise(r => setTimeout(r, 250));
  }
  return { code: null, mail: null };
}

/** Pula o intervalo de 1 min entre envios (o teste não espera de verdade). */
const skipCooldown = async () => {
  const snap = await resetDoc().get();
  if (snap.exists) await resetDoc().update({ lastSentAt: Date.now() - 61_000 });
};

// --------------------------------------------------------------- envio
console.log('\nPedir o código');
let r = await fn('requestPasswordResetCode', { email: 'ninguem@vineon.test', method: 'email' });
check('e-mail sem conta: 200 genérico (não revela se existe)', r.status === 200 && /Se o e-mail existir/.test(r.json.message || ''), r.text);
check('sem e-mail: 400', (await fn('requestPasswordResetCode', {})).status === 400);

let t0 = Date.now();
r = await fn('requestPasswordResetCode', { email: EMAIL, method: 'email' });
check('conta existente: 200 e e-mail enviado', r.status === 200 && r.json.email === true, r.text);
let got = await latestCode(t0);
check('o e-mail chegou com um código de 8 dígitos', /^\d{8}$/.test(got.code || ''), JSON.stringify(got.mail?.body?.slice(0, 200)));
check('a resposta da API NÃO traz o código', !!got.code && !r.text.includes(got.code));
const stored = (await resetDoc().get()).data();
check('Firestore guarda hash, não o código', !!stored?.codeHash && !JSON.stringify(stored).includes(got.code), JSON.stringify(stored));
check('validade de 15 min', Math.abs(stored.expiresAt - (t0 + 15 * 60_000)) < 10_000);

r = await fn('requestPasswordResetCode', { email: EMAIL, method: 'email' });
check('pedir de novo em seguida: 429 (1 por minuto)', r.status === 429 && /Aguarde/.test(r.json.error || ''), r.text);

r = await fn('requestPasswordResetCode', { email: EMAIL, method: 'whatsapp' });
check('WhatsApp sem instância conectada: erro claro', r.status === 429 || (r.status === 400 && /WhatsApp|e-mail/i.test(r.json.error || '')), r.text);

// ------------------------------------------------------------ validar
console.log('\nValidar o código');
const wrong = got.code === '00000000' ? '11111111' : '00000000';
r = await fn('validateResetCode', { email: EMAIL, code: wrong });
check('código errado: 400 e diz quantas tentativas restam', r.status === 400 && /4/.test(r.json.error || ''), r.text);
r = await fn('validateResetCode', { email: EMAIL, code: got.code });
check('código certo: 200', r.status === 200, r.text);
r = await fn('validateResetCode', { email: 'ninguem@vineon.test', code: got.code });
check('código de outra conta não vale', r.status === 400, r.text);

for (let i = 0; i < 4; i++) await fn('validateResetCode', { email: EMAIL, code: wrong });
r = await fn('validateResetCode', { email: EMAIL, code: got.code });
check('depois de 5 erros, nem o código certo vale (429)', r.status === 429, r.text);
check('e o código é descartado', !(await resetDoc().get()).exists);

// ------------------------------------------------------------- trocar
console.log('\nTrocar a senha');
t0 = Date.now();
r = await fn('requestPasswordResetCode', { email: EMAIL, method: 'email' });
got = await latestCode(t0);
check('novo pedido depois do descarte: chega outro código', r.status === 200 && !!got.code, r.text);

const before = await signIn(OLD_PASSWORD);
check('login com a senha antiga funciona antes da troca', !!before.idToken);
const revokedBefore = await revokedAt();
await new Promise(res => setTimeout(res, 1100)); // tokensValidAfterTime tem resolução de segundo

r = await fn('completePasswordReset', { email: EMAIL, code: got.code, newPassword: 'curta' });
check('senha com menos de 8 caracteres: 400', r.status === 400, r.text);
r = await fn('completePasswordReset', { email: EMAIL, code: wrong, newPassword: NEW_PASSWORD });
check('trocar com código errado: recusado', r.status === 400, r.text);
r = await fn('completePasswordReset', { email: EMAIL, code: got.code, newPassword: NEW_PASSWORD });
check('trocar com código certo: 200', r.status === 200, r.text);

check('senha antiga não entra mais', !(await signIn(OLD_PASSWORD)).idToken);
const after = await signIn(NEW_PASSWORD);
check('senha nova entra', !!after.idToken);
const revokedAfter = await revokedAt();
check('sessões abertas antes da troca são revogadas', revokedAfter > revokedBefore, `(${revokedBefore} -> ${revokedAfter})`);

r = await fn('completePasswordReset', { email: EMAIL, code: got.code, newPassword: 'outra-senha-123' });
check('o mesmo código não serve duas vezes', r.status === 400, r.text);

// ----------------------------------------------------- validade e limites
console.log('\nValidade e limite por hora');
await skipCooldown();
t0 = Date.now();
await fn('requestPasswordResetCode', { email: EMAIL, method: 'email' });
got = await latestCode(t0);
await resetDoc().update({ expiresAt: Date.now() - 1000 });
r = await fn('validateResetCode', { email: EMAIL, code: got.code });
check('código vencido (15 min): recusado', r.status === 400 && /expirado/i.test(r.json.error || ''), r.text);

await resetDoc().delete().catch(() => undefined);
let lastStatus = 0;
for (let i = 1; i <= 6; i++) {
  if (i > 1) await skipCooldown();
  lastStatus = (await fn('requestPasswordResetCode', { email: EMAIL, method: 'email' })).status;
  if (i === 5) check('5 envios na mesma hora passam', lastStatus === 200, `(5º: ${lastStatus})`);
}
check('6º envio na mesma hora: 429', lastStatus === 429, `(${lastStatus})`);

console.log(`\n${pass} ok, ${fail} falha(s)`);
if (fail) {
  console.log(failures.map(f => ` - ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
