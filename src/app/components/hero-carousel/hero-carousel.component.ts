import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Banner } from '../../interfaces/banner';

const AUTOPLAY_MS = 6000;

type BannerLink = { kind: 'internal' | 'external'; href: string } | null;

/**
 * Banners do topo da home de desktop.
 *
 * Usa os banners de "Gestão de Banners" numa faixa 4:1: a arte "Computador"
 * quando existe; senão a do celular, inteira, sem corte. Troca
 * sozinho a cada 6s, mas para quando o mouse ou o foco está nele e não anda
 * para quem pediu menos movimento no sistema.
 */
@Component({
  selector: 'app-hero-carousel',
  templateUrl: './hero-carousel.component.html',
  styleUrls: ['./hero-carousel.component.scss'],
  standalone: true,
  imports: [IonicModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroCarouselComponent {
  readonly banners = input.required<Banner[]>();

  private readonly router = inject(Router);

  readonly index = signal(0);
  readonly paused = signal(false);
  readonly count = computed(() => this.banners().length);

  constructor() {
    // A lista chega do Firestore e pode encolher; não deixa o índice apontar
    // para um banner que saiu.
    effect(() => {
      const count = this.count();
      untracked(() => {
        if (this.index() >= count) this.index.set(0);
      });
    });

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion) {
      const timer = setInterval(() => {
        if (!this.paused() && this.count() > 1) this.next();
      }, AUTOPLAY_MS);
      inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }
  }

  next() {
    this.index.update(i => (i + 1) % this.count());
  }

  previous() {
    this.index.update(i => (i - 1 + this.count()) % this.count());
  }

  goTo(i: number) {
    this.index.set(i);
  }

  /** "Link do botão" do admin: caminho interno ("/checkout") ou URL externa. */
  linkOf(banner: Banner): BannerLink {
    const href = banner.buttonLink?.trim();
    if (!href) return null;
    if (href.startsWith('/')) return { kind: 'internal', href };
    if (/^https?:\/\//i.test(href)) return { kind: 'external', href };
    return null;
  }

  openInternal(event: MouseEvent, href: string) {
    // Ctrl/Cmd/meio: deixa o navegador abrir em outra aba normalmente.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    this.router.navigateByUrl(href);
  }
}
