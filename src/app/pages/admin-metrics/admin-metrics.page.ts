import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import {
  AdminAnalyticsService,
  AdminChartPoint,
  AdminDashboardMetrics,
  AdminMetricsFilters,
  AdminMetricsPeriod,
  AdminNamedMetric
} from '../../services/admin-analytics.service';
import { AdminPanelHeroComponent } from '../../components/admin-panel-hero/admin-panel-hero.component';

@Component({
  selector: 'app-admin-metrics',
  templateUrl: './admin-metrics.page.html',
  styleUrls: ['./admin-metrics.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AdminPanelHeroComponent]
})
export class AdminMetricsPage implements OnInit, OnDestroy {
  public metrics?: AdminDashboardMetrics;
  /** Painel de lista ao passar o mouse no card “Usuários online” */
  public onlineUsersPanelOpen = false;
  public isLoading = true;
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

  private metricsSub?: Subscription;
  /** Atualiza textos “online há …” enquanto o painel estiver aberto */
  private onlinePanelInterval?: ReturnType<typeof setInterval>;
  private onlineDurationTick = 0;

  constructor(private analyticsService: AdminAnalyticsService) {}

  ngOnInit(): void {
    this.loadMetrics();
  }

  ngOnDestroy(): void {
    this.metricsSub?.unsubscribe();
    this.clearOnlinePanelInterval();
  }

  /** Abre/fecha painel de usuários online e agenda atualização do relativo “há X tempo” */
  public setOnlineUsersPanelOpen(open: boolean): void {
    this.onlineUsersPanelOpen = open;
    if (open) {
      this.onlineDurationTick++;
      if (!this.onlinePanelInterval) {
        this.onlinePanelInterval = setInterval(() => {
          this.onlineDurationTick++;
        }, 10000);
      }
    } else {
      this.clearOnlinePanelInterval();
    }
  }

  /** Tempo nesta sessão online (`onlineSince` no Firestore quando existir). */
  public formatOnlineSessionDuration(user: AdminNamedMetric): string {
    void this.onlineDurationTick;
    const since = user.onlineSince;
    if (!since || !(since instanceof Date) || Number.isNaN(since.getTime())) {
      return 'Tempo nesta sessão indisponível';
    }
    const ms = Date.now() - since.getTime();
    if (ms < 0) {
      return 'agora';
    }
    const sec = Math.floor(ms / 1000);
    if (sec < 50) {
      return 'online há poucos segundos';
    }
    const min = Math.floor(sec / 60);
    if (min < 1) {
      return `online há ${sec} s`;
    }
    if (min < 60) {
      return min === 1 ? 'online há 1 minuto' : `online há ${min} minutos`;
    }
    const h = Math.floor(min / 60);
    if (h < 24) {
      return h === 1 ? 'online há 1 hora' : `online há ${h} horas`;
    }
    const d = Math.floor(h / 24);
    return d === 1 ? 'online há 1 dia' : `online há ${d} dias`;
  }

  private clearOnlinePanelInterval(): void {
    if (this.onlinePanelInterval) {
      clearInterval(this.onlinePanelInterval);
      this.onlinePanelInterval = undefined;
    }
  }

  public setPeriod(period: string): void {
    this.filters = { ...this.filters, period: period as AdminMetricsPeriod };
    this.loadMetrics();
  }

  public onCustomDateChange(): void {
    if (this.filters.period === 'custom') {
      this.loadMetrics();
    }
  }

  public refresh(): void {
    this.loadMetrics();
  }

  public getLinePoints(points: AdminChartPoint[]): string {
    if (points.length === 0) return '';
    const maxValue = this.getMaxValue(points);
    const lastIndex = Math.max(points.length - 1, 1);

    return points
      .map((point, index) => {
        const x = (index / lastIndex) * 100;
        const y = 42 - (point.value / maxValue) * 34;
        return `${x},${y}`;
      })
      .join(' ');
  }

  public getAreaPath(points: AdminChartPoint[]): string {
    const line = this.getLinePoints(points);
    if (!line) return '';
    return `M ${line} L 100,44 L 0,44 Z`;
  }

  public getBarHeight(value: number, points: AdminChartPoint[]): number {
    const maxValue = this.getMaxValue(points);
    return Math.max(8, (value / maxValue) * 100);
  }

  public getDonutBackground(points: AdminChartPoint[]): string {
    const colors = ['#799d50', '#3b82f6', '#ef4444'];
    const total = points.reduce((sum, point) => sum + point.value, 0);
    if (total === 0) return '#f1f5f9';

    let cursor = 0;
    const stops = points.map((point, index) => {
      const start = cursor;
      cursor += (point.value / total) * 100;
      return `${colors[index] || '#94a3b8'} ${start}% ${cursor}%`;
    });

    return `conic-gradient(${stops.join(', ')})`;
  }

  public getPointPercent(point: AdminChartPoint, points: AdminChartPoint[]): number {
    const total = points.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) return 0;
    return Math.round((point.value / total) * 100);
  }

  public trackByLabel(_: number, item: { label?: string; id?: string; title?: string }): string {
    return item.id || item.label || item.title || '';
  }

  private loadMetrics(): void {
    this.metricsSub?.unsubscribe();
    this.isLoading = true;
    this.errorMessage = '';

    this.metricsSub = this.analyticsService.getDashboardMetrics(this.filters).subscribe({
      next: metrics => {
        this.metrics = metrics;
        this.isLoading = false;
      },
      error: error => {
        console.error('Erro ao carregar métricas administrativas:', error);
        this.errorMessage = 'Não foi possível carregar as métricas agora. Verifique permissões e conexão com o Firebase.';
        this.isLoading = false;
      }
    });
  }

  private getMaxValue(points: AdminChartPoint[]): number {
    const max = Math.max(...points.map(point => point.value), 0);
    return max <= 0 ? 1 : max;
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
