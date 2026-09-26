import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, output } from '@angular/core';

/** A logo termina de se desenhar em ~2,0 s (com movimento reduzido, ~0,2 s). */
const ANIM_MS = 2000;
const ANIM_REDUCED_MS = 200;
/** Pausa com a logo completa antes de entrar no app. */
const PAUSE_MS = 750;
/** Igual ao transition do .vn-boot no index.html. */
const FADE_MS = 450;

declare global {
  interface Window { __vnBootT?: number; }
}

/**
 * Splash de entrada (direção "Noite"): fundo azul-noite e a logo horizontal
 * se desenhando no centro. Sem barra de carregamento nem texto.
 *
 * A logo animada vive só no index.html (#vn-boot) e começa antes do Angular
 * carregar; este componente não desenha nada — conta o tempo a partir de
 * `window.__vnBootT` e faz o fade daquele elemento. Trocar por uma logo nova
 * reiniciava a animação e dava uma "piscadinha".
 *
 * Enquanto ela roda, o roteador já resolve a sessão por baixo (guards), então
 * ao sumir a tela certa — login ou vitrine — já está pronta.
 */
@Component({
  selector: 'app-vineon-splash',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class VineonSplashComponent implements OnInit, OnDestroy {
  /** Emitido quando o fade de saída terminou e a splash pode sair do DOM. */
  readonly done = output<void>();
  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit() {
    const boot = document.documentElement.classList.contains('vn-booting')
      ? document.getElementById('vn-boot')
      : null;
    if (!boot) {
      this.timers.push(setTimeout(() => this.done.emit()));
      return;
    }

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const total = (reduced ? ANIM_REDUCED_MS : ANIM_MS) + PAUSE_MS;
    const elapsed = window.__vnBootT != null ? performance.now() - window.__vnBootT : 0;

    this.timers.push(setTimeout(() => {
      boot.classList.add('vn-leaving');
      this.timers.push(setTimeout(() => {
        boot.remove();
        this.done.emit();
      }, FADE_MS));
    }, Math.max(0, total - elapsed)));
  }

  ngOnDestroy() {
    this.timers.forEach(clearTimeout);
  }
}
