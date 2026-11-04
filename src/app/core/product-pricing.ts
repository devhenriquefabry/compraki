import { FreeShippingRule } from '../interfaces/app-config';
import { Product, ProductSku } from '../interfaces/product';

/**
 * Regras de preço exibido, compartilhadas pela vitrine do celular e do desktop.
 * `priceDiscounted` só vale como promoção quando é positivo e menor que `price`.
 */

/** O anúncio tem de/por, sem olhar as combinações. */
export function hasOwnDiscount(product: Product): boolean {
  return (
    product.priceDiscounted != null &&
    product.priceDiscounted > 0 &&
    product.price > 0 &&
    product.priceDiscounted < product.price
  );
}

/** Preço do anúncio em si, sem olhar as combinações. */
function ownPrice(product: Product): number {
  return hasOwnDiscount(product) ? (product.priceDiscounted as number) : product.price;
}

function hasSkuPrice(sku: ProductSku): boolean {
  return typeof sku.price === 'number' && sku.price > 0;
}

/**
 * Preço cobrado por uma combinação: o dela ou, sem preço próprio, o do anúncio.
 * Mesma conta do servidor (`placeOrder`) e do carrinho.
 */
export function skuUnitPrice(product: Product, sku: ProductSku): number {
  return hasSkuPrice(sku) ? (sku.price as number) : ownPrice(product);
}

/** Preços das combinações à venda (todas, se esgotou), ou `null` se nenhuma tem preço próprio. */
function variantPrices(product: Product): number[] | null {
  const skus = product.hasVariants ? Object.values(product.skus || {}) : [];
  if (!skus.some(hasSkuPrice)) return null;
  const inStock = skus.filter(sku => sku.stock > 0);
  return (inStock.length ? inStock : skus).map(sku => skuUnitPrice(product, sku));
}

/** As combinações custam valores diferentes: a vitrine mostra "a partir de". */
export function hasVariedPrices(product: Product): boolean {
  const prices = variantPrices(product);
  return !!prices && new Set(prices).size > 1;
}

/**
 * De/por do anúncio. Com preço por combinação, só vale se a mais barata é uma
 * das que seguem o preço do anúncio: combinação com preço próprio não tem "de".
 */
export function hasDiscount(product: Product): boolean {
  return hasOwnDiscount(product) && priceMain(product) === ownPrice(product);
}

/**
 * Preço cobrado: o promocional quando existe, senão o cheio. Com preço por
 * combinação, o da mais barata (é o "a partir de" das vitrines).
 */
export function priceMain(product: Product): number {
  const prices = variantPrices(product);
  return prices ? Math.min(...prices) : ownPrice(product);
}

export function discountPercent(product: Product): number {
  if (!hasDiscount(product)) return 0;
  return Math.round((1 - (product.priceDiscounted as number) / product.price) * 100);
}

/** Parcela sugerida (informativa), no formato "12x R$ 10,00". */
export function installmentHint(product: Product): string | null {
  const total = priceMain(product);
  if (total < 30) return null;

  const formatted = (total / 12).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `12x R$ ${formatted}`;
}

/**
 * Frete grátis por dois caminhos: o vendedor marcou no anúncio, ou o preço
 * cobrado alcança o mínimo da regra da loja (`AppConfigService.freeShippingRule()`,
 * `null` quando o admin desligou).
 *
 * Não passe esta função direto para `.filter()` — o índice cairia no lugar da
 * regra. Use `p => hasFreeShipping(p, rule)`.
 */
export function hasFreeShipping(product: Product, rule: FreeShippingRule | null = null): boolean {
  if (product.shipping === 'Frete Grátis') return true;
  return !!rule && rule.minValue > 0 && priceMain(product) >= rule.minValue;
}

/** Frete grátis que vem da regra da loja (e não do vendedor). */
export function hasStoreFreeShipping(product: Product, rule: FreeShippingRule | null): boolean {
  return product.shipping !== 'Frete Grátis' && hasFreeShipping(product, rule);
}

/**
 * Lê o preço como o brasileiro digita: "3.200", "3.200,50", "3200,50", "R$ 2.800".
 * Ponto só é decimal quando não forma milhar ("3200.50", "3.20"). Vazio, zero ou
 * sem número vira `null` (a combinação usa o preço do anúncio).
 */
export function parsePriceInput(raw: string | null | undefined): number | null {
  const clean = (raw || '').replace(/[^0-9.,]/g, '');
  let text: string;
  if (clean.includes(',')) text = clean.replace(/\./g, '').replace(',', '.').replace(/,/g, '');
  else if (/^[0-9]{1,3}(\.[0-9]{3})+$/.test(clean)) text = clean.replace(/\./g, '');
  else text = clean;
  const value = Math.round(Number(text) * 100) / 100;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Valor do campo de preço fora de edição: "3.200,00". */
export function formatPriceInput(value: number | null | undefined): string {
  return value ? value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}
