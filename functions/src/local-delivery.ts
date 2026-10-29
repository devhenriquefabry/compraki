/**
 * Entrega própria da loja — a mesma regra de `src/app/core/local-delivery.ts`
 * (o app mostra, o `placeOrder` decide). Mudou lá, mude aqui.
 *
 * A loja entrega ela mesma, de graça, nas cidades que escolheu no anúncio
 * (`products/{id}.localDelivery`). Vale para o pedido quando TODOS os itens
 * são entregues pela loja na cidade do endereço; item "só entrego nessas
 * cidades" (`onlyLocal`) não vai por transportadora. Sem Melhor Envio: sem
 * cotação, sem etiqueta e sem custo para a Vineon.
 */

export interface DeliveryCity { city: string; state: string }
export interface LocalDelivery { cities: DeliveryCity[]; days: number; onlyLocal: boolean }

export const LOCAL_DELIVERY_LIMITS = { cities: 20, maxDays: 10 } as const;
export const LOCAL_DELIVERY_SERVICE = 'local';

export function cityKey(city: string, state: string): string {
  const name = String(city ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${name}|${String(state ?? '').trim().toUpperCase()}`;
}

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

function citiesLabel(cities: DeliveryCity[]): string {
  const names = cities.map(c => `${c.city}/${c.state}`);
  if (names.length <= 2) return names.join(' e ');
  return `${names[0]} e mais ${names.length - 1} cidades`;
}

export interface DeliveryLine { name: string; sellerId: string; localDelivery: unknown }

export interface DeliveryPlan {
  local: { days: number; sellerIds: string[] } | null;
  carrier: boolean;
  blocked: string | null;
}

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
