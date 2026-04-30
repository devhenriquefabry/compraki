import { Injectable } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { collection, getFirestore, onSnapshot } from 'firebase/firestore';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { environment } from 'src/environments/environment';
import { AppUser } from '../interfaces/app-user';
import { Order, OrderStatus } from '../interfaces/order';
import { Product } from '../interfaces/product';

export type AdminMetricsPeriod = 'today' | '7d' | '30d' | 'custom';

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
}

export interface AdminAlert {
  title: string;
  description: string;
  icon: string;
  severity: 'success' | 'info' | 'warning' | 'danger';
}

export interface AdminDashboardMetrics {
  updatedAt: Date;
  rangeLabel: string;
  overview: {
    onlineUsers: number;
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
  private readonly commissionRate = 0.1;

  getDashboardMetrics(filters: AdminMetricsFilters): Observable<AdminDashboardMetrics> {
    return combineLatest([
      this.listenCollection<AppUser>('users'),
      this.listenCollection<Product>('products'),
      this.listenCollection<Order>('orders')
    ]).pipe(
      map(([users, products, orders]) => this.buildMetrics(users, products, orders, filters))
    );
  }

  private listenCollection<T extends object>(collectionName: string): Observable<(T & { id?: string })[]> {
    return new Observable<(T & { id?: string })[]>(subscriber => {
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
    });
  }

  private buildMetrics(
    users: (AppUser & { id?: string })[],
    products: (Product & { id?: string })[],
    orders: (Order & { id?: string })[],
    filters: AdminMetricsFilters
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
    const onlineUsers = users.filter(user => user.status === 'online').length;
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
      overview: {
        onlineUsers,
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
      return { start, end: now, label: 'Ultimos 30 dias' };
    }

    const start = this.addDays(this.startOfDay(now), -6);
    return { start, end: now, label: 'Ultimos 7 dias' };
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
        title: 'Receita parada no periodo',
        description: 'Nenhum faturamento foi registrado no filtro atual. Verifique campanhas, checkout e disponibilidade de produtos.',
        icon: 'trending-down-outline',
        severity: 'danger'
      });
    }

    if (input.outOfStock > 0) {
      alerts.push({
        title: 'Produtos sem estoque',
        description: `${input.outOfStock} produtos prioritarios precisam de reposicao ou pausa de anuncio.`,
        icon: 'cube-outline',
        severity: 'warning'
      });
    }

    if (input.delayedOrders > 0) {
      alerts.push({
        title: 'Pedidos possivelmente atrasados',
        description: `${input.delayedOrders} pedidos confirmados estao ha mais de 7 dias sem baixa de entrega.`,
        icon: 'alert-circle-outline',
        severity: 'danger'
      });
    }

    if (input.cancelledOrders > input.pendingOrders && input.cancelledOrders > 0) {
      alerts.push({
        title: 'Cancelamentos acima do normal',
        description: 'O volume de cancelamentos superou os pedidos pendentes no periodo selecionado.',
        icon: 'close-circle-outline',
        severity: 'warning'
      });
    }

    if (input.onlineUsers > Math.max(10, input.usersCount * 0.35)) {
      alerts.push({
        title: 'Pico de acessos',
        description: 'Ha um volume alto de usuarios online. Bom momento para campanhas e ofertas relampago.',
        icon: 'flash-outline',
        severity: 'info'
      });
    }

    if (input.lowPerformers > 0) {
      alerts.push({
        title: 'Produtos com baixo desempenho',
        description: `${input.lowPerformers} produtos estao publicados ha mais de 14 dias sem venda.`,
        icon: 'analytics-outline',
        severity: 'info'
      });
    }

    if (alerts.length === 0) {
      alerts.push({
        title: 'Operacao saudavel',
        description: 'Nenhum alerta critico identificado com os dados atuais da plataforma.',
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
    return status === 'RECEIVED' || status === 'CONFIRMED';
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
