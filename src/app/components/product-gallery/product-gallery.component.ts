import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { IonicModule } from '@ionic/angular';

const PLACEHOLDER_IMAGE = 'assets/imagens/imagem-placeholder.png';

/**
 * Galeria da página de produto.
 *
 * - Desktop: miniaturas na lateral (troca ao passar o mouse, como no Mercado
 *   Livre), foto principal com lupa que acompanha o cursor.
 * - Celular: fotos em faixa com rolagem por encaixe e contador "2 / 5".
 * - Nos dois: clique abre a foto em tela cheia, com setas e teclado.
 *
 * A faixa do celular usa scroll-snap do próprio navegador em vez do Swiper:
 * o gesto é o nativo do sistema e não há biblioteca para inicializar.
 */
@Component({
  selector: 'app-product-gallery',
  templateUrl: './product-gallery.component.html',
  styleUrls: ['./product-gallery.component.scss'],
  standalone: true,
  imports: [IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductGalleryComponent {
  readonly photos = input<string[] | undefined>([]);
  readonly productName = input('');
  readonly compact = input(false);

  readonly images = computed(() => {
    const list = (this.photos() || []).filter(Boolean);
    return list.length ? list : [PLACEHOLDER_IMAGE];
  });

  readonly active = signal(0);
  readonly zoom = signal<{ x: number; y: number } | null>(null);
  readonly lightboxOpen = signal(false);

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  constructor() {
    // Produto trocado (relacionado clicado): volta para a primeira foto.
    effect(() => {
      this.images();
      this.active.set(0);
      this.track()?.nativeElement.scrollTo({ left: 0 });
    });
  }

  select(index: number) {
    const total = this.images().length;
    this.active.set((index + total) % total);
  }

  onTrackScroll(event: Event) {
    const el = event.target as HTMLElement;
    const index = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (index !== this.active()) this.active.set(index);
  }

  scrollTrackTo(index: number) {
    const el = this.track()?.nativeElement;
    el?.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  }

  onZoomMove(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.zoom.set({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  }

  openLightbox(index = this.active()) {
    this.active.set(index);
    this.lightboxOpen.set(true);
  }

  closeLightbox() {
    this.lightboxOpen.set(false);
    // O celular mostra a mesma foto que estava aberta em tela cheia.
    this.scrollTrackTo(this.active());
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (!this.lightboxOpen()) return;
    if (event.key === 'Escape') this.closeLightbox();
    if (event.key === 'ArrowRight') this.select(this.active() + 1);
    if (event.key === 'ArrowLeft') this.select(this.active() - 1);
  }
}
