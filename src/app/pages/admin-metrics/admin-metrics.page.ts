import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import {
  AdminAnalyticsService,
  AdminDashboardMetrics,
  AdminKpi,
  AdminMetricsFilters,
  AdminMetricsPeriod,
  AdminNamedMetric,
  AdminStageSlice
} from '../../services/admin-analytics.service';
import { AdminPanelHeroComponent } from '../../components/admin-panel-hero/admin-panel-hero.component';
import { AdminChartComponent } from '../../components/admin-chart/admin-chart.component';

export interface KpiDelta {
  text: string;
  tone: 'up' | 'down' | 'flat';
  /** Leitura completa para leitor de tela. */
  aria: string;
}

/**
 * Cores das etapas: rampa ordinal de um azul só (pagamento → entregue),
 * validada com o script do guia de dataviz; devolução e cancelado usam as
 * cores de status reservadas, sempre com rótulo ao lado.
 */
const STAGE_COLOR: Record<string, string> = {
  pay: '#A3B1C3',
  preparing: '#6B7F99',
  shipping: '#34496A',
  done: '#0B1623',
  refund: '#D97706',
  cancelled: '#DC2626'
};

@Component({
  selector: 'app-admin-metrics',
  templateUrl: './admin-metrics.page.html',
  styleUrls: ['./admin-metrics.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AdminPanelHeroComponent, AdminChartComponent]
})
export class AdminMetricsPage implements OnInit, OnDestroy {
  public metrics?: AdminDashboardMetrics;
  public isLoading = true;
  /** Troca de período: o painel anterior fica esmaecido, sem piscar esqueleto. */
  public isRefreshing = false;
  public errorMessage = '';
  public filters: AdminMetricsFilters = {
    period: '7d',
    startDate: this.toInputDate(this.addDays(new Date(), -6)),
    endDate: this.toInputDate(new Date())
  };
  public readonly periodOptions: { label: string; value: AdminMetricsPeriod }[] = [
    { label: 'Hoje', value: 'today' },
    { label: '7 dias', value: '7d' },
    { label: '30 dias', value: '30d' },
    { label: 'Personalizado', value: 'custom' }
  ];
  public readonly stageColor = STAGE_COLOR;

  private metricsSub?: Subscription;
  private onlineTick?: ReturnType<typeof setInterval>;
  private tick = 0;

  constructor(
    private analyticsService: AdminAnalyticsService,
    private alertController: AlertController,
    private toastController: ToastController,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadMetrics();
    // Atualiza o "online há X" a cada 30 s.
    this.onlineTick = setInterval(() => this.tick++, 30000);
  }

  ngOnDestroy(): void {
    this.metricsSub?.unsubscribe();
    if (this.onlineTick) clearInterval(this.onlineTick);
  }

  // ------------------------------------------------------------ filtros

  public setPeriod(period: string): void {
    this.filters = { ...this.filters, period: period as AdminMetricsPeriod };
    this.loadMetrics();
  }

  public onCustomDateChange(): void {
    if (this.filters.period === 'custom') this.loadMetrics();
  }

  public refresh(): void {
    this.loadMetrics();
  }

  // ------------------------------------------------------------ leitura

  /** Variação contra o período anterior de mesma duração. */
  public delta(kpi: AdminKpi, previousLabel: string): KpiDelta {
    if (kpi.previous === 0) {
      if (kpi.value === 0) return { text: 'sem variação', tone: 'flat', aria: 'sem variação' };
      return { text: 'novo', tone: 'up', aria: `sem movimento nos ${previousLabel}` };
    }
    const pct = ((kpi.value - kpi.previous) / kpi.previous) * 100;
    const rounded = Math.abs(pct) < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
    if (rounded === 0) return { text: '0%', tone: 'flat', aria: `igual aos ${previousLabel}` };
    const text = `${rounded > 0 ? '+' : '−'}${String(Math.abs(rounded)).replace('.', ',')}%`;
    return {
      text,
      tone: rounded > 0 ? 'up' : 'down',
      aria: `${rounded > 0 ? 'alta' : 'queda'} de ${Math.abs(rounded)}% sobre os ${previousLabel}`
    };
  }

  public stageTotal(stages: AdminStageSlice[]): number {
    return stages.reduce((sum, stage) => sum + stage.value, 0);
  }

  public stagePercent(stage: AdminStageSlice, stages: AdminStageSlice[]): number {
    const total = this.stageTotal(stages);
    return total ? (stage.value / total) * 100 : 0;
  }

  public sellerShare(seller: AdminNamedMetric, sellers: AdminNamedMetric[]): number {
    const max = Math.max(...sellers.map(s => s.amount || 0), 0);
    return max ? Math.max(3, ((seller.amount || 0) / max) * 100) : 0;
  }

  public initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
  }

  public onlineFor(user: AdminNamedMetric): string {
    void this.tick;
    const since = user.onlineSince;
    if (!since || !(since instanceof Date) || Number.isNaN(since.getTime())) return 'online agora';
    const min = Math.floor((Date.now() - since.getTime()) / 60000);
    if (min < 1) return 'online há instantes';
    if (min < 60) return `online há ${min} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `online há ${h} h` : `online há ${Math.floor(h / 24)} d`;
  }

  public trackById(_: number, item: { id?: string; label?: string; title?: string }): string {
    return item.id || item.label || item.title || '';
  }

  // ------------------------------------------------------------ navegação

  public openUsersManagement(userId?: string): void {
    void this.router.navigate(['/admin/users'], { queryParams: userId ? { user: userId } : undefined });
  }

  public openSellers(): void {
    void this.router.navigate(['/admin/sellers']);
  }

  public openOrders(): void {
    void this.router.navigate(['/admin/orders']);
  }

  // ------------------------------------------------------------ zona de perigo

  public async confirmResetDatabase(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Apagar todos os dados?',
      subHeader: 'Usuários, produtos, pedidos e mensagens',
      message: 'Tudo é excluído para sempre e não há como desfazer.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Continuar', role: 'destructive', handler: () => this.executeDatabaseReset() }
      ]
    });
    await alert.present();
  }

  private async executeDatabaseReset(): Promise<void> {
    const secondAlert = await this.alertController.create({
      header: 'Confirmação final',
      message: 'Digite RESETAR para apagar todos os dados.',
      inputs: [{ name: 'confirmText', type: 'text', placeholder: 'RESETAR' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Apagar tudo',
          role: 'destructive',
          handler: (data) => {
            if (data.confirmText === 'RESETAR') {
              this.performReset();
            } else {
              this.showToast('Texto diferente de RESETAR. Nada foi apagado.');
            }
          }
        }
      ]
    });
    await secondAlert.present();
  }

  private async performReset(): Promise<void> {
    this.isLoading = true;
    try {
      await this.analyticsService.resetAllData();
      this.showToast('Base de dados apagada.');
      this.refresh();
    } catch (e) {
      console.error(e);
      this.showToast('Não deu para apagar os dados. Tente de novo.');
    } finally {
      this.isLoading = false;
    }
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 3000, position: 'bottom', color: 'dark' });
    await toast.present();
  }

  private loadMetrics(): void {
    this.metricsSub?.unsubscribe();
    this.errorMessage = '';
    if (this.metrics) this.isRefreshing = true;
    else this.isLoading = true;

    this.metricsSub = this.analyticsService.getDashboardMetrics(this.filters).subscribe({
      next: metrics => {
        this.metrics = metrics;
        this.isLoading = false;
        this.isRefreshing = false;
      },
      error: error => {
        console.error('Erro ao carregar métricas administrativas:', error);
        this.errorMessage = 'Não deu para carregar as métricas. Confira a conexão e tente de novo.';
        this.isLoading = false;
        this.isRefreshing = false;
      }
    });
  }

  private addDays(date: Date, days: number): Date {
    const clone = new Date(date);
    clone.setDate(clone.getDate() + days);
    return clone;
  }

  private toInputDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
