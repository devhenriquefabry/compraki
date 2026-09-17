import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Product } from '../../interfaces/product';
import { StorefrontCardComponent } from '../storefront-card/storefront-card.component';

let nextRailId = 0;

/**
 * Faixa horizontal de produtos com título e "Ver todos", como as vitrines da
 * home do Mercado Livre. As setas só aparecem quando existe o que rolar
 * naquela direção; roda do mouse e teclado continuam funcionando no trilho.
 */
@Component({
  selector: 'app-product-rail',
  templateUrl: './product-rail.component.html',
  styleUrls: ['./product-rail.component.scss'],
  standalone: true,
  imports: [IonicModule, RouterLink, StorefrontCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductRailComponent {
  readonly heading = input.required<string>();
  readonly products = input.required<Product[]>();
  /** Query params da home que listam tudo desta faixa. Sem eles, não há "Ver todos". */
  readonly seeAll = input<Record<string, string | number> | null>(null);

  readonly headingId = `product-rail-${nextRailId++}`;
  readonly canScrollBack = signal(false);
  readonly canScrollForward = signal(false);

  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  constructor() {
    // Recalcula as setas quando a lista muda (o conteúdo muda de largura
    // sem a caixa do trilho mudar de tamanho).
    afterRenderEffect(() => {
      this.products();
      this.updateArrows();
    });

    const observer = new ResizeObserver(() => this.updateArrows());
    afterNextRender(() => observer.observe(this.track().nativeElement));
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  scrollByPage(direction: 1 | -1) {
    const track = this.track().nativeElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({
      left: direction * track.clientWidth * 0.9,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }

  updateArrows() {
    const track = this.track().nativeElement;
    const maxScroll = track.scrollWidth - track.clientWidth;
    this.canScrollBack.set(track.scrollLeft > 4);
    this.canScrollForward.set(track.scrollLeft < maxScroll - 4);
  }
}
