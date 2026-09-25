/**
 * Taxa da Vineon sobre o valor dos produtos vendidos (sem frete).
 *
 * O admin configura em Ajustes (`appConfig/storefront.commission`). Cada
 * mudança entra no histórico com a data em que passou a valer: uma venda usa
 * a taxa em vigor na data do pagamento. Assim, subir de 5% para 8% não mexe
 * nas contas dos meses anteriores nem nas notas já enviadas.
 *
 * Antes da primeira configuração vale `DEFAULT_COMMISSION_RATE` (os 10% que
 * o painel sempre usou).
 */
export const DEFAULT_COMMISSION_RATE = 0.1;
/** Teto de segurança do campo em Ajustes. */
export const MAX_COMMISSION_RATE = 0.5;

export interface CommissionChange {
  /** Fração: 0,08 = 8%. */
  rate: number;
  /** Desde quando vale (epoch em ms). */
  since: number;
  /** uid do admin que mudou. */
  by?: string | null;
}

export interface CommissionConfig {
  /** Taxa em vigor agora. */
  rate: number;
  /** Mudanças, da mais antiga para a mais nova. */
  history: CommissionChange[];
}

export const DEFAULT_COMMISSION: CommissionConfig = { rate: DEFAULT_COMMISSION_RATE, history: [] };

/** Taxa em vigor numa data (a do pagamento da venda). */
export function rateAt(config: CommissionConfig, date: Date | null): number {
  const history = config.history;
  if (!history.length) return config.rate;
  const time = (date ?? new Date()).getTime();
  let rate = DEFAULT_COMMISSION_RATE;
  for (const change of history) {
    if (change.since <= time) rate = change.rate;
    else break;
  }
  return rate;
}

export function feeFor(amount: number, rate: number): number {
  return roundCents(amount * rate);
}

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 0,075 → "7,5%". */
export function formatRate(rate: number): string {
  const pct = Math.round(rate * 1000) / 10;
  return `${String(pct).replace('.', ',')}%`;
}

/** Taxas usadas num período: "10%" ou, se mudou no meio, "5% e 8%". */
export function describeRates(rates: Iterable<number>): string {
  const unique = [...new Set([...rates].map(r => Math.round(r * 10000) / 10000))].sort((a, b) => a - b);
  if (!unique.length) return '';
  if (unique.length === 1) return formatRate(unique[0]);
  const parts = unique.map(formatRate);
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/** Normaliza o que veio do Firestore (documento antigo não tem o campo). */
export function normalizeCommission(data: any): CommissionConfig {
  const history: CommissionChange[] = Array.isArray(data?.history)
    ? data.history
        .filter((c: any) => typeof c?.rate === 'number' && typeof c?.since === 'number')
        .map((c: any) => ({ rate: c.rate, since: c.since, by: c.by ?? null }))
        .sort((a: CommissionChange, b: CommissionChange) => a.since - b.since)
    : [];
  const rate = typeof data?.rate === 'number' && data.rate >= 0 && data.rate <= MAX_COMMISSION_RATE
    ? data.rate
    : DEFAULT_COMMISSION_RATE;
  return { rate, history };
}
