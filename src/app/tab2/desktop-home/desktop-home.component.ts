import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { IonContent, IonicModule } from '@ionic/angular';
import { filter, map } from 'rxjs/operators';
import { Banner } from '../../interfaces/banner';
import { Category } from '../../interfaces/category';
import { Product } from '../../interfaces/product';
import { discountPercent, hasDiscount, hasFreeShipping, priceMain } from '../../core/product-pricing';
import { AppConfigService } from '../../services/app-config.service';
import { getRecentlyViewedIds } from '../../core/recently-viewed';
import { StorefrontDataService } from '../../services/storefront-data.service';
import { DesktopFooterComponent } from '../../components/desktop-footer/desktop-footer.component';
import { HeroCarouselComponent } from '../../components/hero-carousel/hero-carousel.component';
import { ProductRailComponent } from '../../components/product-rail/product-rail.component';
import { StorefrontCardComponent } from '../../components/storefront-card/storefront-card.component';
import {
  StoreFilters,
  filterProducts,
  hasActiveFilters,
  parseStoreFilters,
  priceRanges,
  sortProducts,
} from './desktop-home.filters';

const PAGE_SIZE = 24;
const RAIL_SIZE = 15;
/** Faixa com menos que isso parece vazia e só repete o que já apareceu. */
const RAIL_MIN = 4;
const PLACEHOLDER_IMAGE = 'assets/imagens/imagem-placeholder.png';

type QueryPatch = Partial<Record<keyof StoreFilters, string | number | null>>;

interface Shortcut {
  key: string;
  title: string;
  product?: Product;
  icon?: string;
  text?: string;
  note?: string;
  cta: string;
  link: unknown[];
  queryParams?: Record<string, string | number>;
}

/**
 * Home do site no desktop, no molde da home do Mercado Livre.
 *
 * Dois modos na mesma rota (`/tabs/tab2`):
 * - vitrine: banners, atalhos, faixas de produtos, categorias e catálogo;
 * - resultados: qualquer filtro na URL (`?q=`, `?cat=`, `?frete=1`...) troca
 *   para lista com filtros na lateral.
 *
 * Recebe o catálogo pronto da Tab2, que já mantém o stream de produtos, e não
 * abre consulta própria ao Firestore — tudo aqui é recorte em memória.
 */
@Component({
  selector: 'app-desktop-home',
  templateUrl: './desktop-home.component.html',
  styleUrls: ['./desktop-home.component.scss'],
  standalone: true,
  imports: [
    IonicModule,
    RouterLink,
    HeroCarouselComponent,
    ProductRailComponent,
    StorefrontCardComponent,
    DesktopFooterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesktopHomeComponent {
  readonly products = input.required<Product[]>();
  readonly categories = input.required<Category[]>();
  readonly banners = input.required<Banner[]>();
  /** Falso até o primeiro retorno do catálogo: mostra esqueleto, não "vazio". */
  readonly loaded = input(false);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly content = inject(IonContent, { optional: true });
  private readonly storefront = inject(StorefrontDataService);
  private readonly appConfig = inject(AppConfigService);

  readonly placeholder = PLACEHOLDER_IMAGE;
  readonly railMin = RAIL_MIN;
  readonly skeletonCards = Array.from({ length: 6 }, (_, i) => i);

  readonly filters = toSignal(this.route.queryParamMap.pipe(map(parseStoreFilters)), {
    initialValue: parseStoreFilters(this.route.snapshot.queryParamMap),
  });
  readonly isResults = computed(() => hasActiveFilters(this.filters()));
  readonly visibleCount = signal(PAGE_SIZE);

  private readonly cartItems = toSignal(this.storefront.cartItems$, { initialValue: [] });
  private readonly savedItems = toSignal(this.storefront.savedItems$, { initialValue: [] });
  private readonly recentIds = signal(getRecentlyViewedIds());

  // ---- Vitrine ----

  private readonly byId = computed(() => new Map(this.products().map(p => [p.id, p])));

  readonly offers = computed(() =>
    this.products().filter(hasDiscount).sort((a, b) => discountPercent(b) - discountPercent(a))
  );

  readonly bestSellers = computed(() =>
    this.products()
      .filter(p => (p.soldCount ?? 0) > 0)
      .sort((a, b) => (b.soldCount ?? 0) - (a.soldCount ?? 0))
  );

  readonly freeShipping = computed(() => {
    const rule = this.appConfig.freeShippingRule();
    return this.products().filter(p => hasFreeShipping(p, rule));
  });

  readonly recentlyViewed = computed(() =>
    this.recentIds()
      .map(id => this.byId().get(id))
      .filter((p): p is Product => !!p)
  );

  /** Mesma categoria do último produto visto, sem repetir o que já foi visto. */
  readonly inspired = computed(() => {
    const last = this.recentlyViewed()[0];
    if (!last?.categoryIds?.length) return [];
    const seen = new Set(this.recentIds());
    return this.products().filter(
      p => !seen.has(p.id ?? '') && p.categoryIds?.some(id => last.categoryIds.includes(id))
    );
  });

  readonly inspiredSeeAll = computed(() => {
    const category = this.recentlyViewed()[0]?.categoryIds?.[0];
    return category ? { cat: category } : null;
  });

  readonly offersRail = computed(() => this.offers().slice(0, RAIL_SIZE));
  readonly bestSellersRail = computed(() => this.bestSellers().slice(0, RAIL_SIZE));
  readonly freeShippingRail = computed(() => this.freeShipping().slice(0, RAIL_SIZE));
  readonly inspiredRail = computed(() => this.inspired().slice(0, RAIL_SIZE));

  readonly categoryTiles = computed(() =>
    this.categories().map(category => ({
      category,
      count: this.products().filter(p => p.categoryIds?.includes(category.id)).length,
    }))
  );

  /** As duas categorias com mais produtos ganham faixa própria. */
  readonly categoryRails = computed(() =>
    this.categories()
      .map(category => ({
        category,
        products: this.products().filter(p => p.categoryIds?.includes(category.id)),
      }))
      .filter(rail => rail.products.length >= RAIL_MIN)
      .sort((a, b) => b.products.length - a.products.length)
      .slice(0, 2)
      .map(rail => ({ ...rail, products: rail.products.slice(0, RAIL_SIZE) }))
  );

  readonly newest = computed(() =>
    [...this.products()].sort((a, b) => createdAtSeconds(b) - createdAtSeconds(a))
  );
  readonly visibleNewest = computed(() => this.newest().slice(0, this.visibleCount()));

  /** Cards que ficam sobre a faixa azul, como "Compre seu carrinho" no Mercado Livre. */
  readonly shortcuts = computed<Shortcut[]>(() => {
    const cards: Shortcut[] = [];
    // O mesmo produto em dois atalhos parece defeito; cada vitrine pega um inédito.
    const shown = new Set<string | undefined>();
    const firstUnseen = (list: Product[]) => list.find(p => !shown.has(p.id));

    const cart = this.cartItems();
    const inCart = cart[0]?.productData;
    if (inCart) {
      cards.push({
        key: 'cart',
        title: 'Seu carrinho',
        product: inCart,
        note: cart.length > 1 ? `e mais ${cart.length - 1} ${cart.length === 2 ? 'item' : 'itens'}` : undefined,
        cta: 'Ir para o carrinho',
        link: ['/tabs/cart'],
      });
    } else {
      const hasOffers = this.offers().length > 0;
      cards.push({
        key: 'cart',
        title: 'Seu carrinho',
        icon: 'cart-outline',
        text: 'Seu carrinho está vazio. O que você adicionar aparece aqui.',
        cta: hasOffers ? 'Ver ofertas' : 'Ver produtos',
        link: ['/tabs/tab2'],
        queryParams: hasOffers ? { ofertas: 1 } : { ordem: 'mais-vendidos' },
      });
    }

    shown.add(inCart?.id);

    const lastSeen = this.recentlyViewed()[0];
    if (lastSeen) {
      shown.add(lastSeen.id);
      cards.push({
        key: 'recent',
        title: 'Visto recentemente',
        product: lastSeen,
        cta: 'Ver produto',
        link: ['/product-details', lastSeen.id],
      });
    }

    const topOffer = firstUnseen(this.offers());
    if (topOffer) {
      shown.add(topOffer.id);
      cards.push({
        key: 'offer',
        title: 'Maior desconto',
        product: topOffer,
        cta: 'Ver ofertas',
        link: ['/tabs/tab2'],
        queryParams: { ofertas: 1 },
      });
    }

    const saved = this.savedItems();
    const favorite = saved[0]?.productData;
    cards.push(
      favorite
        ? {
            key: 'saved',
            title: 'Seus favoritos',
            product: favorite,
            note: saved.length > 1 ? `e mais ${saved.length - 1} ${saved.length === 2 ? 'salvo' : 'salvos'}` : undefined,
            cta: 'Ver favoritos',
            link: ['/tabs/saved'],
          }
        : {
            key: 'saved',
            title: 'Seus favoritos',
            icon: 'heart-outline',
            text: 'Salve os produtos que gostar para achar depois.',
            cta: 'Ver favoritos',
            link: ['/tabs/saved'],
          }
    );

    shown.add(favorite?.id);

    const freeShipping = firstUnseen(this.freeShipping());
    if (freeShipping) {
      cards.push({
        key: 'free-shipping',
        title: 'Frete grátis',
        product: freeShipping,
        cta: 'Ver todos',
        link: ['/tabs/tab2'],
        queryParams: { frete: 1 },
      });
    }

    cards.push({
      key: 'sell',
      title: 'Venda no Vineon',
      icon: 'pricetag-outline',
      text: 'Cadastre fotos, preço e forma de envio do seu produto.',
      cta: 'Anunciar produto',
      link: ['/tabs/upload-product'],
    });

    return cards;
  });

  // ---- Resultados ----

  readonly results = computed(() => sortProducts(filterProducts(this.products(), this.filters(), [], this.appConfig.freeShippingRule()), this.filters()));
  readonly visibleResults = computed(() => this.results().slice(0, this.visibleCount()));

  /** Contagem por categoria com os outros filtros aplicados, como no Mercado Livre. */
  readonly categoryFacets = computed(() => {
    const filters = this.filters();
    const base = filterProducts(this.products(), filters, ['cat'], this.appConfig.freeShippingRule());
    return this.categories()
      .map(category => ({
        category,
        count: base.filter(p => p.categoryIds?.includes(category.id)).length,
      }))
      .filter(facet => facet.count > 0 || facet.category.id === filters.cat);
  });

  readonly priceRanges = computed(() => priceRanges(filterProducts(this.products(), this.filters(), ['min', 'max'], this.appConfig.freeShippingRule())));

  readonly resultsTitle = computed(() => {
    const f = this.filters();
    if (f.q) return f.q;
    if (f.cat) return this.categories().find(c => c.id === f.cat)?.name ?? 'Categoria';
    if (f.ofertas) return 'Ofertas';
    if (f.frete) return 'Frete grátis';
    if (f.ordem === 'mais-vendidos') return 'Mais vendidos';
    return 'Produtos';
  });

  readonly activeChips = computed(() => {
    const f = this.filters();
    const chips: Array<{ key: string; label: string; remove: QueryPatch }> = [];
    const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    if (f.q) chips.push({ key: 'q', label: `“${f.q}”`, remove: { q: null } });
    if (f.cat) {
      const name = this.categories().find(c => c.id === f.cat)?.name ?? 'Categoria';
      chips.push({ key: 'cat', label: name, remove: { cat: null } });
    }
    if (f.frete) chips.push({ key: 'frete', label: 'Frete grátis', remove: { frete: null } });
    if (f.ofertas) chips.push({ key: 'ofertas', label: 'Com desconto', remove: { ofertas: null } });
    if (f.min != null || f.max != null) {
      const label =
        f.min != null && f.max != null ? `${brl(f.min)} a ${brl(f.max)}`
        : f.min != null ? `A partir de ${brl(f.min)}`
        : `Até ${brl(f.max as number)}`;
      chips.push({ key: 'price', label, remove: { min: null, max: null } });
    }
    return chips;
  });

  constructor() {
    // Filtro novo = lista nova: volta ao topo e à primeira página.
    let previousFilters: string | null = null;
    effect(() => {
      const current = JSON.stringify(this.filters());
      untracked(() => {
        if (previousFilters !== null && previousFilters !== current) {
          this.visibleCount.set(PAGE_SIZE);
          this.content?.scrollToTop(0);
        }
        previousFilters = current;
      });
    });

    // A Tab2 fica em cache pelo Ionic; relê o histórico ao voltar de um produto.
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => this.recentIds.set(getRecentlyViewedIds()));
  }

  setFilters(patch: QueryPatch) {
    this.router.navigate([], { relativeTo: this.route, queryParams: patch, queryParamsHandling: 'merge' });
  }

  toggleFlag(key: 'frete' | 'ofertas', event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.setFilters({ [key]: checked ? 1 : null });
  }

  setSort(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.setFilters({ ordem: value === 'relevancia' ? null : value });
  }

  applyPrice(event: Event, min: string, max: string) {
    event.preventDefault();
    const toParam = (raw: string) => (raw.trim() === '' || Number(raw) < 0 ? null : Number(raw));
    this.setFilters({ min: toParam(min), max: toParam(max) });
  }

  clearFilters() {
    this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  showMore() {
    this.visibleCount.update(count => count + PAGE_SIZE);
  }

  priceLabel(product: Product): string {
    return priceMain(product).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  discountOf(product: Product): number {
    return discountPercent(product);
  }
}

function createdAtSeconds(product: Product): number {
  const createdAt = product.createdAt;
  if (!createdAt) return 0;
  if (typeof createdAt.seconds === 'number') return createdAt.seconds;
  const time = new Date(createdAt).getTime();
  return Number.isNaN(time) ? 0 : time / 1000;
}
