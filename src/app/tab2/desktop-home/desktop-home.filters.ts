import { ParamMap } from '@angular/router';
import { FreeShippingRule } from '../../interfaces/app-config';
import { Product } from '../../interfaces/product';
import { hasDiscount, hasFreeShipping, priceMain } from '../../core/product-pricing';

/**
 * Filtros da vitrine de desktop. Moram na URL (`?q=&cat=&frete=1...`), então
 * toda busca tem link próprio e o voltar do navegador desfaz o último filtro.
 */

export type StoreSort = 'relevancia' | 'preco-menor' | 'preco-maior' | 'mais-vendidos';

export interface StoreFilters {
  q: string;
  cat: string | null;
  frete: boolean;
  ofertas: boolean;
  min: number | null;
  max: number | null;
  ordem: StoreSort;
}

const SORTS: StoreSort[] = ['relevancia', 'preco-menor', 'preco-maior', 'mais-vendidos'];

export function parseStoreFilters(params: ParamMap): StoreFilters {
  const ordem = params.get('ordem') as StoreSort | null;
  return {
    q: (params.get('q') ?? '').trim(),
    cat: params.get('cat') || null,
    frete: params.get('frete') === '1',
    ofertas: params.get('ofertas') === '1',
    min: toPrice(params.get('min')),
    max: toPrice(params.get('max')),
    ordem: ordem && SORTS.includes(ordem) ? ordem : 'relevancia',
  };
}

/** Qualquer filtro ligado tira a home do modo vitrine e mostra resultados. */
export function hasActiveFilters(filters: StoreFilters): boolean {
  return (
    !!filters.q ||
    !!filters.cat ||
    filters.frete ||
    filters.ofertas ||
    filters.min != null ||
    filters.max != null ||
    filters.ordem !== 'relevancia'
  );
}

/** Aplica tudo, menos a ordenação e os filtros listados em `skip`. */
export function filterProducts(
  products: Product[],
  filters: StoreFilters,
  skip: Array<keyof StoreFilters> = [],
  freeShippingRule: FreeShippingRule | null = null
): Product[] {
  const term = normalize(filters.q);

  return products.filter(product => {
    if (term && !skip.includes('q')) {
      const haystack = normalize(`${product.name} ${product.description ?? ''}`);
      if (!haystack.includes(term)) return false;
    }
    if (filters.cat && !skip.includes('cat') && !product.categoryIds?.includes(filters.cat)) return false;
    if (filters.frete && !skip.includes('frete') && !hasFreeShipping(product, freeShippingRule)) return false;
    if (filters.ofertas && !skip.includes('ofertas') && !hasDiscount(product)) return false;

    const price = priceMain(product);
    if (filters.min != null && !skip.includes('min') && price < filters.min) return false;
    if (filters.max != null && !skip.includes('max') && price > filters.max) return false;

    return true;
  });
}

export function sortProducts(products: Product[], filters: StoreFilters): Product[] {
  const sorted = [...products];

  switch (filters.ordem) {
    case 'preco-menor':
      return sorted.sort((a, b) => priceMain(a) - priceMain(b));
    case 'preco-maior':
      return sorted.sort((a, b) => priceMain(b) - priceMain(a));
    case 'mais-vendidos':
      return sorted.sort((a, b) => (b.soldCount ?? 0) - (a.soldCount ?? 0));
    default: {
      // Relevância: quem tem o termo no nome vem antes de quem só tem na descrição.
      const term = normalize(filters.q);
      if (!term) return sorted;
      const inName = (p: Product) => (normalize(p.name).includes(term) ? 0 : 1);
      return sorted.sort((a, b) => inName(a) - inName(b));
    }
  }
}

/**
 * Faixas de preço sugeridas ("Até R$ 50", "R$ 50 a R$ 150", "Mais de R$ 150"),
 * cortando a lista em terços. Com poucos produtos as faixas não dizem nada.
 */
export function priceRanges(products: Product[]): Array<{ label: string; min: number | null; max: number | null }> {
  if (products.length < 6) return [];

  const prices = products.map(priceMain).sort((a, b) => a - b);
  const low = roundPrice(prices[Math.floor(prices.length / 3)]);
  const high = roundPrice(prices[Math.floor((prices.length * 2) / 3)]);
  if (low <= 0 || high <= low) return [];

  const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  return [
    { label: `Até ${brl(low)}`, min: null, max: low },
    { label: `${brl(low)} a ${brl(high)}`, min: low, max: high },
    { label: `Mais de ${brl(high)}`, min: high, max: null },
  ];
}

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function toPrice(raw: string | null): number | null {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function roundPrice(value: number): number {
  const step = value < 100 ? 10 : value < 1000 ? 50 : 100;
  return Math.max(step, Math.round(value / step) * step);
}
