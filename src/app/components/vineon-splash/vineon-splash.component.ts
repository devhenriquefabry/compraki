import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, output, signal } from '@angular/core';
import { VineonLogoComponent } from '../vineon-logo/vineon-logo.component';

/** A logo termina de se desenhar em ~1,8 s; a saída começa logo depois. */
const HOLD_MS = 2000;
const FADE_MS = 450;

/**
 * Splash de entrada (direção "Noite"): fundo azul-noite e a logo horizontal
 * se desenhando no centro. Sem barra de carregamento nem texto.
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
    <div class="splash" [class.leaving]="leaving()">
      <app-vineon-logo class="logo" [animated]="true"></app-vineon-logo>
    </div>
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
  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit() {
    this.timers.push(setTimeout(() => {
      this.leaving.set(true);
      this.timers.push(setTimeout(() => this.done.emit(), FADE_MS));
    }, HOLD_MS));
  }

  ngOnDestroy() {
    this.timers.forEach(clearTimeout);
  }
}
