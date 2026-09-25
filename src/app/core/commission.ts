/**
 * Taxa da Vineon sobre o valor dos produtos vendidos (sem frete).
 *
 * Mesmo valor de `COMMISSION_RATE` em functions/src/metrics.ts — mudou aqui,
 * mude lá. É usada nas Métricas, na aba Vendedores e no resumo que vai junto
 * da nota fiscal mensal do vendedor.
 */
export const PLATFORM_COMMISSION_RATE = 0.1;

export function platformFee(grossRevenue: number): number {
  return roundCents(grossRevenue * PLATFORM_COMMISSION_RATE);
}

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}
