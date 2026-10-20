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
/** Quantas fotos cada opção (cor, por exemplo) pode ter na sua galeria. */
export const MAX_OPTION_PHOTOS = 10;

/** Galerias por opção: só opções que existem no 1º atributo, sem galeria vazia. */
export function cleanVariantPhotos(
  attributes: ProductVariantAttribute[],
  photos: Record<string, string[]> | null | undefined
): Record<string, string[]> {
  const values = new Set(attributes[0]?.values || []);
  const clean: Record<string, string[]> = {};
  for (const [value, list] of Object.entries(photos || {})) {
    const urls = Array.from(new Set((list || []).filter(Boolean))).slice(0, MAX_OPTION_PHOTOS);
    if (values.has(value) && urls.length) clean[value] = urls;
  }
  return clean;
}

/**
 * Foto principal de cada opção: a 1ª da galeria; sem galeria, a foto única
 * escolhida antes de existir galeria por opção.
 */
export function mainOptionImages(
  attributes: ProductVariantAttribute[],
  images: Record<string, string> | null | undefined,
  photos: Record<string, string[]> | null | undefined
): Record<string, string> {
  const result = cleanVariantImages(attributes, images);
  for (const [value, list] of Object.entries(cleanVariantPhotos(attributes, photos))) result[value] = list[0];
  return result;
}

/** Todas as fotos das galerias por opção, na ordem das opções (ou só das `values` dadas). */
export function optionGalleryPhotos(
  attributes: ProductVariantAttribute[] | null | undefined,
  photos: Record<string, string[]> | null | undefined,
  values?: string[]
): string[] {
  const order = values ?? attributes?.[0]?.values ?? [];
  return Array.from(new Set(order.flatMap(value => photos?.[value] || [])));
}

/**
 * Galerias por opção de um anúncio salvo: `variantPhotos`; sem ela, a foto
 * única escolhida antes de existir galeria vira a 1ª foto da opção.
 */
export function galleriesFromProduct(
  product: Pick<Product, 'variantAttributes' | 'variantPhotos' | 'variantImages'>
): Record<string, string[]> {
  const galleries: Record<string, string[]> = {};
  for (const value of product.variantAttributes?.[0]?.values ?? []) {
    const own = product.variantPhotos?.[value] ?? [];
    const legacy = product.variantImages?.[value];
    const list = own.length ? own : legacy ? [legacy] : [];
    if (list.length) galleries[value] = [...list];
  }
  return galleries;
}

/**
 * Fotos gerais de um anúncio salvo: `photoURL` guarda também as fotos de cada
 * opção (no fim, para capa e vitrines); no formulário elas ficam só na galeria.
 * Uma foto geral pode estar também numa galeria — por isso vale
 * `generalPhotoCount` quando existe.
 */
export function generalPhotos(product: Pick<Product, 'photoURL' | 'variantPhotos' | 'generalPhotoCount'>): string[] {
  const all = product.photoURL || [];
  if (typeof product.generalPhotoCount === 'number') return all.slice(0, product.generalPhotoCount);
  const optionPhotos = new Set(Object.values(product.variantPhotos || {}).flat());
  return all.filter(url => !optionPhotos.has(url));
}

/** Fotos de um produto ou ficha, separadas como a galeria por opção precisa. */
export interface OptionPhotoSource {
  /** Todas as fotos, na ordem de exibição (gerais e das opções). */
  all: string[];
  /** Fotos que valem para todas as opções. */
  general: string[];
  /** Galeria de cada valor do 1º atributo. */
  galleries: Record<string, string[]> | null | undefined;
  /** Foto única por valor, de antes de existir galeria. */
  legacy?: Record<string, string> | null;
}

/** Se alguma opção tem foto própria — só então escolher a opção muda a galeria. */
export function hasOptionPhotos(source: Pick<OptionPhotoSource, 'galleries' | 'legacy'>): boolean {
  return Object.values(source.galleries || {}).some(list => list?.length > 0)
    || Object.values(source.legacy || {}).some(Boolean);
}

/**
 * Fotos que a galeria mostra com uma opção do 1º atributo escolhida, no molde
 * do Mercado Livre: só as daquela opção, nunca as das outras.
 * - opção com galeria própria: só a galeria dela;
 * - opção sem galeria: as fotos gerais, tirando as que são de outra opção;
 * - anúncio antigo, com uma foto por opção: ela na frente, depois as gerais.
 * Sem opção escolhida (ou sem foto que sobre), mostra todas.
 */
export function photosForOption(source: OptionPhotoSource, value: string | null | undefined): string[] {
  const all = source.all || [];
  if (!value) return all;

  const own = (source.galleries?.[value] || []).filter(Boolean);
  if (own.length) return Array.from(new Set(own));

  const others = new Set<string>();
  for (const [key, list] of Object.entries(source.galleries || {})) {
    if (key !== value) (list || []).forEach(url => others.add(url));
  }
  for (const [key, url] of Object.entries(source.legacy || {})) {
    if (key !== value && url) others.add(url);
  }

  const notOthers = (list: string[]) => list.filter(url => url && !others.has(url));
  let base = notOthers(source.general || []);
  if (!base.length) base = notOthers(all);

  const single = source.legacy?.[value];
  if (single) return [single, ...base.filter(url => url !== single)];
  return base.length ? base : all;
}

/**
 * Opção do 1º atributo que a página já abre escolhida, para a galeria nascer
 * com as fotos de uma cor só: a 1ª que ainda tem estoque (ou a 1ª, se nenhuma
 * tem). Sem foto por opção, não escolhe nada — a escolha fica com o comprador.
 */
export function defaultPhotoOption(
  attributes: ProductVariantAttribute[] | null | undefined,
  source: Pick<OptionPhotoSource, 'galleries' | 'legacy'>,
  skus?: Record<string, ProductSku> | null
): string | null {
  const first = attributes?.[0];
  if (!first?.values.length || !hasOptionPhotos(source)) return null;
  if (!skus) return first.values[0];
  const inStock = first.values.find(value =>
    Object.values(skus).some(sku => sku.stock > 0 && sku.attributes[first.name] === value));
  return inStock ?? first.values[0];
}

/** Troca cada foto das galerias pela URL definitiva (sobe as prévias locais). */
export async function resolveGalleries(
  galleries: Record<string, string[]>,
  resolve: (photo: string) => Promise<string>
): Promise<Record<string, string[]>> {
  const cache = new Map<string, Promise<string>>();
  const once = (photo: string) => {
    if (!cache.has(photo)) cache.set(photo, resolve(photo));
    return cache.get(photo)!;
  };
  const entries = await Promise.all(Object.entries(galleries).map(async ([value, list]) =>
    [value, await Promise.all(list.map(once))] as const));
  return Object.fromEntries(entries);
}

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
