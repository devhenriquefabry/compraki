import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { User } from 'firebase/auth';
import { filter, map } from 'rxjs/operators';
import { isCurrentUserAdmin, onAuthUserChanged } from '../../core/auth-state';
import { FirebaseProducts } from '../../services/firebase-products';
import { StorefrontDataService } from '../../services/storefront-data.service';

type HeaderMenu = 'categories' | 'account';

/**
 * Cabeçalho do site no desktop, no molde do Mercado Livre: busca larga no
 * topo, categorias e atalhos da loja embaixo, conta/favoritos/carrinho à
 * direita. Substitui o `app-mini-header` e a barra de abas quando o
 * `LayoutService` liga o shell de desktop.
 *
 * A busca não guarda estado próprio: ela navega para a home com `?q=`, então
 * todo resultado tem URL e o botão voltar do navegador funciona.
 */
@Component({
  selector: 'app-desktop-header',
  templateUrl: './desktop-header.component.html',
  styleUrls: ['./desktop-header.component.scss'],
  standalone: true,
  imports: [IonicModule, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesktopHeaderComponent {
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly fbProducts = inject(FirebaseProducts);
  private readonly storefront = inject(StorefrontDataService);

  readonly categories = toSignal(this.storefront.categories$, { initialValue: [] });
  readonly cartCount = toSignal(this.storefront.cartCount$, { initialValue: 0 });
  readonly savedCount = toSignal(this.storefront.savedItems$.pipe(map(items => items.length)), { initialValue: 0 });

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly user = signal<User | null>(null);
  readonly isAdmin = signal(false);
  readonly openMenu = signal<HeaderMenu | null>(null);
  readonly searchTerm = signal('');

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

    this.syncSearchTerm(this.router.url);
    const navSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        this.openMenu.set(null);
        this.currentUrl.set(event.urlAfterRedirects);
        this.syncSearchTerm(event.urlAfterRedirects);
      });
    destroyRef.onDestroy(() => navSub.unsubscribe());
  }

  submitSearch(event: Event, rawTerm: string) {
    event.preventDefault();
    const q = rawTerm.trim();
    this.router.navigate(['/tabs/tab2'], { queryParams: q ? { q } : {} });
  }

  toggleMenu(menu: HeaderMenu) {
    this.openMenu.update(current => (current === menu ? null : menu));
  }

  closeMenus() {
    this.openMenu.set(null);
  }

  logout() {
    this.closeMenus();
    this.fbProducts.signOut();
    this.router.navigate(['/login']);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeMenus();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.openMenu() && !this.host.nativeElement.contains(event.target as Node)) {
      this.closeMenus();
    }
  }

  /** Mantém o campo de busca igual ao `?q=` da home, inclusive ao voltar. */
  private syncSearchTerm(url: string) {
    const onHome = url.split(/[?#]/)[0].startsWith('/tabs/tab2');
    const term = onHome ? (this.router.parseUrl(url).queryParams['q'] ?? '') : '';
    this.searchTerm.set(term);

    // O binding `[value]` não reescreve o campo se o termo não mudou, e o que
    // a pessoa digitou sem buscar ficaria lá depois de trocar de página.
    const input = this.searchInput()?.nativeElement;
    if (input) input.value = term;
  }
}
