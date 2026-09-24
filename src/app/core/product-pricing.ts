import { FreeShippingRule } from '../interfaces/app-config';
import { Product } from '../interfaces/product';

/**
 * Regras de preço exibido, compartilhadas pela vitrine do celular e do desktop.
 * `priceDiscounted` só vale como promoção quando é positivo e menor que `price`.
 */

export function hasDiscount(product: Product): boolean {
  return (
    product.priceDiscounted != null &&
    product.priceDiscounted > 0 &&
    product.price > 0 &&
    product.priceDiscounted < product.price
  );
}

/** Preço cobrado: o promocional quando existe, senão o cheio. */
export function priceMain(product: Product): number {
  return hasDiscount(product) ? (product.priceDiscounted as number) : product.price;
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
