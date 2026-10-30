import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { IonicModule, NavController, ToastController } from '@ionic/angular';

import { AdminChartComponent, ChartPoint } from '../../components/admin-chart/admin-chart.component';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { onAuthUserChanged } from '../../core/auth-state';
import { formatRate } from '../../core/commission';
import { formatBRL } from '../../core/order-stage';
import {
  DASH_PERIODS, DashKpi, DashPeriod, byPlace, byWeekday, delta, listingHealth, monthlyReport, periodRange,
  saleFacts, salesCsv, series, storeNow, summarize, topProducts,
} from '../../core/seller-metrics';
import { Order } from '../../interfaces/order';
import { Product } from '../../interfaces/product';
import { ProductQuestion } from '../../interfaces/question';
import { ProductReview } from '../../interfaces/review';
import { AppConfigService } from '../../services/app-config.service';
import { FirebaseProducts } from '../../services/firebase-products';
import { ProductQuestionsService } from '../../services/product-questions.service';
import { ProductReviewsService } from '../../services/product-reviews.service';
import { SalesService } from '../../services/sales.service';

type ChartMetric = 'revenue' | 'orders';
type RankBy = 'revenue' | 'units';

const PERIOD_KEY = 'vn_seller_dash_period';

/**
 * Painel da loja: quanto vendeu, o que mais sai, quando e para onde, a fila
 * de hoje, a saúde dos anúncios, a reputação e o fechamento mês a mês.
 *
 * Tudo sai das leituras que as outras telas da loja já fazem (vendas,
 * anúncios, avaliações e perguntas) — sem agregado no servidor. As contas
 * ficam em `core/seller-metrics.ts`, na mesma base de Recebimentos e Minha
 * conta. Leitura que falha mostra aviso, nunca zero.
 */
@Component({
  selector: 'app-seller-dashboard',
  templateUrl: './seller-dashboard.page.html',
  styleUrls: ['./seller-dashboard.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, AdminChartComponent, VnIconComponent],
})
export class SellerDashboardPage {
  private readonly sales = inject(SalesService);
  private readonly productsService = inject(FirebaseProducts);
  private readonly reviewsService = inject(ProductReviewsService);
  private readonly questionsService = inject(ProductQuestionsService);
  private readonly appConfig = inject(AppConfigService);
  private readonly navCtrl = inject(NavController);
  private readonly toastCtrl = inject(ToastController);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly periods = DASH_PERIODS;

  readonly uid = signal<string | null>(null);
  readonly orders = signal<Order[] | null>(null);
  readonly products = signal<Product[] | null>(null);
  readonly reviews = signal<ProductReview[] | null>(null);
  readonly questions = signal<ProductQuestion[] | null>(null);
  readonly salesError = signal(false);
  readonly productsError = signal(false);
  readonly reviewsError = signal(false);

  readonly period = signal<DashPeriod>(this.initialPeriod());
  readonly chartMetric = signal<ChartMetric>('revenue');
  readonly rankBy = signal<RankBy>('revenue');

  readonly loading = computed(() => this.orders() === null && !this.salesError());

  readonly range = computed(() => periodRange(this.period()));
  readonly periodLabel = computed(() => this.range().label);

  readonly facts = computed(() => {
    const uid = this.uid();
    const orders = this.orders();
    if (!uid || !orders) return [];
    return saleFacts(orders, uid, this.appConfig.config().commission);
  });

  readonly summary = computed(() => summarize(this.facts(), this.range()));

  readonly hasAnySale = computed(() => this.facts().some(f => f.counts));

  readonly chartPoints = computed<ChartPoint[]>(() => {
    const metric = this.chartMetric();
    return series(this.facts(), this.range()).map(p => ({ label: p.label, value: metric === 'revenue' ? p.revenue : p.orders }));
  });

  readonly bestBucket = computed(() => {
    const points = this.chartPoints();
    const best = points.reduce<ChartPoint | null>((top, p) => (p.value > (top?.value ?? 0) ? p : top), null);
    return best;
  });

  readonly ranking = computed(() => {
    const by = this.rankBy();
    const list = topProducts(this.facts(), this.range())
      .sort((a, b) => (by === 'revenue' ? b.revenue - a.revenue || b.units - a.units : b.units - a.units || b.revenue - a.revenue))
      .slice(0, 5);
    const max = Math.max(0, ...list.map(p => (by === 'revenue' ? p.revenue : p.units)));
    const total = by === 'revenue' ? this.summary().revenue.value : this.summary().units.value;
    return list.map(p => {
      const value = by === 'revenue' ? p.revenue : p.units;
      return { ...p, bar: max ? Math.max(4, (value / max) * 100) : 0, share: total ? Math.round((value / total) * 100) : 0 };
    });
  });

  readonly weekdays = computed(() => byWeekday(this.facts(), this.range()));
  readonly weekdayPoints = computed<ChartPoint[]>(() => this.weekdays().map(d => ({ label: d.label, value: d.value })));
  readonly bestWeekday = computed(() => {
    const days = this.weekdays();
    const max = Math.max(0, ...days.map(d => d.value));
    const top = days.filter(d => d.value === max);
    // Empate entre 3+ dias não é "o melhor dia": não destaca nenhum.
    return max > 0 && top.length <= 2 ? top : null;
  });

  readonly places = computed(() => {
    const { states, cities } = byPlace(this.facts(), this.range());
    const total = states.reduce((sum, s) => sum + s.orders, 0);
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    return {
      total,
      states: states.slice(0, 5).map(s => ({ ...s, pct: pct(s.orders) })),
      cities: cities.slice(0, 3),
    };
  });

  readonly now = computed(() => {
    const uid = this.uid();
    const orders = this.orders();
    return uid && orders ? storeNow(orders, uid) : null;
  });

  readonly listings = computed(() => {
    const products = this.products();
    return products ? listingHealth(products) : null;
  });

  readonly reputation = computed(() => {
    const reviews = this.reviews();
    if (!reviews) return null;
    const count = reviews.length;
    const stars = [5, 4, 3, 2, 1].map(star => {
      const n = reviews.filter(r => Math.round(r.rating) === star).length;
      return { star, n, pct: count ? (n / count) * 100 : 0 };
    });
    const avg = count ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / count : 0;
    const unanswered = reviews.filter(r => !r.sellerReply?.text).length;
    return { count, avg, stars, unanswered };
  });

  readonly openQuestions = computed(() => (this.questions() ?? []).filter(q => q.status === 'open').length);

  readonly report = computed(() => monthlyReport(this.facts(), 6));
  readonly reportTotals = computed(() => {
    const rows = this.report();
    const sum = (key: 'orders' | 'revenue' | 'fee' | 'shipping' | 'net') => rows.reduce((acc, r) => acc + r[key], 0);
    return { orders: sum('orders'), revenue: sum('revenue'), fee: sum('fee'), shipping: sum('shipping'), net: sum('net') };
  });

  readonly currentRate = computed(() => formatRate(this.appConfig.config().commission.rate));

  constructor() {
    let stop: (() => void) | undefined;
    const stopAuth = onAuthUserChanged(user => {
      stop?.();
      this.uid.set(user?.uid ?? null);
      if (!user) return;
      const subs = [
        this.sales.getSellerSales(user.uid).subscribe({
          next: orders => { this.orders.set(orders); this.salesError.set(false); },
          error: err => { console.error('[painel] vendas', err); this.salesError.set(true); },
        }),
        this.productsService.getBySeller(user.uid, true).subscribe({
          next: products => { this.products.set(products); this.productsError.set(false); },
          error: err => { console.error('[painel] anúncios', err); this.productsError.set(true); },
        }),
        this.reviewsService.watchStore(user.uid).subscribe({
          next: reviews => this.reviews.set(reviews),
          error: err => { console.error('[painel] avaliações', err); this.reviewsError.set(true); },
        }),
        this.questionsService.watchStore(user.uid).subscribe({
          next: questions => this.questions.set(questions),
          error: err => console.error('[painel] perguntas', err),
        }),
      ];
      stop = () => subs.forEach(s => s.unsubscribe());
    });
    this.destroyRef.onDestroy(() => {
      stopAuth();
      stop?.();
    });
  }

  // ------------------------------------------------------------ filtros

  setPeriod(period: DashPeriod) {
    this.period.set(period);
    try { localStorage.setItem(PERIOD_KEY, period); } catch { /* sem armazenamento: só não lembra */ }
    void this.router.navigate([], { queryParams: { periodo: period }, replaceUrl: true, queryParamsHandling: 'merge' });
  }

  private initialPeriod(): DashPeriod {
    const valid = (p: string | null): p is DashPeriod => !!p && DASH_PERIODS.some(x => x.id === p);
    const fromUrl = this.route.snapshot.queryParamMap.get('periodo');
    if (valid(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem(PERIOD_KEY);
      if (valid(saved)) return saved;
    } catch { /* ignora */ }
    return '30d';
  }

  // ------------------------------------------------------------ leitura

  deltaOf(kpi: DashKpi) {
    return delta(kpi, this.range().previousLabel);
  }

  brl(value: number): string {
    return formatBRL(value || 0);
  }

  /** "R$ 1,2 mil" para caber nos números de destaque do celular. */
  brlShort(value: number): string {
    if (Math.abs(value) >= 100_000) {
      return `R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 1000)} mil`;
    }
    return formatBRL(value || 0);
  }

  int(value: number): string {
    return new Intl.NumberFormat('pt-BR').format(value || 0);
  }

  pct(value: number): string {
    return `${String(Math.round(value * 1000) / 10).replace('.', ',')}%`;
  }

  rating(value: number): string {
    return value.toFixed(1).replace('.', ',');
  }

  plural(n: number, one: string, many: string): string {
    return `${this.int(n)} ${n === 1 ? one : many}`;
  }

  // ------------------------------------------------------------ ações

  async downloadCsv() {
    const csv = salesCsv(this.facts(), this.range());
    const lines = csv.split('\r\n').length - 1;
    if (!lines) {
      await this.toast('Nenhuma venda paga neste período para exportar.');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const name = `vineon-vendas-${this.period()}-${today}.csv`;
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await this.toast(`Planilha baixada: ${this.plural(lines, 'linha', 'linhas')}.`);
    } catch (err) {
      console.error('[painel] csv', err);
      await this.toast('Não deu para gerar a planilha agora. Tente de novo.');
    }
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }

  private async toast(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, position: 'bottom', color: 'dark' });
    await toast.present();
  }
}
