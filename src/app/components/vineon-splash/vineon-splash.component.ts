import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, output, signal } from '@angular/core';
import { VineonLogoComponent } from '../vineon-logo/vineon-logo.component';

/** A logo termina de se desenhar em ~1,8 s (com movimento reduzido, ~0,2 s). */
const ANIM_MS = 1800;
const ANIM_REDUCED_MS = 200;
/** Pausa com a logo completa antes de entrar no app. */
const PAUSE_MS = 750;
const FADE_MS = 450;

declare global {
  interface Window { __vnBootT?: number; }
}

/**
 * Splash de entrada (direção "Noite"): fundo azul-noite e a logo horizontal
 * se desenhando no centro. Sem barra de carregamento nem texto.
 *
 * A logo animada nasce no index.html (#vn-boot), antes do Angular carregar, e
 * este componente só conta o tempo a partir de `window.__vnBootT` e faz o fade
 * daquele mesmo elemento — trocar por uma logo nova reiniciava a animação e
 * dava uma "piscadinha". Se o #vn-boot não estiver visível, desenha a própria.
 *
 * Enquanto ela roda, o roteador já resolve a sessão por baixo (guards), então
 * ao sumir a tela certa — login ou vitrine — já está pronta.
 */
@Component({
  selector: 'app-vineon-splash',
  standalone: true,
  imports: [VineonLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!boot) {
      <div class="splash" [class.leaving]="leaving()">
        <app-vineon-logo class="logo" [animated]="true"></app-vineon-logo>
      </div>
    }
  `,
  styles: [`
    .splash {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0B1623;
      transition: opacity ${FADE_MS}ms ease;
    }
    .splash.leaving { opacity: 0; pointer-events: none; }
    .logo { width: 250px; height: 85px; }
  `],
})
export class VineonSplashComponent implements OnInit, OnDestroy {
  /** Emitido quando o fade de saída terminou e a splash pode sair do DOM. */
  readonly done = output<void>();
  readonly leaving = signal(false);
  /** A logo do index.html, se ela é quem está na tela. */
  readonly boot = document.documentElement.classList.contains('vn-booting')
    ? document.getElementById('vn-boot')
    : null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit() {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const total = (reduced ? ANIM_REDUCED_MS : ANIM_MS) + PAUSE_MS;
    const elapsed = this.boot && window.__vnBootT != null ? performance.now() - window.__vnBootT : 0;

    this.timers.push(setTimeout(() => {
      this.leaving.set(true);
      this.boot?.classList.add('vn-leaving');
      this.timers.push(setTimeout(() => {
        this.boot?.remove();
        this.done.emit();
      }, FADE_MS));
    }, Math.max(0, total - elapsed)));
  }

  ngOnDestroy() {
    this.timers.forEach(clearTimeout);
  }
}
