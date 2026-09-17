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

export function hasFreeShipping(product: Product): boolean {
  return product.shipping === 'Frete Grátis';
}
