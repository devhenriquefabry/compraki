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
  AdminMetricsPeriod
} from '../../services/admin-analytics.service';

@Component({
  selector: 'app-admin-metrics',
  templateUrl: './admin-metrics.page.html',
  styleUrls: ['./admin-metrics.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AdminMetricsPage implements OnInit, OnDestroy {
  public metrics?: AdminDashboardMetrics;
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

  constructor(private analyticsService: AdminAnalyticsService) {}

  ngOnInit(): void {
    this.loadMetrics();
  }

  ngOnDestroy(): void {
    this.metricsSub?.unsubscribe();
  }

  public setPeriod(period: AdminMetricsPeriod): void {
    this.filters = { ...this.filters, period };
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
