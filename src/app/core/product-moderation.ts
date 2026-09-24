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

/**
 * Primeiro termo proibido presente no título, ou `null`.
 *
 * Palavra inteira: "arma" pega "Arma de pressão" mas não "Armário". Para pegar
 * as variações, o admin cadastra com `*` no fim ("arma*" pega "armas").
 * Termo com várias palavras ("cartão clonado") precisa aparecer na sequência.
 */
export function findBlockedWord(title: string, blockedWords: readonly string[]): string | null {
  const words = normalizeForMatch(title).replace(/\*/g, ' ').split(' ').filter(Boolean);
  if (!words.length) return null;

  for (const raw of blockedWords) {
    const term = normalizeForMatch(raw);
    if (!term) continue;

    const parts = term.split(' ');
    const last = parts.length - 1;
    const prefix = parts[last].endsWith('*');
    if (prefix) parts[last] = parts[last].slice(0, -1);
    if (parts.some(p => !p || p.includes('*'))) continue;

    for (let i = 0; i + parts.length <= words.length; i++) {
      const hit = parts.every((part, j) => {
        const word = words[i + j];
        return j === last && prefix ? word.startsWith(part) : word === part;
      });
      if (hit) return raw.trim();
    }
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
