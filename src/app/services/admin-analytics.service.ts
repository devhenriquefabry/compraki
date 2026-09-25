import { Injectable, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, from, map, shareReplay } from 'rxjs';
import { collection, getFirestore, onSnapshot, getDoc, getDocs, deleteDoc, writeBatch, doc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { environment } from 'src/environments/environment';
import { AppUser } from '../interfaces/app-user';
import { Order, OrderStatus } from '../interfaces/order';
import { Product } from '../interfaces/product';
import { CommissionConfig, describeRates, feeFor, formatRate, rateAt } from '../core/commission';
import { AppConfigService } from './app-config.service';
import { OrderStage, isPaid, orderStage, paidUnitPrice, sellerItems } from '../core/order-stage';

export type AdminMetricsPeriod = 'today' | '7d' | '30d' | 'custom';

/** Foto pré-calculada em `metrics/summary` (functions/src/metrics.ts). */
export interface AdminMetricsSummary {
  date: string;
  computedAt?: any;
  totals: { users: number; products: number; orders: number };
  newUsers: { today: number; week: number; month: number };
  sales: {
    ordersToday: number;
    ordersWeek: number;
    ordersMonth: number;
    gmvMonth: number;
    commissionMonth: number;
    averageTicketMonth: number;
  };
}

export interface AdminMetricsFilters {
  period: AdminMetricsPeriod;
  startDate?: string;
  endDate?: string;
}

export interface AdminMetricItem {
  label: string;
  value: string;
  helper: string;
  icon: string;
  tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral';
}

export interface AdminChartPoint {
  label: string;
  value: number;
}

export interface AdminNamedMetric {
  id: string;
  name: string;
  helper: string;
  value: number;
  amount?: number;
  image?: string;
  status?: string;
  /** Início da sessão online (para exibir duração no painel admin) */
  onlineSince?: Date | null;
}

export interface AdminAlert {
  title: string;
  description: string;
  icon: string;
  severity: 'success' | 'info' | 'warning' | 'danger';
}

/** Um número do topo, com o mesmo número no período anterior (mesma duração). */
export interface AdminKpi {
  value: number;
  previous: number;
}

export interface AdminStageSlice {
  id: OrderStage;
  label: string;
  value: number;
}

/**
 * Leitura do painel na ordem em que ele é lido: resumo do período, evolução
 * diária, etapas dos pedidos e quem mais vendeu. "Vendido" é sempre a soma
 * dos produtos de pedidos pagos, sem frete — a mesma base da aba Vendedores.
 */
export interface AdminHeadline {
  previousLabel: string;
  revenue: AdminKpi;
  orders: AdminKpi;
  averageTicket: AdminKpi;
  platformFee: AdminKpi;
  newUsers: AdminKpi;
  /** Taxa(s) aplicada(s) no período: "8%" ou "5% e 8%". */
  rateLabel: string;
  revenueSeries: AdminChartPoint[];
  ordersSeries: AdminChartPoint[];
  stages: AdminStageSlice[];
  topSellers: AdminNamedMetric[];
}

export interface AdminDashboardMetrics {
  updatedAt: Date;
  rangeLabel: string;
  headline: AdminHeadline;
  overview: {
    onlineUsers: number;
    /** Usuários com `status === 'online'` (presença Firebase), ordenados por nome */
    onlineUsersList: AdminNamedMetric[];
    totalUsers: number;
    newUsersToday: number;
    newUsersWeek: number;
    newUsersMonth: number;
    activeSellers: number;
    activeBuyers: number;
  };
  finance: {
    revenueToday: number;
    revenueWeek: number;
    revenueMonth: number;
    revenueTotal: number;
    averageTicket: number;
    totalOrders: number;
    platformCommissions: number;
    revenueSeries: AdminChartPoint[];
  };
  products: {
    totalProducts: number;
    addedToday: number;
    bestSellers: AdminNamedMetric[];
    lowPerformers: AdminNamedMetric[];
    outOfStock: AdminNamedMetric[];
  };
  sales: {
    salesToday: number;
    salesInPeriod: number;
    pendingOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    conversionRate: number;
    salesSeries: AdminChartPoint[];
    statusDistribution: AdminChartPoint[];
  };
  users: {
    activeNow: number;
    mostActive: AdminNamedMetric[];
    retentionRate: number;
    abandonmentRate: number;
    latestUsers: AdminNamedMetric[];
  };
  logistics: {
    shippingOrders: number;
    deliveredOrders: number;
    delayedOrders: number;
  };
  alerts: AdminAlert[];
  smartMetrics: AdminMetricItem[];
}

@Injectable({
  providedIn: 'root'
})
export class AdminAnalyticsService {
  private readonly db = getFirestore(getApps().length === 0 ? initializeApp(environment.firebase) : getApp());
  private readonly appConfig = inject(AppConfigService);
  /** Taxa em Ajustes; mudar lá recalcula o painel aberto. */
  private readonly commission$ = toObservable(this.appConfig.config);
  private commissionRate = 0.1;

  getDashboardMetrics(filters: AdminMetricsFilters): Observable<AdminDashboardMetrics> {
    return combineLatest([
      this.listenCollection<AppUser>('users'),
      this.listenCollection<Product>('products'),
      this.listenCollection<Order>('orders'),
      this.commission$
    ]).pipe(
      map(([users, products, orders, config]) => {
        this.commissionRate = rateAt(config.commission, new Date());
        return this.buildMetrics(users, products, orders, filters, config.commission);
      })
    );
  }

  /**
   * Resumo pré-calculado, lido de `metrics/summary`.
   *
   * Uma leitura de documento, em vez das três varreduras de coleção que
   * `getDashboardMetrics()` faz. O valor é recalculado de hora em hora pela
   * Cloud Function `aggregateDailyMetrics`; `refreshMetrics()` força na hora.
   *
   * `computedAt` diz de quando é o número — mostre no painel, para o número
   * defasado não parecer errado.
   */
  getSummaryMetrics(): Observable<AdminMetricsSummary | null> {
    return from(getDoc(doc(this.db, 'metrics', 'summary'))).pipe(
      map(snap => (snap.exists() ? (snap.data() as AdminMetricsSummary) : null)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /** Recalcula agora (botão "atualizar" do painel). Exige admin no servidor. */
  async refreshMetrics(): Promise<void> {
    const currentUser = getAuth().currentUser;
    if (!currentUser) throw new Error('Sessão expirada. Faça login novamente.');

    const token = await currentUser.getIdToken();
    const baseUrl = environment.functionsBaseUrl;

    const response = await fetch(`${baseUrl}/refreshMetricsNow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      throw new Error(data?.error || 'Não foi possível recalcular as métricas.');
    }
  }

  async resetAllData(): Promise<void> {
    const collections = [
      'users', 
      'products', 
      'orders', 
      'notifications', 
      'categories', 
      'banners', 
      'chats', 
      'messages',
      'withdrawals',
      'refunds',
      'stats',
      'address'
    ];

    for (const colName of collections) {
      try {
        const snap = await getDocs(collection(this.db, colName));
        const batch = writeBatch(this.db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        console.log(`Coleção ${colName} limpa.`);
      } catch (e) {
        console.warn(`Erro ao limpar ${colName}:`, e);
      }
    }
  }

  /** Streams compartilhados por colecao: sem isto, cada inscrito abre um listener. */
  private readonly collectionStreams = new Map<string, Observable<any[]>>();

  private listenCollection<T extends object>(collectionName: string): Observable<(T & { id?: string })[]> {
    const cached = this.collectionStreams.get(collectionName);
    if (cached) return cached as Observable<(T & { id?: string })[]>;

    const stream = new Observable<(T & { id?: string })[]>(subscriber => {
      const unsubscribe = onSnapshot(
        collection(this.db, collectionName),
        snapshot => {
          const items = snapshot.docs.map(documentSnapshot => ({
            id: documentSnapshot.id,
            ...documentSnapshot.data()
          } as T & { id?: string }));

          subscriber.next(items);
        },
        error => subscriber.error(error)
      );

      return () => unsubscribe();
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.collectionStreams.set(collectionName, stream);
    return stream;
  }

  private buildMetrics(
    users: (AppUser & { id?: string })[],
    products: (Product & { id?: string })[],
    orders: (Order & { id?: string })[],
    filters: AdminMetricsFilters,
    commission: CommissionConfig
  ): AdminDashboardMetrics {
    const now = new Date();
    const range = this.resolveRange(filters, now);
    const paidOrders = orders.filter(order => this.isPaidOrder(order.status));
    const validRevenueOrders = orders.filter(order => !this.isCancelledOrder(order.status));
    const periodOrders = orders.filter(order => this.isWithinRange(this.toDate(order.createdAt), range.start, range.end));
    const paidPeriodOrders = periodOrders.filter(order => this.isPaidOrder(order.status));
    const validPeriodOrders = periodOrders.filter(order => !this.isCancelledOrder(order.status));

    const todayStart = this.startOfDay(now);
    const weekStart = this.addDays(todayStart, -6);
    const monthStart = this.addDays(todayStart, -29);

    const revenueToday = this.sumOrders(validRevenueOrders.filter(order => this.isWithinRange(this.toDate(order.createdAt), todayStart, now)));
    const revenueWeek = this.sumOrders(validRevenueOrders.filter(order => this.isWithinRange(this.toDate(order.createdAt), weekStart, now)));
    const revenueMonth = this.sumOrders(validRevenueOrders.filter(order => this.isWithinRange(this.toDate(order.createdAt), monthStart, now)));
    const revenueTotal = this.sumOrders(validRevenueOrders);
    const periodRevenue = this.sumOrders(validPeriodOrders);

    const activeSellerIds = new Set<string>();
    products.forEach(product => {
      if (product.sellerId) activeSellerIds.add(product.sellerId);
    });

    const activeBuyerIds = new Set<string>();
    orders.forEach(order => activeBuyerIds.add(order.userId));

    const userActivity = this.buildUserActivity(users, orders);
    const onlineUsersList = this.mapOnlineUsersList(users);
    const onlineUsers = onlineUsersList.length;
    const activeUsers30d = users.filter(user => this.isRecentlyActive(user, now, 30)).length;
    const retentionRate = users.length > 0 ? Math.round((activeUsers30d / users.length) * 100) : 0;
    const abandonmentRate = users.length > 0 ? Math.max(0, 100 - retentionRate) : 0;

    const outOfStockProducts = products
      .filter(product => Number(product.stock || 0) <= 0)
      .sort((a, b) => this.getProductValue(b) - this.getProductValue(a))
      .slice(0, 5);

    const lowPerformers = products
      .filter(product => Number(product.soldCount || 0) === 0 && this.daysSince(product.createdAt, now) >= 14)
      .sort((a, b) => this.daysSince(b.createdAt, now) - this.daysSince(a.createdAt, now))
      .slice(0, 5);

    const bestSellers = [...products]
      .sort((a, b) => Number(b.soldCount || 0) - Number(a.soldCount || 0))
      .slice(0, 5);

    const completedOrders = periodOrders.filter(order => this.isPaidOrder(order.status)).length;
    const pendingOrders = periodOrders.filter(order => order.status === 'PENDING').length;
    const cancelledOrders = periodOrders.filter(order => this.isCancelledOrder(order.status)).length;

    const shippingOrders = orders.filter(order => order.status === 'CONFIRMED').length;
    const deliveredOrders = orders.filter(order => order.status === 'RECEIVED').length;
    const delayedOrders = orders.filter(order => {
      const createdAt = this.toDate(order.createdAt);
      return order.status === 'CONFIRMED' && createdAt !== null && this.daysBetween(createdAt, now) > 7;
    }).length;

    const conversionRate = this.estimateConversionRate(paidPeriodOrders.length, users.length);
    const averageTicket = paidOrders.length > 0 ? revenueTotal / paidOrders.length : 0;

    return {
      updatedAt: now,
      rangeLabel: range.label,
      headline: this.buildHeadline(users, orders, range, commission),
      overview: {
        onlineUsers,
        onlineUsersList,
        totalUsers: users.length,
        newUsersToday: this.countUsersCreatedSince(users, todayStart, now),
        newUsersWeek: this.countUsersCreatedSince(users, weekStart, now),
        newUsersMonth: this.countUsersCreatedSince(users, monthStart, now),
        activeSellers: activeSellerIds.size,
        activeBuyers: activeBuyerIds.size
      },
      finance: {
        revenueToday,
        revenueWeek,
        revenueMonth,
        revenueTotal,
        averageTicket,
        totalOrders: orders.length,
        platformCommissions: revenueTotal * this.commissionRate,
        revenueSeries: this.buildDailySeries(validPeriodOrders, range.start, range.end, 'revenue')
      },
      products: {
        totalProducts: products.length,
        addedToday: products.filter(product => this.isWithinRange(this.toDate(product.createdAt), todayStart, now)).length,
        bestSellers: bestSellers.map(product => this.mapProductMetric(product, 'vendidos')),
        lowPerformers: lowPerformers.map(product => this.mapProductMetric(product, 'dias sem venda')),
        outOfStock: outOfStockProducts.map(product => this.mapProductMetric(product, 'sem estoque'))
      },
      sales: {
        salesToday: paidOrders.filter(order => this.isWithinRange(this.toDate(order.createdAt), todayStart, now)).length,
        salesInPeriod: paidPeriodOrders.length,
        pendingOrders,
        completedOrders,
        cancelledOrders,
        conversionRate,
        salesSeries: this.buildDailySeries(paidPeriodOrders, range.start, range.end, 'count'),
        statusDistribution: [
          { label: 'Pendentes', value: pendingOrders },
          { label: 'Concluidos', value: completedOrders },
          { label: 'Cancelados', value: cancelledOrders }
        ]
      },
      users: {
        activeNow: onlineUsers,
        mostActive: userActivity.slice(0, 5),
        retentionRate,
        abandonmentRate,
        latestUsers: this.mapLatestUsers(users)
      },
      logistics: {
        shippingOrders,
        deliveredOrders,
        delayedOrders
      },
      alerts: this.buildAlerts({
        delayedOrders,
        outOfStock: outOfStockProducts.length,
        lowPerformers: lowPerformers.length,
        onlineUsers,
        usersCount: users.length,
        periodRevenue,
        cancelledOrders,
        pendingOrders
      }),
      smartMetrics: this.buildSmartMetrics(products, validPeriodOrders, paidPeriodOrders, activeSellerIds.size)
    };
  }

  private buildHeadline(
    users: (AppUser & { id?: string })[],
    orders: (Order & { id?: string })[],
    range: { start: Date; end: Date },
    commission: CommissionConfig
  ): AdminHeadline {
    const spanMs = range.end.getTime() - range.start.getTime();
    const prevEnd = new Date(range.start.getTime() - 1);
    const prevStart = new Date(range.start.getTime() - spanMs - 1);

    const paidAt = (order: Order) => this.toDate(order.paymentConfirmedAt) || this.toDate(order.createdAt);
    const paid = orders.filter(order => isPaid(order));
    const inRange = (list: Order[], start: Date, end: Date) => list.filter(order => this.isWithinRange(paidAt(order), start, end));
    const current = inRange(paid, range.start, range.end);
    const previous = inRange(paid, prevStart, prevEnd);

    const revenue = this.sumItems(current);
    const revenuePrev = this.sumItems(previous);
    // Cada venda paga a taxa em vigor no dia do pagamento.
    const feeOf = (list: Order[]) => list.reduce((sum, order) =>
      sum + feeFor(this.sumItems([order]), rateAt(commission, paidAt(order))), 0);
    const ratesUsed = new Set(current.map(order => rateAt(commission, paidAt(order))));
    const ticket = current.length ? revenue / current.length : 0;
    const ticketPrev = previous.length ? revenuePrev / previous.length : 0;

    // Etapas: todo pedido criado no período, pago ou não.
    const created = orders.filter(order => this.isWithinRange(this.toDate(order.createdAt), range.start, range.end));
    const stageOrder: { id: OrderStage; label: string }[] = [
      { id: 'pay', label: 'Aguardando pagamento' },
      { id: 'preparing', label: 'A enviar' },
      { id: 'shipping', label: 'A caminho' },
      { id: 'done', label: 'Entregues' },
      { id: 'refund', label: 'Devolução' },
      { id: 'cancelled', label: 'Cancelados' }
    ];
    const stageCount = new Map<OrderStage, number>();
    created.forEach(order => {
      const stage = orderStage(order);
      stageCount.set(stage, (stageCount.get(stage) || 0) + 1);
    });

    // Quem mais vendeu no período (mesma conta da aba Vendedores).
    const bySeller = new Map<string, { amount: number; units: number }>();
    current.forEach(order => (order.sellerIds || []).forEach(sellerId => {
      const entry = bySeller.get(sellerId) || { amount: 0, units: 0 };
      sellerItems(order, sellerId).forEach(item => {
        entry.amount += paidUnitPrice(item) * (item.quantity || 0);
        entry.units += item.quantity || 0;
      });
      bySeller.set(sellerId, entry);
    }));
    const userById = new Map(users.map(user => [user.uid || user.id || '', user]));
    const topSellers: AdminNamedMetric[] = [...bySeller.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 5)
      .map(([id, entry]) => {
        const user = userById.get(id);
        return {
          id,
          name: user?.shopName || user?.displayName || user?.email || 'Loja sem nome',
          helper: `${entry.units} ${entry.units === 1 ? 'item' : 'itens'}`,
          value: entry.units,
          amount: entry.amount,
          image: user?.photoURL || undefined
        };
      });

    return {
      previousLabel: this.previousLabel(range),
      revenue: { value: revenue, previous: revenuePrev },
      orders: { value: current.length, previous: previous.length },
      averageTicket: { value: ticket, previous: ticketPrev },
      platformFee: { value: feeOf(current), previous: feeOf(previous) },
      newUsers: {
        value: this.countUsersCreatedSince(users, range.start, range.end),
        previous: this.countUsersCreatedSince(users, prevStart, prevEnd)
      },
      rateLabel: describeRates(ratesUsed) || formatRate(rateAt(commission, range.end)),
      revenueSeries: this.buildPaidSeries(current, range.start, range.end, paidAt, 'revenue'),
      ordersSeries: this.buildPaidSeries(current, range.start, range.end, paidAt, 'count'),
      stages: stageOrder.map(stage => ({ ...stage, value: stageCount.get(stage.id) || 0 })),
      topSellers
    };
  }

  /** Série diária (em blocos quando passa de 31 dias) pela data do pagamento. */
  private buildPaidSeries(
    orders: Order[],
    start: Date,
    end: Date,
    dateOf: (order: Order) => Date | null,
    mode: 'revenue' | 'count'
  ): AdminChartPoint[] {
    const totalDays = Math.max(1, this.daysBetween(start, end) + 1);
    const bucketSize = Math.ceil(totalDays / 31);
    const buckets: AdminChartPoint[] = [];
    for (let day = 0; day < totalDays; day += bucketSize) {
      const bucketStart = this.startOfDay(this.addDays(start, day));
      const bucketEnd = this.endOfDay(this.addDays(bucketStart, bucketSize - 1));
      const inBucket = orders.filter(order => this.isWithinRange(dateOf(order), bucketStart, bucketEnd));
      buckets.push({
        label: this.formatShortDate(bucketStart),
        value: mode === 'revenue' ? this.sumItems(inBucket) : inBucket.length
      });
    }
    return buckets;
  }

  private previousLabel(range: { start: Date; end: Date }): string {
    const days = Math.max(1, this.daysBetween(range.start, range.end) + 1);
    return days === 1 ? 'ontem' : `${days} dias anteriores`;
  }

  /** Produtos de pedidos pagos, sem frete. */
  private sumItems(orders: Order[]): number {
    return orders.reduce((sum, order) =>
      sum + (order.items || []).reduce((acc, item) => acc + paidUnitPrice(item) * (item.quantity || 0), 0), 0);
  }

  private resolveRange(filters: AdminMetricsFilters, now: Date): { start: Date; end: Date; label: string } {
    if (filters.period === 'custom' && filters.startDate && filters.endDate) {
      const start = this.startOfDay(new Date(filters.startDate));
      const end = this.endOfDay(new Date(filters.endDate));
      return { start, end, label: `${this.formatShortDate(start)} - ${this.formatShortDate(end)}` };
    }

    if (filters.period === 'today') {
      return { start: this.startOfDay(now), end: now, label: 'Hoje' };
    }

    if (filters.period === '30d') {
      const start = this.addDays(this.startOfDay(now), -29);
      return { start, end: now, label: 'Últimos 30 dias' };
    }

    const start = this.addDays(this.startOfDay(now), -6);
    return { start, end: now, label: 'Últimos 7 dias' };
  }

  private buildDailySeries(
    orders: Order[],
    start: Date,
    end: Date,
    mode: 'revenue' | 'count'
  ): AdminChartPoint[] {
    const totalDays = Math.max(1, this.daysBetween(start, end) + 1);
    const bucketCount = Math.min(totalDays, 14);
    const bucketSize = Math.ceil(totalDays / bucketCount);
    const buckets: AdminChartPoint[] = [];

    for (let index = 0; index < bucketCount; index += 1) {
      const bucketStart = this.addDays(start, index * bucketSize);
      const bucketEnd = index === bucketCount - 1 ? end : this.endOfDay(this.addDays(bucketStart, bucketSize - 1));
      const ordersInBucket = orders.filter(order => this.isWithinRange(this.toDate(order.createdAt), bucketStart, bucketEnd));
      const value = mode === 'revenue' ? this.sumOrders(ordersInBucket) : ordersInBucket.length;
      buckets.push({ label: this.formatShortDate(bucketStart), value });
    }

    return buckets;
  }

  private buildUserActivity(users: (AppUser & { id?: string })[], orders: Order[]): AdminNamedMetric[] {
    const ordersByUser = new Map<string, { count: number; amount: number }>();

    orders.forEach(order => {
      const current = ordersByUser.get(order.userId) || { count: 0, amount: 0 };
      ordersByUser.set(order.userId, {
        count: current.count + 1,
        amount: current.amount + Number(order.total || 0)
      });
    });

    return users
      .map(user => {
        const activity = ordersByUser.get(user.uid) || { count: 0, amount: 0 };
        return {
          id: user.uid,
          name: user.displayName || user.email || 'Usuario sem nome',
          helper: `${activity.count} pedidos`,
          value: activity.count,
          amount: activity.amount,
          image: user.photoURL || undefined,
          status: user.status || 'offline'
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  private mapOnlineUsersList(users: (AppUser & { id?: string })[]): AdminNamedMetric[] {
    return users
      .filter(user => user.status === 'online')
      .map(user => {
        const onlineSince = this.toDate(user.onlineSince);
        return {
          id: user.uid || user.id || '',
          name: user.displayName || user.username || user.email || 'Usuário sem nome',
          helper: user.email || user.phoneNumber || 'Sem contato',
          value: 1,
          image: user.photoURL || undefined,
          status: 'online',
          onlineSince
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  private mapLatestUsers(users: (AppUser & { id?: string })[]): AdminNamedMetric[] {
    return [...users]
      .sort((a, b) => {
        const dateA = this.toDate(a.createdAt) || this.toDate(a.lastLoginAt) || new Date(0);
        const dateB = this.toDate(b.createdAt) || this.toDate(b.lastLoginAt) || new Date(0);
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, 5)
      .map(user => ({
        id: user.uid || user.id || '',
        name: user.displayName || user.email || 'Usuario sem nome',
        helper: user.email || 'Sem e-mail',
        value: 1,
        image: user.photoURL || undefined,
        status: user.status || 'offline'
      }));
  }

  private mapProductMetric(product: Product & { id?: string }, helper: string): AdminNamedMetric {
    const soldCount = Number(product.soldCount || 0);
    const value = helper === 'dias sem venda' ? this.daysSince(product.createdAt, new Date()) : soldCount;

    return {
      id: product.id || product.name,
      name: product.name,
      helper,
      value,
      amount: this.getProductValue(product),
      image: Array.isArray(product.photoURL) ? product.photoURL[0] : undefined,
      status: Number(product.stock || 0) <= 0 ? 'Esgotado' : `${product.stock} em estoque`
    };
  }

  private buildAlerts(input: {
    delayedOrders: number;
    outOfStock: number;
    lowPerformers: number;
    onlineUsers: number;
    usersCount: number;
    periodRevenue: number;
    cancelledOrders: number;
    pendingOrders: number;
  }): AdminAlert[] {
    const alerts: AdminAlert[] = [];

    if (input.periodRevenue === 0) {
      alerts.push({
        title: 'Nenhuma venda no período',
        description: 'Nada foi vendido no período escolhido. Vale conferir o checkout, as campanhas e o estoque.',
        icon: 'trending-down-outline',
        severity: 'danger'
      });
    }

    if (input.outOfStock > 0) {
      alerts.push({
        title: 'Produtos sem estoque',
        description: `${input.outOfStock} anúncio(s) sem estoque: repor ou pausar.`,
        icon: 'cube-outline',
        severity: 'warning'
      });
    }

    if (input.delayedOrders > 0) {
      alerts.push({
        title: 'Pedidos atrasados',
        description: `${input.delayedOrders} pedido(s) pago(s) há mais de 7 dias sem entrega.`,
        icon: 'alert-circle-outline',
        severity: 'danger'
      });
    }

    if (input.cancelledOrders > input.pendingOrders && input.cancelledOrders > 0) {
      alerts.push({
        title: 'Cancelamentos acima do normal',
        description: 'Houve mais cancelamentos do que pedidos aguardando pagamento no período.',
        icon: 'close-circle-outline',
        severity: 'warning'
      });
    }

    if (input.onlineUsers > Math.max(10, input.usersCount * 0.35)) {
      alerts.push({
        title: 'Pico de acessos',
        description: 'Muita gente online agora. Bom momento para uma oferta relâmpago.',
        icon: 'flash-outline',
        severity: 'info'
      });
    }

    if (input.lowPerformers > 0) {
      alerts.push({
        title: 'Anúncios parados',
        description: `${input.lowPerformers} anúncio(s) publicados há mais de 14 dias sem venda.`,
        icon: 'analytics-outline',
        severity: 'info'
      });
    }

    if (alerts.length === 0) {
      alerts.push({
        title: 'Tudo em ordem',
        description: 'Nenhum ponto crítico com os dados de agora.',
        icon: 'shield-checkmark-outline',
        severity: 'success'
      });
    }

    return alerts.slice(0, 5);
  }

  private buildSmartMetrics(
    products: Product[],
    validPeriodOrders: Order[],
    paidPeriodOrders: Order[],
    activeSellers: number
  ): AdminMetricItem[] {
    const revenue = this.sumOrders(validPeriodOrders);
    const unitsSold = paidPeriodOrders.reduce((total, order) => {
      const orderUnits = order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      return total + orderUnits;
    }, 0);
    const stockUnits = products.reduce((total, product) => total + Number(product.stock || 0), 0);
    const revenuePerSeller = activeSellers > 0 ? revenue / activeSellers : 0;
    const inventoryTurnover = stockUnits > 0 ? (unitsSold / stockUnits) * 100 : 0;
    const takeRate = revenue > 0 ? this.commissionRate * 100 : 0;

    return [
      {
        label: 'GMV por vendedor',
        value: this.formatCurrency(revenuePerSeller),
        helper: 'Receita media gerada por vendedor ativo',
        icon: 'storefront-outline',
        tone: 'success'
      },
      {
        label: 'Take rate',
        value: `${takeRate.toFixed(1)}%`,
        helper: 'Percentual de comissao usado na plataforma',
        icon: 'pie-chart-outline',
        tone: 'info'
      },
      {
        label: 'Giro de estoque',
        value: `${inventoryTurnover.toFixed(1)}%`,
        helper: 'Unidades vendidas versus estoque disponivel',
        icon: 'repeat-outline',
        tone: inventoryTurnover < 5 ? 'warning' : 'success'
      }
    ];
  }

  private estimateConversionRate(paidOrders: number, usersCount: number): number {
    if (usersCount === 0) return 0;
    const estimatedVisits = Math.max(usersCount * 3, paidOrders);
    return Number(((paidOrders / estimatedVisits) * 100).toFixed(1));
  }

  private countUsersCreatedSince(users: AppUser[], start: Date, end: Date): number {
    return users.filter(user => {
      const createdAt = this.toDate(user.createdAt) || this.toDate(user.lastLoginAt);
      return this.isWithinRange(createdAt, start, end);
    }).length;
  }

  private isRecentlyActive(user: AppUser, now: Date, days: number): boolean {
    const activityDate = this.toDate(user.lastActive) || this.toDate(user.lastLoginAt) || this.toDate(user.createdAt);
    if (activityDate === null) return user.status === 'online';
    return this.daysBetween(activityDate, now) <= days;
  }

  private isPaidOrder(status: OrderStatus): boolean {
    return isPaid({ status } as Order);
  }

  private isCancelledOrder(status: OrderStatus): boolean {
    return status === 'CANCELLED' || status === 'REFUNDED';
  }

  private sumOrders(orders: Order[]): number {
    return orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  }

  private getProductValue(product: Product): number {
    return Number(product.priceDiscounted || product.price || 0);
  }

  private daysSince(value: unknown, now: Date): number {
    const date = this.toDate(value);
    if (date === null) return 0;
    return this.daysBetween(date, now);
  }

  private daysBetween(start: Date, end: Date): number {
    const milliseconds = this.startOfDay(end).getTime() - this.startOfDay(start).getTime();
    return Math.max(0, Math.floor(milliseconds / 86400000));
  }

  private isWithinRange(date: Date | null, start: Date, end: Date): boolean {
    if (date === null) return false;
    return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
  }

  private toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
      return value.toDate() as Date;
    }
    if (typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') {
      return new Date(value.seconds * 1000);
    }
    return null;
  }

  private startOfDay(date: Date): Date {
    const clone = new Date(date);
    clone.setHours(0, 0, 0, 0);
    return clone;
  }

  private endOfDay(date: Date): Date {
    const clone = new Date(date);
    clone.setHours(23, 59, 59, 999);
    return clone;
  }

  private addDays(date: Date, days: number): Date {
    const clone = new Date(date);
    clone.setDate(clone.getDate() + days);
    return clone;
  }

  private formatShortDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }
}
