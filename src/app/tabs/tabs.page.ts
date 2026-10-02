import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { IonTabs, IonTabBar, IonTabButton } from '@ionic/angular/standalone';
import { User } from 'firebase/auth';
import { filter, map } from 'rxjs/operators';
import { isCurrentUserAdmin, onAuthUserChanged } from '../core/auth-state';
import { FirebaseProducts } from '../services/firebase-products';
import { StorefrontDataService } from '../services/storefront-data.service';
import { NotificationCenterService } from '../services/notification-center.service';
import { VN_ICONS } from '../core/vn-icons';


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

  readonly icons = VN_ICONS;

  /** Avisos não lidos: número no atalho "Avisos" e ponto no botão Menu. */
  readonly unread = inject(NotificationCenterService).unread;

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
