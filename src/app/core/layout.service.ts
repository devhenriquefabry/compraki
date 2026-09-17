import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { filter } from 'rxjs/operators';

/** Mesmo corte do breakpoint `lg` do Ionic. */
const DESKTOP_QUERY = '(min-width: 992px)';

/**
 * Rotas que não usam o header de loja no desktop: telas de login têm layout
 * próprio centralizado e o painel admin tem cabeçalho e navegação dele.
 */
const ROUTES_WITHOUT_SHELL = [
  '/login',
  '/sign-in',
  '/forgot-password',
  '/password-recovery',
  '/admin',
  '/bots',
  '/webhook-tester',
];

/**
 * Decide quando o app se comporta como site de desktop.
 *
 * O layout de desktop só existe no navegador: dentro do APK (Capacitor) ele
 * nunca liga, nem num tablet deitado, para o app da Play Store continuar
 * idêntico. O estado também vira classe no <html> (`vn-desktop`,
 * `vn-desktop-shell`), que é por onde o CSS global esconde a barra de abas e
 * os cabeçalhos de celular — ver `theme/desktop.scss`.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly router = inject(Router);

  private readonly isWideScreen = signal(false);
  private readonly currentUrl = signal(this.router.url);

  /** Tela larga, fora do app nativo. */
  readonly isDesktop = this.isWideScreen.asReadonly();

  /** Desktop e a rota atual usa o header de loja. */
  readonly showDesktopShell = computed(() => {
    if (!this.isDesktop()) return false;
    const path = this.currentUrl().split(/[?#]/)[0];
    return !ROUTES_WITHOUT_SHELL.some(route => path === route || path.startsWith(route + '/'));
  });

  constructor() {
    // Serviço raiz: vive o app inteiro, então os listeners abaixo não precisam
    // ser removidos.
    if (!Capacitor.isNativePlatform() && typeof window.matchMedia === 'function') {
      const query = window.matchMedia(DESKTOP_QUERY);
      this.isWideScreen.set(query.matches);
      query.addEventListener('change', event => this.isWideScreen.set(event.matches));
    }

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => this.currentUrl.set(event.urlAfterRedirects));

    effect(() => {
      const root = document.documentElement.classList;
      root.toggle('vn-desktop', this.isDesktop());
      root.toggle('vn-desktop-shell', this.showDesktopShell());
    });
  }
}
