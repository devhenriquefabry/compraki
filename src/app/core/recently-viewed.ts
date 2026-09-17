/**
 * Produtos vistos recentemente, guardados só neste navegador.
 *
 * Alimenta o "Visto recentemente" e o "Inspirado no último visto" da home de
 * desktop. Fica no localStorage de propósito: é uma conveniência de vitrine,
 * não um dado da conta, e não custa leitura nem escrita no Firestore.
 */

const STORAGE_KEY = 'vineon_recently_viewed';
const MAX_ITEMS = 12;

export function rememberViewedProduct(productId: string): void {
  try {
    const ids = getRecentlyViewedIds().filter(id => id !== productId);
    ids.unshift(productId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_ITEMS)));
  } catch {
    // Armazenamento bloqueado (aba anônima, cota): o histórico é opcional.
  }
}

/** Ids do mais recente para o mais antigo. */
export function getRecentlyViewedIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
