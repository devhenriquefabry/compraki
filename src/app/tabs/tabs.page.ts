import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { IonTabs, IonTabBar, IonTabButton } from '@ionic/angular/standalone';
import { User } from 'firebase/auth';
import { filter, map } from 'rxjs/operators';
import { isCurrentUserAdmin, onAuthUserChanged } from '../core/auth-state';
import { FirebaseProducts } from '../services/firebase-products';
import { StorefrontDataService } from '../services/storefront-data.service';

/**
 * Traços dos ícones da barra e do menu, desenhados para o Vineon (grade 24,
 * traço 1.75 arredondado). Ficam aqui em vez do ionicons para a barra não ter
 * a cara padrão do Ionic e para o traço ser o mesmo em todos.
 */
const ICONS = {
  home: 'M3.75 10.4 12 3.75l8.25 6.65v9.1a.75.75 0 0 1-.75.75h-4.75v-6h-5.5v6H4.5a.75.75 0 0 1-.75-.75Z',
  account: 'M12 12.25a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4.5 20.25c.95-3.35 3.9-5.25 7.5-5.25s6.55 1.9 7.5 5.25',
  cart: 'M2.75 4.25h2.4l2.1 10.1c.1.5.55.85 1.05.85h9.05c.5 0 .93-.34 1.05-.82l1.55-6.13H6.1 M10.65 19.5a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z M18.65 19.5a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z',
  menu: 'M4 6.5h16 M4 12h16 M4 17.5h10',
  close: 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
  chevron: 'm9.5 6 6 6-6 6',
  bag: 'M5.25 8.25h13.5l-.9 11.1a1 1 0 0 1-1 .9H7.15a1 1 0 0 1-1-.9Z M9 8.25V7a3 3 0 0 1 6 0v1.25',
  heart: 'M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z',
  chat: 'M4.5 6.25c0-.7.55-1.25 1.25-1.25h12.5c.7 0 1.25.55 1.25 1.25v8.5c0 .7-.55 1.25-1.25 1.25H10l-4 3.25V16h-.25c-.7 0-1.25-.55-1.25-1.25Z',
  bell: 'M6.25 16.5V11a5.75 5.75 0 0 1 11.5 0v5.5l1.5 1.5H4.75Z M10 20.25a2 2 0 0 0 4 0',
  plus: 'M12 5.5v13 M5.5 12h13',
  tag: 'M3.75 12.6V4.5a.75.75 0 0 1 .75-.75h8.1l7.65 7.65a1 1 0 0 1 0 1.4l-6.7 6.7a1 1 0 0 1-1.4 0Z M8.5 9.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z',
  chart: 'M4.5 19.75h15 M7.5 16.25v-4 M11 16.25v-7.5 M14.5 16.25v-5.5 M18 16.25V5.75',
  store: 'M4.5 9.5 5.6 4.75h12.8l1.1 4.75 M4.5 9.5a2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 3 2.12A2.25 2.25 0 0 0 15 9.5a2.25 2.25 0 0 0 4.5 0 M5.75 11.6v8.15h12.5V11.6 M10 19.75v-4.5h4v4.5',
  history: 'M4.75 12a7.25 7.25 0 1 0 2.1-5.1 M4.5 4.5v3.25h3.25 M12 8.25V12l2.5 1.75',
  pin: 'M12 20.5s-6.25-5.4-6.25-10.25a6.25 6.25 0 0 1 12.5 0C18.25 15.1 12 20.5 12 20.5Z M12 12.25a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  shield: 'M12 3.75 19 6.5v5.25c0 4.2-3 7.4-7 8.5-4-1.1-7-4.3-7-8.5V6.5Z M9 12l2.1 2.1L15.25 10',
  logout: 'M14.5 4.75H18c.7 0 1.25.55 1.25 1.25v12c0 .7-.55 1.25-1.25 1.25h-3.5 M10.5 8.25 6.75 12l3.75 3.75 M6.75 12h9',
} as const;

/**
 * Barra inferior do celular, no molde da Amazon: Início, Conta, Carrinho e
 * Menu. "Menu" não é uma aba — abre um painel por cima da página atual com o
 * que antes ficava espalhado em abas (Salvos, Vender) e na sidebar.
 */
@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.menu-open]': 'menuOpen()' },
})
export class TabsPage {
  private readonly router = inject(Router);
  private readonly fbProducts = inject(FirebaseProducts);
  private readonly storefront = inject(StorefrontDataService);

  readonly icons = ICONS;

  readonly cartCount = toSignal(this.storefront.cartCount$, { initialValue: 0 });
  readonly savedCount = toSignal(this.storefront.savedItems$.pipe(map(items => items.length)), { initialValue: 0 });

  readonly menuOpen = signal(false);
  readonly user = signal<User | null>(null);
  readonly isAdmin = signal(false);

  readonly firstName = computed(() => {
    const user = this.user();
    const name = user?.displayName?.trim() || user?.email?.split('@')[0] || 'você';
    return name.split(/\s+/)[0];
  });

  readonly initials = computed(() => this.firstName().charAt(0).toUpperCase());

  /** Página atual, para o visitante voltar a ela depois de entrar ou criar a conta. */
  private readonly currentUrl = signal(this.router.url);
  readonly authQuery = computed(() => {
    const url = this.currentUrl();
    return /^\/(login|sign-in)/.test(url) ? {} : { redirectTo: url };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    const stopAuthWatch = onAuthUserChanged(user => {
      this.user.set(user);
      this.isAdmin.set(false);
      if (user) {
        isCurrentUserAdmin().then(isAdmin => this.isAdmin.set(isAdmin));
      }
    });
    destroyRef.onDestroy(stopAuthWatch);

    const navSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        this.menuOpen.set(false);
        this.currentUrl.set(event.urlAfterRedirects);
      });
    destroyRef.onDestroy(() => navSub.unsubscribe());
  }

  toggleMenu() {
    this.menuOpen.update(open => !open);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  /** Fecha também quando o link aponta para a página em que a pessoa já está. */
  onMenuClick(event: Event) {
    if ((event.target as HTMLElement).closest('a')) this.closeMenu();
  }

  logout() {
    this.closeMenu();
    this.fbProducts.signOut();
    this.router.navigate(['/login']);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeMenu();
  }
}
