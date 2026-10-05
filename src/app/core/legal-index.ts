import { signal } from '@angular/core';
import { IonContent } from '@ionic/angular';

/**
 * Índice dos textos legais (Privacidade e dados, Termos e políticas): marca a
 * seção que está sendo lida e rola até a que a pessoa escolhe.
 *
 * No celular o índice é uma fila de chips (`.lg-index ol`) e o chip da seção
 * atual é trazido para a vista; no computador é a lista lateral fixa.
 */
export class LegalIndex {
  readonly active;
  private observer?: IntersectionObserver;

  /** `first` = seção marcada antes de a tela terminar de entrar. */
  constructor(private readonly host: HTMLElement, private readonly content: () => IonContent, first = '') {
    this.active = signal(first);
  }

  /** Começa a acompanhar as seções `ids` (na ordem em que aparecem). */
  watch(ids: readonly string[]): void {
    this.stop();
    if (!this.active() || !ids.includes(this.active())) this.active.set(ids[0] ?? '');

    // Faixa de leitura = terço de cima da tela. Quando o fim de uma seção e o
    // começo da seguinte dividem a faixa, vale a seguinte (a que está chegando).
    const visible = new Set<string>();
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const current = [...ids].reverse().find(id => visible.has(id));
      if (current && current !== this.active()) {
        this.active.set(current);
        this.revealChip(current);
      }
    }, { rootMargin: '0px 0px -65% 0px' });

    for (const id of ids) {
      const el = this.host.querySelector(`#${id}`);
      if (el) this.observer.observe(el);
    }
  }

  stop(): void {
    this.observer?.disconnect();
  }

  /** `scrollIntoView` não alcança o scroll do ion-content; o deslocamento respeita o `scroll-margin-top` da seção. */
  async goTo(id: string): Promise<void> {
    this.active.set(id);
    this.revealChip(id);
    const target = this.host.querySelector(`#${id}`) as HTMLElement | null;
    if (!target) return;
    const content = this.content();
    const scroller = await content.getScrollElement();
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await content.scrollByPoint(0, delta, reduce ? 0 : 400);
  }

  private revealChip(id: string): void {
    const list = this.host.querySelector('.lg-index ol') as HTMLElement | null;
    const chip = list?.querySelector(`[data-section="${id}"]`) as HTMLElement | null;
    if (!list || !chip || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }
}
