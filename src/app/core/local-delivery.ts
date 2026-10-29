import { DeliveryCity, LocalDelivery } from '../interfaces/product';

/**
 * Entrega própria da loja: frete grátis que o próprio vendedor dá, entregando
 * ele mesmo nas cidades que escolheu (lojas parceiras do lançamento que
 * entregam na própria cidade). Não passa pelo Melhor Envio: não tem cotação,
 * etiqueta nem custo para a Vineon.
 *
 * Vale para o pedido quando TODOS os itens são entregues pela loja na cidade
 * do endereço — como o frete grátis, que também é do pacote inteiro. Item
 * marcado "só entrego nessas cidades" não vai por transportadora.
 *
 * A mesma regra roda no servidor (`functions/src/local-delivery.ts`, usada
 * pelo `placeOrder`): mudou aqui, mude lá.
 */

export const LOCAL_DELIVERY_LIMITS = { cities: 20, maxDays: 10 } as const;

/** `shippingServiceId` da entrega da loja no checkout (as do Melhor Envio são números). */
export const LOCAL_DELIVERY_SERVICE = 'local';

/** Prazos oferecidos no anúncio, em dias úteis depois do pagamento. */
export const LOCAL_DELIVERY_DAYS = [0, 1, 2, 3, 5] as const;

/** "São José dos Pinhais" e "sao jose  dos pinhais" são a mesma cidade. */
export function cityKey(city: string, state: string): string {
  const name = String(city ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${name}|${String(state ?? '').trim().toUpperCase()}`;
}

/** Config válida ou `null` (anúncio antigo, desligada ou malformada). */
export function readLocalDelivery(raw: unknown): LocalDelivery | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const cities: DeliveryCity[] = [];
  for (const c of Array.isArray(r['cities']) ? r['cities'] : []) {
    const city = String((c as DeliveryCity)?.city ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const state = String((c as DeliveryCity)?.state ?? '').trim().toUpperCase();
    const key = cityKey(city, state);
    if (!city || !/^[A-Z]{2}$/.test(state) || seen.has(key)) continue;
    seen.add(key);
    cities.push({ city, state });
  }
  if (!cities.length) return null;
  const days = Math.round(Number(r['days']));
  return {
    cities: cities.slice(0, LOCAL_DELIVERY_LIMITS.cities),
    days: Number.isFinite(days) ? Math.min(Math.max(days, 0), LOCAL_DELIVERY_LIMITS.maxDays) : 1,
    onlyLocal: r['onlyLocal'] === true,
  };
}

export function deliversTo(config: LocalDelivery | null, city: string, state: string): boolean {
  if (!config || !city || !state) return false;
  const key = cityKey(city, state);
  return config.cities.some(c => cityKey(c.city, c.state) === key);
}

/** "Curitiba/PR", "Curitiba/PR e Pinhais/PR", "Curitiba/PR e mais 3 cidades". */
export function citiesLabel(cities: DeliveryCity[]): string {
  const names = cities.map(c => `${c.city}/${c.state}`);
  if (names.length <= 2) return names.join(' e ');
  return `${names[0]} e mais ${names.length - 1} cidades`;
}

/** Selo curto dos cards da vitrine: "Entrega grátis em Manhuaçu", "... em Manhuaçu +2". */
export function localDeliveryTag(config: LocalDelivery | null): string | null {
  if (!config) return null;
  const more = config.cities.length - 1;
  return `Entrega grátis em ${config.cities[0].city}${more > 0 ? ` +${more}` : ''}`;
}

/** "no mesmo dia", "em até 1 dia útil", "em até 3 dias úteis". */
export function daysLabel(days: number): string {
  if (days <= 0) return 'no mesmo dia';
  return `em até ${days} ${days === 1 ? 'dia útil' : 'dias úteis'}`;
}

export interface DeliveryLine {
  name: string;
  sellerId: string;
  localDelivery: unknown;
}

export interface DeliveryPlan {
  /** Todos os itens são entregues pela loja neste endereço: frete grátis, sem transportadora. */
  local: { days: number; sellerIds: string[] } | null;
  /** O pacote pode ir por transportadora (nenhum item é "só entrega da loja"). */
  carrier: boolean;
  /** Por que não dá para entregar neste endereço (vazio quando dá). */
  blocked: string | null;
}

/** Como este carrinho pode ser entregue neste endereço. */
export function planDelivery(lines: DeliveryLine[], city: string, state: string): DeliveryPlan {
  const rows = lines.map(line => {
    const config = readLocalDelivery(line.localDelivery);
    return { line, config, covered: deliversTo(config, city, state) };
  });

  const local = rows.length > 0 && rows.every(r => r.covered)
    ? {
        days: Math.max(...rows.map(r => r.config!.days)),
        sellerIds: [...new Set(rows.map(r => r.line.sellerId))],
      }
    : null;
  const carrier = rows.every(r => !r.config?.onlyLocal);

  let blocked: string | null = null;
  if (!local && !carrier) {
    const outside = rows.find(r => r.config?.onlyLocal && !r.covered);
    blocked = outside
      ? `"${outside.line.name}" é entregue só pela própria loja, em ${citiesLabel(outside.config!.cities)}. Escolha um endereço numa dessas cidades ou tire o produto do carrinho.`
      : `"${rows.find(r => r.config?.onlyLocal)!.line.name}" é entregue pela própria loja e não vai por transportadora junto com os outros itens. Faça um pedido só com ele.`;
  }
  return { local, carrier, blocked };
}
