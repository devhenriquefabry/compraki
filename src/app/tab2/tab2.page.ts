import { Component, inject, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { IonModal } from '@ionic/angular';
import { Router } from '@angular/router';
import { Product } from '../interfaces/product';
import { ProductSelectionService } from '../services/product-selection-service';
import { FirebaseProducts } from '../services/firebase-products';
import { FirebaseCategories } from '../services/firebase-categories';
import { BannerService } from '../services/banner.service';
import { Banner } from '../interfaces/banner';
import { Category } from '../interfaces/category';
import { Subscription, Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { trackById } from 'src/app/core/track-by';
import { LayoutService } from '../core/layout.service';
import { discountPercent, hasDiscount, hasFreeShipping, installmentHint, priceMain } from '../core/product-pricing';
import { AppConfigService } from '../services/app-config.service';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: false
})
export class Tab2Page implements OnInit, OnDestroy {
  /** trackBy padrao — evita recriar a lista inteira a cada emissao. */
  public trackById = trackById;


  @ViewChild('bannerContainer', { static: false }) bannerContainer!: ElementRef;
  @ViewChild(IonModal) modal!: IonModal;

  public categories$!: Observable<Category[]>;
  /** Primeiro retorno de cada fonte: até lá a home de celular mostra esqueleto, não estado vazio. */
  public categoriesLoaded = false;
  /** Lista da grade de categorias do celular (assinada aqui: o esqueleto esconde a grade até ela chegar). */
  public categories: Category[] = [];
  private categoriesSub?: Subscription;
  public bannersLoaded = false;
  /** Quantos cards/itens o esqueleto desenha. */
  public readonly skeletonCards = [0, 1, 2, 3, 4, 5];
  public readonly skeletonCategories = [0, 1, 2, 3, 4];

  public currentBannerIndex = 0;
  public allProducts: Product[] = [];
  /** Vira `true` no primeiro retorno do catálogo (a home de desktop mostra esqueleto até lá). */
  public productsLoaded = false;
  public filteredProducts: Product[] = [];
  public activeBanners: Banner[] = [];
  private bannerSub?: Subscription;
  
  // Estados de Filtro
  public searchTerm: string = '';
  public minPrice: number | null = null;
  public maxPrice: number | null = null;
  public selectedCategory: string = 'Todas';
  public sortOrder: string = 'relevancia';
  public onlyFreeShipping: boolean = false;
  private bannerInterval: any;

  private productSub!: Subscription;
  private fbProducts = inject(FirebaseProducts);
  private fbCategories = inject(FirebaseCategories);
  private bannerService = inject(BannerService);
  private selectionService = inject(ProductSelectionService);
  private router = inject(Router);
  private appConfig = inject(AppConfigService);
  /** No navegador em tela larga a Tab2 vira a home de site (`app-desktop-home`). */
  public layout = inject(LayoutService);

  constructor() {}

  ngOnInit() {
    this.productSub = this.fbProducts.getAll().subscribe(products => {
      this.allProducts = products;
      this.productsLoaded = true;
      this.applyFilters();
    });

    // Um listener só para os três lugares que usam a lista (grade, filtro e desktop).
    this.categories$ = this.fbCategories.getAll().pipe(
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.categoriesSub = this.categories$.subscribe(categories => {
      this.categories = categories;
      this.categoriesLoaded = true;
    });

    // Carrega banners ativos do Firestore
    this.bannerSub = this.bannerService.getActiveBanners().subscribe(banners => {
      this.activeBanners = banners;
      this.bannersLoaded = true;
      this.currentBannerIndex = 0;
    });

    // Auto-scroll do carrossel
    this.bannerInterval = setInterval(() => {
      if (this.bannerContainer && this.activeBanners.length > 1) {
        const container = this.bannerContainer.nativeElement;
        this.currentBannerIndex = (this.currentBannerIndex + 1) % this.activeBanners.length;

        container.scrollTo({
          left: this.currentBannerIndex * container.clientWidth,
          behavior: 'smooth'
        });
      }
    }, 4000);
  }

  ngOnDestroy() {
    if (this.productSub) {
      this.productSub.unsubscribe();
    }
    this.bannerSub?.unsubscribe();
    this.categoriesSub?.unsubscribe();
    if (this.bannerInterval) {
      clearInterval(this.bannerInterval);
    }
  }

  public applyFilters(closeAfter: boolean = false) {
    let result = [...this.allProducts];

    // Busca por texto
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(term) || p.description?.toLowerCase().includes(term));
    }

    // Filtro de Categoria
    if (this.selectedCategory !== 'Todas') {
      result = result.filter(p => p.categoryIds?.includes(this.selectedCategory));
    }

    // Filtro de Preço
    if (this.minPrice !== null) result = result.filter(p => p.price >= (this.minPrice as number));
    if (this.maxPrice !== null) result = result.filter(p => p.price <= (this.maxPrice as number));

    // Frete Grátis
    if (this.onlyFreeShipping) {
      const rule = this.appConfig.freeShippingRule();
      result = result.filter(p => hasFreeShipping(p, rule));
    }

    // Ordenação
    if (this.sortOrder === 'preco-menor') result.sort((a, b) => a.price - b.price);
    if (this.sortOrder === 'preco-maior') result.sort((a, b) => b.price - a.price);

    this.filteredProducts = result;
    
    // Fecha o modal se solicitado
    if (closeAfter && this.modal) {
      this.modal.dismiss();
    }
  }

  public clearFilters(closeAfter: boolean = false) {
    this.searchTerm = '';
    this.minPrice = null;
    this.maxPrice = null;
    this.selectedCategory = 'Todas';
    this.sortOrder = 'relevancia';
    this.onlyFreeShipping = false;
    this.applyFilters();

    // Fecha o modal se solicitado
    if (closeAfter && this.modal) {
      this.modal.dismiss();
    }
  }

  public filterByCategory(id: string) {
    this.selectedCategory = id;
    this.applyFilters();
  }

  get featuredOffers(): Product[] {
    return this.filteredProducts.slice(0, 4);
  }

  get recommendations(): Product[] {
    return this.filteredProducts.slice(4);
  }

  public selectProduct(product: Product) {
    this.selectionService.setSelectedProduct(product);
    this.router.navigate(['/product-details', product.id]);
  }

  // Regras de preço compartilhadas com a vitrine de desktop (core/product-pricing).
  public priceMain = priceMain;
  public hasDiscount = hasDiscount;
  public discountPercent = discountPercent;
  public installmentHint = installmentHint;

  /** Selo de frete grátis: do vendedor ou da regra da loja (painel admin). */
  public freeShipping(product: Product): boolean {
    return hasFreeShipping(product, this.appConfig.freeShippingRule());
  }

  public getIcon(icon: any): string {
    if (typeof icon === 'string' && icon.trim() !== '') {
      return icon;
    }
    return 'folder-outline';
  }

}
