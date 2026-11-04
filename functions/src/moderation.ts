import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';

import { defaultRuntime, handleCors, methodNotAllowed, region, requireAdmin } from './shared/http';

/**
 * Moderação: termos proibidos no título do anúncio e suspensão de conta.
 *
 * O app já barra o termo proibido no formulário (ProductNameGuardService),
 * mas isso é só a primeira camada — app antigo, chamada direta ao Firestore
 * ou termo cadastrado depois passam por ela. Aqui é a garantia: o anúncio
 * ganha `moderation: { hidden: true, reason: 'blocked_word' }` e some da
 * vitrine. As regras do Firestore impedem o vendedor de mexer em `moderation`.
 *
 * `maxInstances` baixo de propósito: ver a nota da cota de CPU do Cloud Run em
 * docs/estado-atual.md — cada função é um serviço e todas somam na cota.
 */

const CONFIG_DOC = 'appConfig/storefront';

// ---------------------------------------------------------------- termos

/**
 * Cópia de src/app/core/product-moderation.ts. Mudou lá, mude aqui: a bateria
 * functions/scripts/product-rules.test.mjs roda as duas contra a mesma tabela.
 */
// -- início: regra de termos
/** Minúsculas, sem acento, com pontuação virando espaço. */
function normalizeForMatch(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9*]+/g, ' ')
    .trim();
}

/** Palavras que não identificam o produto ("arma de fogo" é "arma" + "fogo"). */
const CONNECTORS = new Set(['a', 'o', 'as', 'os', 'e', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'com', 'para', 'pra', 'por', 'um', 'uma']);

/** Palavras que dizem o tipo do produto; o modelo que vem junto vale sozinho. */
const CATEGORY_WORDS = new Set([
  'arma', 'armas', 'fuzil', 'rifle', 'carabina', 'espingarda', 'pistola', 'revolver', 'metralhadora', 'submetralhadora',
  'municao', 'calibre', 'droga', 'drogas', 'entorpecente',
]);

/** Disfarce com números em palavra de letras: "c0ca1na", "m4c0nh4". */
const LEET: Record<string, string> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };

function undoLeet(word: string): string {
  const letters = word.replace(/[0-9]/g, '').length;
  return letters >= 3 ? word.replace(/[013457]/g, d => LEET[d]) : word;
}

/** Plural comum do português, nos dois sentidos: arma/armas, fuzil/fuzis, munição/munições. */
function pluralOf(word: string): string[] {
  return [`${word}s`, `${word}es`, word.replace(/il$/, 'is').replace(/l$/, 'is'), word.replace(/ao$/, 'oes')];
}

function sameWord(word: string, term: string): boolean {
  return word === term || pluralOf(term).includes(word) || pluralOf(word).includes(term);
}

/** Modelo, não palavra: letra na frente e 2+ dígitos ("ak47", "ar15", "m1911"; não "9mm" nem "m16"). */
function isModelCode(word: string): boolean {
  return /^[a-z][a-z0-9]{3,7}$/.test(word) && (word.match(/[0-9]/g) || []).length >= 2;
}

/** Modelos citados num termo que diz o tipo do produto, juntando "ak 47" em "ak47". */
function modelCodes(parts: string[]): string[] {
  if (!parts.some(part => CATEGORY_WORDS.has(part))) return [];
  const codes = parts.filter(isModelCode);
  parts.forEach((part, i) => {
    const joined = part + (parts[i + 1] || '');
    if (/^[a-z]+$/.test(part) && /^[0-9]+$/.test(parts[i + 1] || '') && isModelCode(joined)) codes.push(joined);
  });
  return codes;
}

/** O título tem `compact` escrito junto ou separado: "ak47", "ak 47", "a k 4 7". */
function hasCompact(words: string[], compact: string): boolean {
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let j = i; j < words.length && joined.length < compact.length; j++) {
      joined += words[j];
      if (joined === compact) return true;
    }
  }
  return false;
}

/**
 * Primeiro termo proibido presente no título, ou `null`.
 *
 * - Palavra inteira: "arma" pega "Arma de pressão" e "Armas", não "Armário".
 *   Com `*` no fim, pega o que começa assim ("arma*" pega "armamento").
 * - Termo com várias palavras precisa de todas, em qualquer ordem e com ou sem
 *   as palavras de ligação: "arma de fogo" pega "Arma Fogo"; "cartão clonado"
 *   pega "Cartão Nubank clonado", mas não "Cartão de visita".
 * - Modelo vale sozinho quando o termo diz o tipo do produto: "arma de fogo
 *   ak47" pega "ak47". Só código com letras e números, para "arma branca" não
 *   derrubar "Camiseta branca" e "iphone16 falsificado" não derrubar capinha.
 * - Junto ou separado é igual ("ak47", "AK-47", "ak 47"), e número no lugar de
 *   letra não engana ("c0ca1na").
 */
export function findBlockedWord(title: string, blockedWords: readonly string[]): string | null {
  const words = normalizeForMatch(title).replace(/\*/g, ' ').split(' ').filter(Boolean);
  if (!words.length) return null;
  const decoded = words.map(undoLeet);
  const inTitle = (part: string, prefix: boolean) => [...words, ...decoded].some(word =>
    prefix ? word.startsWith(part) : sameWord(word, part));

  for (const raw of blockedWords) {
    const term = normalizeForMatch(raw);
    if (!term) continue;

    const parts = term.split(' ');
    const last = parts.length - 1;
    const prefix = parts[last].endsWith('*');
    if (prefix) parts[last] = parts[last].slice(0, -1);
    if (parts.some(p => !p || p.includes('*'))) continue;

    const significant = parts.map((part, i) => ({ part, prefix: prefix && i === last })).filter(p => !CONNECTORS.has(p.part));
    const needed = significant.length ? significant : parts.map(part => ({ part, prefix: false }));
    const compact = parts.join('');

    if (needed.every(p => inTitle(p.part, p.prefix))) return raw.trim();
    if (!prefix && compact.length >= 4 && (hasCompact(words, compact) || hasCompact(decoded, compact))) return raw.trim();
    if (modelCodes(parts).some(code => hasCompact(words, code))) return raw.trim();
  }
  return null;
}
// -- fim: regra de termos

/** Lista de termos com cache curto por instância (o trigger de produto roda muito). */
let cachedWords: { words: string[]; at: number } | null = null;

async function loadBlockedWords(force = false): Promise<string[]> {
  if (!force && cachedWords && Date.now() - cachedWords.at < 60_000) return cachedWords.words;
  const snap = await getFirestore().doc(CONFIG_DOC).get();
  const raw = snap.get('blockedWords');
  const words = Array.isArray(raw) ? raw.filter((w): w is string => typeof w === 'string') : [];
  cachedWords = { words, at: Date.now() };
  return words;
}

/**
 * O que `moderation` deve virar para este produto, ou `undefined` quando não
 * há nada a mudar. Só mexe no bloqueio por termo: suspensão e remoção pelo
 * admin têm precedência e não são desfeitas aqui.
 */
function nextModeration(product: FirebaseFirestore.DocumentData, words: string[]): object | null | undefined {
  const current = product['moderation'];
  const term = findBlockedWord(String(product['name'] || ''), words);

  if (term) {
    if (current?.hidden) return undefined; // já fora do ar (por este ou outro motivo)
    return { hidden: true, reason: 'blocked_word', term, at: FieldValue.serverTimestamp(), by: 'system' };
  }

  if (current?.reason === 'blocked_word') return null; // título limpo: volta ao ar
  return undefined;
}

/** Confere o título a cada criação/edição de anúncio. */
export const moderateProductName = onDocumentWritten(
  { document: 'products/{productId}', region, maxInstances: 2 },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const data = after.data() ?? {};
    const beforeName = event.data?.before?.exists ? event.data.before.get('name') : undefined;
    // Só o título (e o próprio bloqueio) interessam. A escrita desta função
    // dispara o trigger de novo; aí o nome não mudou e ela sai aqui.
    if (beforeName === data['name'] && data['moderation']?.reason !== 'blocked_word') return;

    const next = nextModeration(data, await loadBlockedWords());
    if (next === undefined) return;

    await after.ref.update({ moderation: next === null ? FieldValue.delete() : next });
    logger.info('Moderação de título aplicada', { productId: event.params['productId'], hidden: next !== null });
  }
);

/**
 * O admin mudou a lista de termos: revarre o catálogo para tirar do ar o que
 * passou a ser proibido e devolver o que foi liberado.
 */
export const onStorefrontConfigWritten = onDocumentWritten(
  { document: CONFIG_DOC, region, maxInstances: 1, timeoutSeconds: 300 },
  async (event) => {
    const before = event.data?.before?.get('blockedWords') ?? [];
    const after = event.data?.after?.get('blockedWords') ?? [];
    if (JSON.stringify(before) === JSON.stringify(after)) return;

    const words = await loadBlockedWords(true);
    const db = getFirestore();
    const snap = await db.collection('products').select('name', 'moderation').get();

    let batch = db.batch();
    let pending = 0;
    let hidden = 0;
    let restored = 0;

    for (const doc of snap.docs) {
      const next = nextModeration(doc.data(), words);
      if (next === undefined) continue;
      batch.update(doc.ref, { moderation: next === null ? FieldValue.delete() : next });
      if (next === null) restored++;
      else hidden++;
      if (++pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending) await batch.commit();

    logger.info('Catálogo revarrido após mudança na lista de termos', { scanned: snap.size, hidden, restored });
  }
);

// ------------------------------------------------------------- suspensão

interface SuspensionRequest {
  uid?: string;
  suspended?: boolean;
  reason?: string;
}

/**
 * "Derruba" (ou reativa) a conta de quem viola os termos. Só admin.
 *
 * Suspender:
 *  - desativa o usuário no Firebase Auth e revoga os refresh tokens (o app
 *    perde a sessão e o login passa a devolver `auth/user-disabled`);
 *  - cria `accountSuspensions/{uid}` — as regras do Firestore consultam essa
 *    marca para barrar escrita com um ID token ainda válido (até 1 hora);
 *  - espelha em `users/{uid}.suspended` (painel) e `sellers/{uid}.suspended`
 *    (a loja pública mostra o aviso);
 *  - tira do ar todos os anúncios da pessoa (`moderation.reason =
 *    'account_suspended'`), sem sobrescrever outro motivo que já exista.
 *
 * Reativar desfaz tudo isso — e só devolve ao ar o que saiu pela suspensão.
 */
export const setAccountSuspension = onRequest({ ...defaultRuntime, maxInstances: 2, timeoutSeconds: 120 }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const { uid, suspended, reason } = (req.body || {}) as SuspensionRequest;
  if (!uid || typeof uid !== 'string') {
    res.status(400).json({ error: 'Informe o `uid` da conta.' });
    return;
  }
  if (typeof suspended !== 'boolean') {
    res.status(400).json({ error: 'Campo `suspended` (boolean) é obrigatório.' });
    return;
  }
  const note = String(reason || '').trim().slice(0, 500);
  if (suspended && !note) {
    res.status(400).json({ error: 'Informe o motivo da suspensão.' });
    return;
  }
  if (uid === caller.uid) {
    res.status(400).json({ error: 'Você não pode suspender a própria conta.' });
    return;
  }

  const auth = getAuth();
  const db = getFirestore();

  try {
    const target = await auth.getUser(uid).catch(() => null);
    if (suspended && target?.customClaims?.['admin'] === true) {
      res.status(400).json({ error: 'Conta de administrador não pode ser suspensa. Remova o acesso de admin antes.' });
      return;
    }

    // 1. Login
    if (target) {
      await auth.updateUser(uid, { disabled: suspended });
      if (suspended) await auth.revokeRefreshTokens(uid);
    }

    // 2. Marca, espelhos e auditoria
    const suspensionRef = db.doc(`accountSuspensions/${uid}`);
    const record = { at: FieldValue.serverTimestamp(), by: caller.uid, reason: note };

    const batch = db.batch();
    if (suspended) {
      batch.set(suspensionRef, record);
      batch.set(db.doc(`users/${uid}`), { suspended: record }, { merge: true });
      batch.set(db.doc(`sellers/${uid}`), { suspended: true }, { merge: true });
    } else {
      batch.delete(suspensionRef);
      batch.set(db.doc(`users/${uid}`), { suspended: FieldValue.delete() }, { merge: true });
      batch.set(db.doc(`sellers/${uid}`), { suspended: FieldValue.delete() }, { merge: true });
    }
    batch.set(db.collection('moderationLog').doc(), {
      action: suspended ? 'suspend' : 'reinstate',
      uid,
      reason: note,
      by: caller.uid,
      at: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    // 3. Anúncios
    const products = await db.collection('products').where('sellerId', '==', uid).get();
    let changed = 0;
    let writer = db.batch();
    let pending = 0;

    for (const doc of products.docs) {
      const moderation = doc.get('moderation');
      if (suspended) {
        if (moderation?.hidden) continue; // já fora do ar por outro motivo
        writer.update(doc.ref, {
          moderation: { hidden: true, reason: 'account_suspended', note, at: FieldValue.serverTimestamp(), by: caller.uid },
        });
      } else {
        if (moderation?.reason !== 'account_suspended') continue;
        writer.update(doc.ref, { moderation: FieldValue.delete() });
      }
      changed++;
      if (++pending >= 400) {
        await writer.commit();
        writer = db.batch();
        pending = 0;
      }
    }
    if (pending) await writer.commit();

    logger.info('Suspensão de conta atualizada', { uid, suspended, by: caller.uid, products: changed });
    res.status(200).json({ success: true, uid, suspended, productsChanged: changed, authUserFound: !!target });
  } catch (error) {
    logger.error('Falha ao atualizar suspensão de conta', error);
    res.status(500).json({ error: 'Não foi possível atualizar a conta.' });
  }
});
