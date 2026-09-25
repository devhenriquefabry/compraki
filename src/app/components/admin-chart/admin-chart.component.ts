import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, signal,
} from '@angular/core';

export interface ChartPoint {
  label: string;
  value: number;
}

type ChartKind = 'area' | 'columns';
type ChartFormat = 'brl' | 'int';

const HEIGHT = 220;
const PAD = { top: 14, right: 12, bottom: 28, left: 56 };
const BAR_MAX = 24;

/**
 * Gráfico de uma série para o painel (linha com área ou colunas).
 *
 * Desenha em pixels reais (mede a largura com ResizeObserver), então traço,
 * cantos e texto não distorcem. Segue o guia de dataviz: linha de 2px com
 * véu de 10%, colunas de até 24px com topo arredondado, grade em fio, dica ao
 * passar o mouse/dedo ou navegar com as setas, e tabela para leitor de tela.
 */
@Component({
  selector: 'app-admin-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-chart.component.html',
  styleUrls: ['./admin-chart.component.scss'],
})
export class AdminChartComponent implements AfterViewInit {
  readonly points = input.required<ChartPoint[]>();
  readonly kind = input<ChartKind>('area');
  readonly format = input<ChartFormat>('brl');
  /** Nome da série: título da tabela acessível e rótulo da dica. */
  readonly seriesName = input('Valor');

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  readonly width = signal(0);
  readonly active = signal<number | null>(null);
  readonly height = HEIGHT;
  readonly pad = PAD;

  readonly plotW = computed(() => Math.max(0, this.width() - PAD.left - PAD.right));
  readonly plotH = HEIGHT - PAD.top - PAD.bottom;

  readonly ticks = computed(() => niceTicks(Math.max(0, ...this.points().map(p => p.value)), this.format() === 'int'));
  readonly maxTick = computed(() => this.ticks()[this.ticks().length - 1] || 1);

  readonly slot = computed(() => this.plotW() / Math.max(1, this.points().length));

  readonly xs = computed(() => {
    const n = this.points().length;
    if (this.kind() === 'columns' || n <= 1) {
      return this.points().map((_, i) => PAD.left + this.slot() * (i + 0.5));
    }
    return this.points().map((_, i) => PAD.left + (this.plotW() * i) / (n - 1));
  });

  readonly ys = computed(() => this.points().map(p => this.y(p.value)));

  readonly linePath = computed(() => {
    const xs = this.xs();
    return this.ys().map((y, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y.toFixed(1)}`).join(' ');
  });

  readonly areaPath = computed(() => {
    const xs = this.xs();
    if (!xs.length) return '';
    const base = PAD.top + this.plotH;
    return `${this.linePath()} L${xs[xs.length - 1].toFixed(1)},${base} L${xs[0].toFixed(1)},${base} Z`;
  });

  readonly barWidth = computed(() => Math.max(4, Math.min(BAR_MAX, this.slot() * 0.62)));

  readonly bars = computed(() => {
    const w = this.barWidth();
    const base = PAD.top + this.plotH;
    return this.points().map((p, i) => {
      const x = this.xs()[i] - w / 2;
      const h = Math.max(p.value > 0 ? 2 : 0, base - this.ys()[i]);
      const r = Math.min(4, h, w / 2);
      const top = base - h;
      // Topo com 4px de raio, base reta (presa à linha de base).
      const d = h <= 0 ? '' :
        `M${x},${base} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${base} Z`;
      return { d, x, w };
    });
  });

  /** Rótulos do eixo X sem encavalar: no máximo ~1 a cada 64px. */
  readonly xLabels = computed(() => {
    const n = this.points().length;
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(this.plotW() / 64))));
    // Conta de trás para frente: o último dia sempre aparece e o espaço fica igual.
    return this.points()
      .map((p, i) => ({ label: p.label, x: this.xs()[i], i }))
      .filter(item => (n - 1 - item.i) % every === 0);
  });

  readonly total = computed(() => this.points().reduce((sum, p) => sum + p.value, 0));
  readonly hasData = computed(() => this.points().some(p => p.value > 0));

  readonly tooltip = computed(() => {
    const i = this.active();
    if (i === null || !this.points()[i]) return null;
    const x = this.xs()[i];
    const flip = x > this.width() - 150;
    return {
      point: this.points()[i],
      x,
      y: this.ys()[i],
      flip,
    };
  });

  ngAfterViewInit() {
    const el = this.host.nativeElement as HTMLElement;
    const measure = (w: number) => {
      const rounded = Math.round(w);
      if (rounded !== this.width()) this.width.set(rounded);
    };
    // clientWidth e contentRect são pixels de layout (o painel aplica `zoom` no conteúdo).
    measure(el.clientWidth);
    const observer = new ResizeObserver(entries => measure(entries[0].contentRect.width));
    observer.observe(el);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  y(value: number): number {
    return PAD.top + this.plotH - (value / this.maxTick()) * this.plotH;
  }

  fmt(value: number, compact = false): string {
    if (this.format() === 'int') return new Intl.NumberFormat('pt-BR').format(Math.round(value));
    if (compact) {
      if (value >= 1000) {
        return `R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 1000)} mil`;
      }
      return `R$ ${Math.round(value)}`;
    }
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  // ------------------------------------------------------------ interação

  onPointer(event: PointerEvent) {
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const xs = this.xs();
    if (!xs.length) return;
    let best = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    }
    this.active.set(best);
  }

  onKey(event: KeyboardEvent) {
    const n = this.points().length;
    if (!n) return;
    const current = this.active() ?? (event.key === 'ArrowLeft' ? n : -1);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.active.set(Math.min(n - 1, current + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.active.set(Math.max(0, current - 1));
    } else if (event.key === 'Escape') {
      this.active.set(null);
    }
  }
}

/** 4 ou 5 marcas "redondas" de 0 até cobrir o máximo; contagem só em inteiros. */
function niceTicks(max: number, integer = false): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= rough) ?? 10 * power;
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 100) / 100);
  return ticks;
}
