import { Product, ProductModerationReason } from '../interfaces/product';

/**
 * Regras de moderação de anúncio que o app e a Cloud Function aplicam do
 * mesmo jeito. A cópia do servidor está em functions/src/moderation.ts —
 * mudou aqui, mude lá.
 */

/** Minúsculas, sem acento, com pontuação virando espaço. */
export function normalizeForMatch(text: string): string {
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

/** Anúncio fora do ar: não aparece em vitrine, busca nem loja. */
export function isProductHidden(product: Product | null | undefined): boolean {
  return product?.moderation?.hidden === true;
}

export const MODERATION_LABEL: Record<ProductModerationReason, string> = {
  blocked_word: 'Produto não permitido',
  account_suspended: 'Conta suspensa',
  removed_by_admin: 'Removido pela moderação',
};
