import { AggregateField, FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';

import { defaultRuntime, handleCors, methodNotAllowed, region, requireAdmin } from './shared/http';

/**
 * Métricas agregadas, calculadas no servidor.
 *
 * POR QUE ISSO EXISTE
 * `AdminAnalyticsService` monta o painel abrindo `onSnapshot` sobre `users`,
 * `products` e `orders` INTEIRAS, no navegador. O custo é linear no tamanho da
 * base e se repete a cada abertura do painel — e como é listener, qualquer
 * alteração retransmite tudo.
 *
 * Aqui as contagens saem de *aggregation queries* (`count`/`sum`), que o
 * Firestore cobra por índice varrido e não por documento devolvido: ordens de
 * grandeza mais barato. O resultado é gravado em `metrics/daily/days/{AAAA-MM-DD}`
 * (histórico) e em `metrics/summary` (última foto), e o painel lê um documento.
 *
 * Ver `docs/runbook-fase-0.md` para o deploy; as regras já liberam leitura de
 * `metrics/**` só para admin, e escrita para ninguém (só Admin SDK).
 */

const TZ = 'America/Sao_Paulo';
const COMMISSION_RATE = 0.1;

/** Status que representam venda concretizada (não cancelada nem estornada). */
const REVENUE_STATUSES = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'];

interface MetricsSnapshot {
  date: string;
  computedAt: FirebaseFirestore.FieldValue;
  totals: {
    users: number;
    products: number;
    orders: number;
  };
  newUsers: {
    today: number;
    week: number;
    month: number;
  };
  sales: {
    ordersToday: number;
    ordersWeek: number;
    ordersMonth: number;
    gmvMonth: number;
    commissionMonth: number;
    averageTicketMonth: number;
  };
}

function startOfDayUTC(daysAgo = 0): Timestamp {
  // Aproximação em UTC. O painel tolera o deslocamento de fuso; o que importa
  // é a janela ser estável entre execuções.
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return Timestamp.fromDate(d);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function countWhere(
  collectionName: string,
  field?: string,
  since?: Timestamp
): Promise<number> {
  const db = getFirestore();
  let q: FirebaseFirestore.Query = db.collection(collectionName);

  if (field && since) q = q.where(field, '>=', since);

  const snap = await q.count().get();
  return snap.data().count;
}

/** Soma o total dos pedidos que contam como receita, na janela informada. */
async function sumRevenue(since: Timestamp): Promise<{ gmv: number; orders: number }> {
  const db = getFirestore();

  // Precisa do indice composto (status ASC, createdAt ASC) — ja versionado
  // em firestore.indexes.json.
  const q = db.collection('orders')
    .where('status', 'in', REVENUE_STATUSES)
    .where('createdAt', '>=', since);

  const snap = await q.aggregate({
    gmv: AggregateField.sum('total'),
    orders: AggregateField.count()
  }).get();

  const data = snap.data() as { gmv?: number; orders?: number };
  return { gmv: Number(data.gmv || 0), orders: Number(data.orders || 0) };
}

async function computeMetrics(): Promise<MetricsSnapshot> {
  const dayStart = startOfDayUTC(0);
  const weekStart = startOfDayUTC(7);
  const monthStart = startOfDayUTC(30);

  const [
    users,
    products,
    orders,
    newUsersToday,
    newUsersWeek,
    newUsersMonth,
    salesToday,
    salesWeek,
    salesMonth
  ] = await Promise.all([
    countWhere('users'),
    countWhere('products'),
    countWhere('orders'),
    countWhere('users', 'createdAt', dayStart),
    countWhere('users', 'createdAt', weekStart),
    countWhere('users', 'createdAt', monthStart),
    sumRevenue(dayStart),
    sumRevenue(weekStart),
    sumRevenue(monthStart)
  ]);

  return {
    date: today(),
    computedAt: FieldValue.serverTimestamp(),
    totals: { users, products, orders },
    newUsers: { today: newUsersToday, week: newUsersWeek, month: newUsersMonth },
    sales: {
      ordersToday: salesToday.orders,
      ordersWeek: salesWeek.orders,
      ordersMonth: salesMonth.orders,
      gmvMonth: salesMonth.gmv,
      commissionMonth: salesMonth.gmv * COMMISSION_RATE,
      averageTicketMonth: salesMonth.orders > 0 ? salesMonth.gmv / salesMonth.orders : 0
    }
  };
}

async function persist(metrics: MetricsSnapshot): Promise<void> {
  const db = getFirestore();
  const batch = db.batch();

  // Histórico por dia — permite gráfico de evolução sem varrer `orders`.
  batch.set(db.doc(`metrics/daily/days/${metrics.date}`), metrics, { merge: true });
  // Última foto, que é o que o painel lê ao abrir.
  batch.set(db.doc('metrics/summary'), metrics, { merge: true });

  await batch.commit();
}

/**
 * Recalcula as métricas de hora em hora.
 *
 * De hora em hora, e não a cada minuto, porque o painel não precisa de número
 * ao vivo — precisa de número barato. Quem quiser o valor do instante usa
 * `refreshMetricsNow`.
 */
export const aggregateDailyMetrics = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: TZ,
    region,
    maxInstances: 1,
    timeoutSeconds: 300
  },
  async () => {
    const metrics = await computeMetrics();
    await persist(metrics);
    logger.info('Métricas agregadas', { date: metrics.date, totals: metrics.totals });
  }
);

/** Recalcula sob demanda, para o botão "atualizar" do painel. */
export const refreshMetricsNow = onRequest(
  { ...defaultRuntime, timeoutSeconds: 300 },
  async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res);

    const caller = await requireAdmin(req, res);
    if (!caller) return;

    try {
      const metrics = await computeMetrics();
      await persist(metrics);

      logger.info('Métricas recalculadas sob demanda', { by: caller.uid });
      res.status(200).json({ success: true, metrics: { ...metrics, computedAt: undefined } });
    } catch (error) {
      logger.error('Falha ao recalcular métricas', error);
      res.status(500).json({ error: 'Erro ao recalcular métricas.' });
    }
  }
);
