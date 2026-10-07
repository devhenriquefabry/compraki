import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Cinco estrelas só de leitura, com preenchimento parcial (4,5 mostra meia).
 * Mesmo desenho das "Opiniões do produto": estrela marinho sobre cinza.
 *
 *   <app-review-stars [value]="4.5" [size]="14" />
 */
@Component({
  selector: 'app-review-stars',
  standalone: true,
  template: `
    <span class="rs" role="img" [attr.aria-label]="label()" [style.--size.px]="size()">
      @for (fill of fills(); track $index) {
        <span class="rs-star" [style.--fill]="fill"></span>
      }
    </span>
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .rs { display: inline-flex; gap: calc(var(--size) * 0.12); }
    .rs-star {
      width: var(--size);
      height: var(--size);
      clip-path: polygon(50% 0%, 61.8% 35.3%, 98.1% 35.3%, 68.8% 57.1%, 79.4% 91.2%, 50% 70.6%, 20.6% 91.2%, 31.2% 57.1%, 1.9% 35.3%, 38.2% 35.3%);
      background: linear-gradient(90deg,
        var(--rs-on, var(--vn-navy-900, #0B1623)) calc(var(--fill, 0) * 100%),
        var(--rs-off, var(--vn-line, #DDE2E8)) calc(var(--fill, 0) * 100%));
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewStarsComponent {
  readonly value = input.required<number>();
  readonly size = input(16);

  readonly fills = computed(() => [1, 2, 3, 4, 5].map(star => Math.max(0, Math.min(1, this.value() - (star - 1)))));
  readonly label = computed(() => `Nota ${this.value().toLocaleString('pt-BR', { maximumFractionDigits: 1 })} de 5`);
}
