import { Component, inject, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { Product } from '../interfaces/product';
import { ProductSelectionService } from '../services/product-selection-service';
import { FirebaseProducts } from '../services/firebase-products';
import { FirebaseCategories } from '../services/firebase-categories';
import { BannerService } from '../services/banner.service';
import { Banner } from '../interfaces/banner';
import { Category } from '../interfaces/category';
import { Subscription, Observable } from 'rxjs';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: false
})
export class Tab2Page implements OnInit, OnDestroy {

  @ViewChild('bannerContainer', { static: false }) bannerContainer!: ElementRef;

  public categories$!: Observable<Category[]>;

  public currentBannerIndex = 0;
  private allProducts: Product[] = [];
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

  constructor() {}

  ngOnInit() {
    this.productSub = this.fbProducts.getAll().subscribe(products => {
      this.allProducts = products;
      this.applyFilters();
    });

    this.categories$ = this.fbCategories.getAll();

    // Carrega banners ativos do Firestore
    this.bannerSub = this.bannerService.getActiveBanners().subscribe(banners => {
      this.activeBanners = banners;
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
    if (this.bannerInterval) {
      clearInterval(this.bannerInterval);
    }
  }

  public applyFilters() {
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
      result = result.filter(p => p.shipping === 'Frete Grátis');
    }

    // Ordenação
    if (this.sortOrder === 'preco-menor') result.sort((a, b) => a.price - b.price);
    if (this.sortOrder === 'preco-maior') result.sort((a, b) => b.price - a.price);

    this.filteredProducts = result;
  }

  public clearFilters() {
    this.searchTerm = '';
    this.minPrice = null;
    this.maxPrice = null;
    this.selectedCategory = 'Todas';
    this.sortOrder = 'relevancia';
    this.onlyFreeShipping = false;
    this.applyFilters();
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

  /** Preço exibido (promo ou cheio) */
  public priceMain(product: Product): number {
    const d = product.priceDiscounted;
    if (d != null && d > 0 && d < product.price) {
      return d;
    }
    return product.price;
  }

  public hasDiscount(product: Product): boolean {
    return (
      product.priceDiscounted != null &&
      product.priceDiscounted > 0 &&
      product.price > 0 &&
      product.priceDiscounted < product.price
    );
  }

  public discountPercent(product: Product): number {
    if (!this.hasDiscount(product)) {
      return 0;
    }
    return Math.round((1 - (product.priceDiscounted as number) / product.price) * 100);
  }

  /** Texto tipo Mercado Livre: parcela sugerida (informativo) */
  public installmentHint(product: Product): string | null {
    const total = this.priceMain(product);
    if (total < 30) {
      return null;
    }
    const per12 = total / 12;
    const formatted = per12.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `12x R$ ${formatted}`;
  }

  public getIcon(icon: any): string {
    if (typeof icon === 'string' && icon.trim() !== '') {
      return icon;
    }
    return 'folder-outline';
  }

}
