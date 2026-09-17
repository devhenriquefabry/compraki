import { Product, ProductSku, ProductVariantAttribute } from '../interfaces/product';

/**
 * Variações de produto (cor, tamanho...), no molde Mercado Livre/Shopee.
 *
 * Um produto com variações declara até `MAX_ATTRIBUTES` atributos (cada um
 * com sua lista de valores) e uma combinação (`ProductSku`) por par de
 * valores possível — o produto cartesiano dos atributos. Cada combinação tem
 * seu próprio estoque e, opcionalmente, seu próprio preço.
 *
 * `skus` é um mapa (não uma lista) justamente para permitir decremento
 * atômico de estoque via `increment()` do Firestore num caminho tipo
 * `skus.<id>.stock`, do mesmo jeito que o `stock` do topo já funciona.
 */
export const MAX_VARIANT_ATTRIBUTES = 2;
export const MAX_VARIANT_VALUES = 30;

/** Vira um pedaço de chave estável: sem acento, minúsculo, só a-z0-9 e hífen. */
export function slugifyVariantValue(value: string): string {
  const slug = (value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug || 'x';
}

/** Chave da combinação, na ordem dos atributos do produto (não do objeto JS). */
export function skuKey(attributeNames: string[], selection: Record<string, string>): string {
  return attributeNames.map(name => slugifyVariantValue(selection[name] || '')).join('__');
}

export function variantAttributeNames(product: Pick<Product, 'variantAttributes'>): string[] {
  return (product.variantAttributes || []).map(a => a.name);
}

/** Produto cartesiano dos valores de cada atributo — todas as combinações possíveis. */
export function cartesianCombinations(attributes: ProductVariantAttribute[]): Record<string, string>[] {
  return attributes.reduce<Record<string, string>[]>((acc, attr) => {
    if (!attr.values.length) return acc;
    const next: Record<string, string>[] = [];
    for (const combo of acc) {
      for (const value of attr.values) {
        next.push({ ...combo, [attr.name]: value });
      }
    }
    return next;
  }, [{}]);
}

/** A combinação escolhida pelo comprador, só quando todos os atributos foram selecionados. */
export function findSku(product: Pick<Product, 'variantAttributes' | 'skus'>, selection: Record<string, string>): ProductSku | null {
  const names = variantAttributeNames(product);
  if (!names.length || names.some(name => !selection[name])) return null;
  return product.skus?.[skuKey(names, selection)] || null;
}

/** Soma o estoque das combinações — vira o `stock` agregado salvo no produto. */
export function totalVariantStock(skus: Record<string, ProductSku> | null | undefined): number {
  return Object.values(skus || {}).reduce((sum, sku) => sum + Math.max(0, Math.floor(sku.stock || 0)), 0);
}

/** "Cor: Preto · Tamanho: M", para exibir no carrinho, checkout e pedidos. */
export function variantLabel(attributeNames: string[], selection: Record<string, string> | null | undefined): string {
  if (!selection) return '';
  return attributeNames
    .filter(name => selection[name])
    .map(name => `${name}: ${selection[name]}`)
    .join(' · ');
}

/**
 * Limpa e reconcilia atributos + combinações antes de salvar:
 * - até 2 atributos, cada um com nome e ao menos 1 valor, sem duplicatas;
 * - regenera o produto cartesiano e preserva preço/estoque das combinações
 *   que continuam existindo (mesma chave); combinações que sumiram (o
 *   vendedor removeu um valor) são descartadas.
 */
export function cleanVariants(
  attributes: ProductVariantAttribute[] | null | undefined,
  skus: Record<string, ProductSku> | null | undefined
): { variantAttributes: ProductVariantAttribute[]; skus: Record<string, ProductSku> } {
  const cleanAttrs = (attributes || [])
    .map(a => ({
      name: (a.name || '').trim(),
      values: Array.from(new Set((a.values || []).map(v => v.trim()).filter(Boolean))).slice(0, MAX_VARIANT_VALUES)
    }))
    .filter(a => a.name && a.values.length > 0)
    .slice(0, MAX_VARIANT_ATTRIBUTES);

  const names = cleanAttrs.map(a => a.name);
  const combos = cartesianCombinations(cleanAttrs);
  const cleanSkus: Record<string, ProductSku> = {};

  for (const combo of combos) {
    const id = skuKey(names, combo);
    const existing = skus?.[id];
    cleanSkus[id] = {
      id,
      attributes: combo,
      price: existing?.price != null && existing.price > 0 ? existing.price : null,
      stock: Math.max(0, Math.floor(existing?.stock || 0))
    };
  }

  return { variantAttributes: cleanAttrs, skus: cleanSkus };
}

/** Mantém só as imagens de valores que ainda existem no 1º atributo. */
export function cleanVariantImages(
  attributes: ProductVariantAttribute[],
  images: Record<string, string> | null | undefined
): Record<string, string> {
  const values = new Set(attributes[0]?.values || []);
  const clean: Record<string, string> = {};
  for (const [value, url] of Object.entries(images || {})) {
    if (values.has(value) && url) clean[value] = url;
  }
  return clean;
}
