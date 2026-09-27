// Importa o catálogo inicial (catalogo-inicial.mjs) para `catalogProducts`.
//
//   node functions/scripts/catalog-import.mjs --emulator      (demo-vineon local)
//   node functions/scripts/catalog-import.mjs --prod          (compraki-mcu)
//   ... --prod --dry-run                                      (só mostra o que faria)
//
// Só CRIA: ficha que já existe (mesmo id) é pulada, então rodar de novo não
// desfaz o que o admin editou. Em produção usa a sessão do `firebase login`
// desta máquina (conta dona do projeto; as regras do Firestore não se aplicam
// a ela). No emulador usa o token "owner".

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { CATALOGO_INICIAL } from './catalogo-inicial.mjs';

const args = new Set(process.argv.slice(2));
const PROD = args.has('--prod');
const DRY = args.has('--dry-run');
if (PROD === args.has('--emulator')) {
  console.error('Use --prod ou --emulator.');
  process.exit(1);
}

const PROJECT = PROD ? 'compraki-mcu' : 'demo-vineon';
const BASE = PROD
  ? `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
  : `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

const request = PROD ? await prodClient() : emulatorClient();

let created = 0, skipped = 0;
for (const item of CATALOGO_INICIAL) {
  const doc = toCatalogDoc(item);
  const url = `/catalogProducts/${item.id}`;
  const exists = (await request('GET', url)).status === 200;
  if (exists) {
    skipped++;
    console.log(`= já existe   ${item.id}`);
    continue;
  }
  if (DRY) {
    console.log(`+ criaria     ${item.id} (${doc.specs.length} características, ${doc.variantAttributes.length} opções)`);
    created++;
    continue;
  }
  const res = await request('PATCH', `${url}?currentDocument.exists=false`, { fields: toFields(doc) });
  if (res.status >= 300) {
    console.error(`! falhou      ${item.id}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    process.exitCode = 1;
    continue;
  }
  created++;
  console.log(`+ criado      ${item.id}`);
}
console.log(`\n${PROJECT}: ${created} ${DRY ? 'a criar' : 'criados'}, ${skipped} já existiam, ${CATALOGO_INICIAL.length} no arquivo.`);

// ------------------------------------------------------------------ dados

function toCatalogDoc(item) {
  const [categoryId, subcategoryId] = item.cat;
  const [weight, length, width, height] = item.pkg;
  const now = new Date();
  const doc = {
    title: item.title,
    brand: item.brand,
    model: item.model,
    line: item.line || '',
    categoryId,
    subcategoryId: subcategoryId || null,
    photos: [],
    specs: item.specs.map(([label, value]) => ({ label, value })),
    gtins: [],
    aliases: item.aliases || [],
    variantAttributes: item.options || [],
    variantImages: {},
    weight, width, height, length,
    description: item.description,
    referencePrice: item.ref ?? null,
    status: 'active',
    createdBy: 'catalogo-inicial',
    updatedBy: 'catalogo-inicial',
    createdAt: now,
    updatedAt: now,
  };
  return { ...doc, keywords: catalogKeywords(doc) };
}

/**
 * Mesma regra de `catalogKeywords()` em src/app/core/catalog.ts (e do seed do
 * emulador). Mudou lá, mude aqui.
 */
function catalogKeywords(p) {
  const words = new Set(
    [p.title, p.brand, p.model, p.line, ...(p.aliases || []), ...(p.gtins || []), ...(p.variantAttributes || []).flatMap(a => a.values)]
      .flatMap(text => (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  );
  const keys = new Set();
  for (const word of words) {
    if (word.length === 1) keys.add(word);
    for (let size = 2; size <= Math.min(word.length, 20); size++) keys.add(word.slice(0, size));
    keys.add(word);
  }
  return [...keys].slice(0, 400);
}

// --------------------------------------------------------- formato REST

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

function toFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));
}

// --------------------------------------------------------------- clientes

function emulatorClient() {
  return async (method, url, body) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

/** Cliente da API usando a conta do `firebase login` (firebase-tools global). */
async function prodClient() {
  const root = execSync('npm root -g').toString().trim();
  const require = createRequire(path.join(root, 'firebase-tools', 'package.json'));
  const { requireAuth } = require('./lib/requireAuth');
  const { Client } = require('./lib/apiv2');
  const account = require('./lib/auth').getGlobalDefaultAccount();
  if (!account) throw new Error('Faça "firebase login" antes.');
  await requireAuth({ user: account.user, tokens: account.tokens });
  console.log(`Conta: ${account.user.email} · projeto ${PROJECT}${DRY ? ' · simulação' : ''}\n`);
  const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const prefix = `/projects/${PROJECT}/databases/(default)/documents`;
  return async (method, url, body) => {
    try {
      const res = await client.request({ method, path: prefix + url, body, resolveOnHTTPError: true });
      return { status: res.status, body: res.body };
    } catch (err) {
      return { status: err.status || err.context?.response?.statusCode || 500, body: String(err.message) };
    }
  };
}
