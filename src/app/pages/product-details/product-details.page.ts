import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA, ElementRef, NgZone, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, Subject, combineLatest, firstValueFrom, from, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, startWith, switchMap, takeUntil, take } from 'rxjs/operators';
import {
  IonContent, IonHeader, IonTitle, IonToolbar, IonButtons,
  IonFooter, IonButton, IonIcon, IonModal, IonSpinner, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  heart, heartOutline, bagAddOutline, addCircleOutline, chatbubblesOutline, star, starOutline, checkmarkCircle,
  closeCircle, cart, chevronForwardOutline, chevronBackOutline, chevronDown, chatbubbleEllipsesOutline, chatboxEllipsesOutline,
  shieldCheckmarkOutline, returnDownBackOutline, cubeOutline, locationOutline, shareSocialOutline, removeOutline, addOutline,
  flashOutline, giftOutline, cardOutline, cashOutline, qrCodeOutline, storefrontOutline, ribbonOutline, closeOutline,
  createOutline, informationCircleOutline, timeOutline, pricetagOutline
} from 'ionicons/icons';

import { Product, ProductSpec } from 'src/app/interfaces/product';
import { findSku, variantAttributeNames, variantLabel } from 'src/app/core/product-variants';
import { Category } from 'src/app/interfaces/category';
import { ProductSelectionService } from 'src/app/services/product-selection-service';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseChatService } from 'src/app/services/firebase-chat.service';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { FirebaseSavedService } from 'src/app/services/firebase-saved.service';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { FirebaseCategories } from 'src/app/services/firebase-categories';
import { PublicSellerProfile } from 'src/app/interfaces/seller';

import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { ProductSelectorComponent } from 'src/app/components/product-selector/product-selector.component';
import { ChatBoxComponent } from 'src/app/components/chat-box/chat-box.component';
import { ProductRailComponent } from 'src/app/components/product-rail/product-rail.component';
import { ProductGalleryComponent } from 'src/app/components/product-gallery/product-gallery.component';
import { ProductReviewsComponent } from 'src/app/components/product-reviews/product-reviews.component';
import { rememberViewedProduct } from 'src/app/core/recently-viewed';
import { discountPercent, hasDiscount, priceMain } from 'src/app/core/product-pricing';
import { LayoutService } from 'src/app/core/layout.service';
import { requireAccount } from 'src/app/core/auth-redirect';
import { onAuthUserChanged } from 'src/app/core/auth-state';

/** Rótulos de condição como o comprador lê. */
const CONDITION_LABELS: Record<Product['condition'], string> = {
  'novo': 'Novo',
  'usado-como-novo': 'Usado · como novo',
  'usado-bom': 'Usado · bom estado',
  'usado-aceitavel': 'Usado · aceitável',
};

const PAYMENT_META: Record<string, { label: string; icon: string }> = {
  'PIX': { label: 'Pix', icon: 'qr-code-outline' },
  'CARTÃO': { label: 'Cartão de crédito', icon: 'card-outline' },
  'DINHEIRO': { label: 'Dinheiro', icon: 'cash-outline' },
};

interface SellerStats {
  productCount: number;
  soldCount: number;
  averageRating: number | null;
  activeProductCount: number;
}

/**
 * Página do produto, no molde dos grandes marketplaces:
 *
 *  Desktop  galeria | informações | caixa de compra (fixa ao rolar)
 *           características · descrição · opiniões  |  vendedor · pagamento
 *           relacionados · mais do vendedor
 *
 *  Celular  título e nota acima das fotos, preço, compra inline, garantias,
 *           vendedor, seções empilhadas; a barra fixa de compra só aparece
 *           quando os botões inline saem da tela.
 *
 * Visitante sem conta vê tudo. Carrinho, favoritos, seguir e conversar pedem
 * login e trazem a pessoa de volta para cá (`requireAccount`).
 */
@Component({
  selector: 'app-product-details',
  templateUrl: './product-details.page.html',
  styleUrls: ['./product-details.page.scss'],
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    IonContent, IonHeader, IonTitle, IonToolbar, IonButtons,
    IonFooter, IonButton, IonIcon, IonModal, IonSpinner,
    MiniHeaderComponent, ProductSelectorComponent, ChatBoxComponent, ProductRailComponent,
    ProductGalleryComponent, ProductReviewsComponent
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class ProductDetailsPage implements OnInit, OnDestroy {
  public readonly layout = inject(LayoutService);
  private readonly titleService = inject(Title);
  private readonly toastCtrl = inject(ToastController);
  private readonly categoriesService = inject(FirebaseCategories);
  private readonly zone = inject(NgZone);

  public product$: Observable<Product | null>;
  /** `undefined` enquanto carrega; `null` quando o produto não existe. */
  public productState$: Observable<Product | null | undefined>;
  public relatedProducts$: Observable<Product[]>;
  /** Fallback exibido só quando a rota vem sem id. */
  public allProducts$: Observable<Product[]>;
  public seller$: Observable<PublicSellerProfile | null>;
  public sellerProducts$: Observable<Product[]>;
  public moreFromSeller$: Observable<Product[]>;
  public sellerStats$: Observable<SellerStats>;
  public sellerFollowerCount$: Observable<number>;
  public isFollowingSeller$: Observable<boolean>;
  public cartQuantity$: Observable<number>;
  public breadcrumb$: Observable<{ category: Category | null; subcategoryName: string | null }>;

  public isSaved = false;
  public isFollowActionBusy = false;
  public isFollowingSeller = false;
  public isAddingToCart = false;
  public currentUserId = '';
  public quantity = 1;
  /** Um valor por atributo escolhido pelo comprador, ex: { Cor: "Preto" }. */
  public selectedVariant: Record<string, string> = {};
  public descriptionExpanded = false;
  public specsExpanded = false;

  /** Celular: a barra fixa aparece quando os botões inline saem da tela. */
  public showStickyBuy = false;
  private buyObserver?: IntersectionObserver;

  public isChatOpen = false;
  public activeChatId = '';

  private destroy$ = new Subject<void>();
  private stopAuthWatch?: () => void;

  @ViewChild('inlineBuy') set inlineBuy(ref: ElementRef<HTMLElement> | undefined) {
    this.observeInlineBuy(ref?.nativeElement);
  }

  constructor(
    private selectionService: ProductSelectionService,
    private router: Router,
    private fbProducts: FirebaseProducts,
    private chatService: FirebaseChatService,
    private cartService: FirebaseCartService,
    private savedService: FirebaseSavedService,
    private fbUsers: FirebaseUsersService,
    public route: ActivatedRoute
  ) {
    addIcons({
      heart, heartOutline, bagAddOutline, addCircleOutline, chatbubblesOutline, star, starOutline, checkmarkCircle,
      closeCircle, cart, chevronForwardOutline, chevronBackOutline, chevronDown, chatbubbleEllipsesOutline, chatboxEllipsesOutline,
      shieldCheckmarkOutline, returnDownBackOutline, cubeOutline, locationOutline, shareSocialOutline, removeOutline, addOutline,
      flashOutline, giftOutline, cardOutline, cashOutline, qrCodeOutline, storefrontOutline, ribbonOutline, closeOutline,
      createOutline, informationCircleOutline, timeOutline, pricetagOutline
    });
    this.currentUserId = this.fbProducts.getUser()?.uid || '';

    const productId$ = this.route.params.pipe(map(params => params['id'] as string | undefined), distinctUntilChanged());

    this.productState$ = productId$.pipe(
      switchMap(id => id
        ? this.fbProducts.getById(id).pipe(
            catchError(() => of(null)),
            startWith(undefined as Product | null | undefined)
          )
        : this.selectionService.selectedProduct$),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.product$ = this.productState$.pipe(
      map(p => p ?? null),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.allProducts$ = from(this.fbProducts.getPage({ pageSize: 50 })).pipe(
      map(page => page.products),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Consultas que dependem só do id/vendedor não repetem a cada emissão do
    // produto em tempo real (estoque, nota recalculada...).
    const stableProduct$ = this.product$.pipe(
      distinctUntilChanged((a, b) => a?.id === b?.id && a?.sellerId === b?.sellerId),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.relatedProducts$ = stableProduct$.pipe(
      switchMap(current => this.fbProducts.getRelated(current, 12)),
      catchError(() => of([])),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Perfil PUBLICO do vendedor (`sellers/{uid}`), nao o documento pessoal.
    this.seller$ = stableProduct$.pipe(
      switchMap(p => p?.sellerId ? from(this.fbUsers.getPublicSellerProfile(p.sellerId)).pipe(catchError(() => of(null))) : of(null)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.sellerProducts$ = stableProduct$.pipe(
      switchMap(p => p?.sellerId ? this.fbProducts.getBySeller(p.sellerId).pipe(catchError(() => of([]))) : of([])),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.moreFromSeller$ = combineLatest([stableProduct$, this.sellerProducts$]).pipe(
      map(([current, products]) => products.filter(p => p.id !== current?.id && p.stock > 0).slice(0, 12))
    );

    this.sellerStats$ = this.sellerProducts$.pipe(
      map(products => {
        const ratings = products
          .map(product => product.rating)
          .filter((rating): rating is number => typeof rating === 'number' && !Number.isNaN(rating));

        return {
          productCount: products.length,
          soldCount: products.reduce((total, product) => total + (product.soldCount || 0), 0),
          averageRating: ratings.length ? ratings.reduce((total, rating) => total + rating, 0) / ratings.length : null,
          activeProductCount: products.filter(product => product.stock > 0).length
        };
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.sellerFollowerCount$ = stableProduct$.pipe(
      switchMap(p => p?.sellerId ? this.fbUsers.getSellerFollowerCount(p.sellerId).pipe(catchError(() => of(0))) : of(0)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.isFollowingSeller$ = stableProduct$.pipe(
      switchMap(p => p?.sellerId ? this.fbUsers.isFollowingSeller(p.sellerId).pipe(catchError(() => of(false))) : of(false)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.cartQuantity$ = combineLatest([
      this.product$,
      this.cartService.getAllCartItems().pipe(catchError(() => of([])))
    ]).pipe(
      map(([product, cartItems]) => {
        if (!product || !cartItems) return 0;
        const item = cartItems.find(i => i.productId === product.id);
        return item ? item.quantity : 0;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.breadcrumb$ = combineLatest([
      stableProduct$,
      this.categoriesService.getAll().pipe(catchError(() => of([] as Category[])), startWith([] as Category[]))
    ]).pipe(
      map(([product, categories]) => {
        const category = categories.find(c => c.id === product?.categoryIds?.[0]) ?? null;
        const sub = category?.subcategories?.find(s => s.id === product?.subcategoryIds?.[0]);
        return { category, subcategoryName: sub?.name ?? null };
      })
    );
  }

  ngOnInit() {
    this.isFollowingSeller$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isFollowing => this.isFollowingSeller = isFollowing);

    this.product$.pipe(
      distinctUntilChanged((a, b) => a?.id === b?.id),
      takeUntil(this.destroy$)
    ).subscribe(p => {
      if (!p?.id) return;
      this.selectionService.setSelectedProduct(p);
      rememberViewedProduct(p.id);
      this.quantity = 1;
      this.selectedVariant = {};
      this.descriptionExpanded = false;
      this.specsExpanded = false;
      this.titleService.setTitle(`${p.name} | Vineon`);
      void this.refreshSaved(p.id);
    });

    // Entrou ou saiu da conta com a página aberta: favoritos e dono mudam.
    this.stopAuthWatch = onAuthUserChanged(user => {
      this.currentUserId = user?.uid || '';
      const current = this.selectionService.getCurrentProduct();
      if (current?.id) void this.refreshSaved(current.id);
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopAuthWatch?.();
    this.buyObserver?.disconnect();
    this.titleService.setTitle('Vineon');
  }

  // ------------------------------------------------------------------ ações

  public decreaseQty() {
    this.quantity = Math.max(1, this.quantity - 1);
  }

  public increaseQty(product: Product) {
    this.quantity = Math.min(Math.max(1, this.effectiveStock(product) || 1), this.quantity + 1);
  }

  public async addToCart(product: Product) {
    if (!requireAccount(this.router) || this.isAddingToCart || !this.canBuy(product)) return;

    this.isAddingToCart = true;
    try {
      await this.cartService.addToCart(product, this.quantity, this.variantPayload(product));
      const toast = await this.toastCtrl.create({
        message: this.quantity > 1 ? `${this.quantity} unidades adicionadas ao carrinho.` : 'Adicionado ao carrinho.',
        duration: 3000,
        position: this.layout.isDesktop() ? 'top' : 'bottom',
        color: 'dark',
        buttons: [{ text: 'Ver carrinho', handler: () => { this.router.navigate(['/tabs/cart']); } }]
      });
      await toast.present();
    } catch (e) {
      console.error('Erro ao adicionar ao carrinho:', e);
      this.showToast('Não foi possível adicionar ao carrinho. Tente de novo.', 'danger');
    } finally {
      this.isAddingToCart = false;
    }
  }

  /** Compra direta: garante o item (nesta combinação) no carrinho e vai para o pagamento. */
  public async buyNow(product: Product) {
    if (!requireAccount(this.router) || this.isAddingToCart || !this.canBuy(product)) return;

    this.isAddingToCart = true;
    try {
      const variant = this.variantPayload(product);
      const cartItems = await firstValueFrom(this.cartService.getAllCartItems().pipe(catchError(() => of([]))));
      const alreadyInCart = cartItems.some(i => i.productId === product.id && (i.skuId || null) === (variant?.skuId || null));
      if (!alreadyInCart) {
        await this.cartService.addToCart(product, this.quantity, variant);
      }
      this.router.navigate(['/checkout']);
    } catch (e) {
      console.error('Erro ao iniciar compra:', e);
      this.showToast('Não foi possível iniciar a compra. Tente de novo.', 'danger');
    } finally {
      this.isAddingToCart = false;
    }
  }

  public async toggleFavorite(product: Product) {
    if (!requireAccount(this.router) || !product.id) return;

    const next = !this.isSaved;
    this.isSaved = next; // otimista: o coração responde na hora
    try {
      if (next) {
        await this.savedService.saveProduct(product);
      } else {
        await this.savedService.removeByProductId(product.id);
      }
    } catch (e) {
      this.isSaved = !next;
      console.error('Erro ao alternar favorito:', e);
      this.showToast('Não foi possível atualizar os favoritos.', 'danger');
    }
  }

  public async share(product: Product) {
    const url = window.location.href;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    try {
      if (nav.share) {
        await nav.share({ title: product.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      this.showToast('Link copiado.', 'dark');
    } catch {
      // Compartilhamento cancelado pela pessoa: nada a fazer.
    }
  }

  public async startChat(product: Product, seller?: PublicSellerProfile | null) {
    if (!requireAccount(this.router)) return;
    if (!product.sellerId) return;

    try {
      const chatId = await this.chatService.startChat(
        {
          uid: product.sellerId,
          name: seller?.shopName || seller?.displayName || 'Vendedor do anúncio',
          photoUrl: seller?.photoURL || undefined
        },
        { id: product.id!, name: product.name, photo: product.photoURL?.[0] }
      );
      this.activeChatId = chatId;
      this.isChatOpen = true;
    } catch (e: any) {
      console.error('Falha ao iniciar chat', e);
      this.showToast(e?.message || 'Não foi possível abrir a conversa.', 'danger');
    }
  }

  public closeChat() {
    this.isChatOpen = false;
    this.activeChatId = '';
  }

  public async toggleFollowSeller(seller: PublicSellerProfile, event?: Event) {
    event?.stopPropagation();
    if (!requireAccount(this.router)) return;
    if (this.isOwnSeller(seller) || this.isFollowActionBusy) return;

    this.isFollowActionBusy = true;
    try {
      if (this.isFollowingSeller) {
        await this.fbUsers.unfollowSeller(seller.uid);
      } else {
        await this.fbUsers.followSeller(seller);
      }
    } catch (error) {
      console.error('Falha ao atualizar seguimento do vendedor:', error);
      this.showToast('Não foi possível atualizar. Tente de novo.', 'danger');
    } finally {
      this.isFollowActionBusy = false;
    }
  }

  public goToSellerProfile(sellerId?: string) {
    if (!sellerId) return;
    this.router.navigate(['/seller-profile', sellerId]);
  }

  public editListing(product: Product) {
    this.router.navigate(['/edit-product', product.id]);
  }

  public onProductSelect(productId: string) {
    this.fbProducts.getById(productId).pipe(take(1), takeUntil(this.destroy$)).subscribe(selected => {
      if (selected) this.selectionService.setSelectedProduct(selected);
    });
  }

  public scrollToReviews(content: IonContent) {
    const target = document.getElementById('opinioes');
    if (target) content.scrollToPoint(0, target.offsetTop - 16, 400);
  }

  // --------------------------------------------------------------- exibição

  public priceMain = priceMain;
  public hasDiscount = hasDiscount;
  public discountPercent = discountPercent;

  /** Preço separado em reais e centavos, arredondado em centavos antes. */
  public priceParts(value: number): { reais: string; cents: string } {
    const totalCents = Math.round((value || 0) * 100);
    return {
      reais: Math.trunc(totalCents / 100).toLocaleString('pt-BR'),
      cents: String(totalCents % 100).padStart(2, '0')
    };
  }

  public formatMoney(value: number): string {
    return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  public savings(product: Product): string {
    return this.formatMoney(product.price - priceMain(product));
  }

  public conditionLabel(product: Product): string {
    return CONDITION_LABELS[product.condition] || 'Usado';
  }

  public isNew(product: Product): boolean {
    return product.condition === 'novo';
  }

  public paymentMethods(product: Product) {
    return (product.paymentMethods || []).map(m => ({ key: m, ...(PAYMENT_META[m] || { label: m, icon: 'cash-outline' }) }));
  }

  public canBuy(product: Product): boolean {
    if (this.isOwnProduct(product)) return false;
    if (product.hasVariants && !this.variantFullySelected(product)) return false;
    return this.effectiveStock(product) > 0;
  }

  public isOwnProduct(product: Product): boolean {
    return !!this.currentUserId && product.sellerId === this.currentUserId;
  }

  public stockLabel(product: Product): string {
    const stock = this.effectiveStock(product);
    if (stock <= 0) return 'Sem estoque';
    if (stock === 1) return 'Última unidade';
    if (stock <= 5) return `Últimas ${stock} unidades`;
    return `${stock} disponíveis`;
  }

  // ------------------------------------------------------------- variações

  /** Nomes dos atributos (ex: ["Cor", "Tamanho"]), na ordem cadastrada pelo vendedor. */
  public variantAttributeNames = variantAttributeNames;

  public variantValuesFor(product: Product, attrName: string): string[] {
    return product.variantAttributes?.find(a => a.name === attrName)?.values || [];
  }

  /** Foto associada a um valor do 1º atributo (ex: cor -> foto daquela cor). */
  public variantImageFor(product: Product, value: string): string | null {
    return product.variantImages?.[value] || null;
  }

  /**
   * Fotos da galeria: quando o 1º atributo (normalmente Cor) tem uma foto
   * associada ao valor escolhido, ela vai pra frente — a galeria já reage
   * sozinha a essa troca (ver efeito em `ProductGalleryComponent`).
   */
  public galleryPhotos(product: Product): string[] {
    const photos = product.photoURL || [];
    const firstAttr = product.variantAttributes?.[0]?.name;
    const value = firstAttr ? this.selectedVariant[firstAttr] : undefined;
    const variantPhoto = value ? this.variantImageFor(product, value) : null;
    if (!variantPhoto) return photos;
    return [variantPhoto, ...photos.filter(p => p !== variantPhoto)];
  }

  public selectVariantValue(attrName: string, value: string) {
    this.selectedVariant = { ...this.selectedVariant, [attrName]: value };
    this.quantity = 1;
  }

  public variantFullySelected(product: Product): boolean {
    if (!product.hasVariants) return true;
    return variantAttributeNames(product).every(name => !!this.selectedVariant[name]);
  }

  /**
   * Estoque da combinação escolhida — ou o estoque agregado do produto,
   * quando ele não tem variações. Sem variações, é exatamente `product.stock`
   * de antes; nada muda para o catálogo existente.
   */
  public effectiveStock(product: Product): number {
    if (!product.hasVariants) return product.stock ?? 0;
    const sku = findSku(product, this.selectedVariant);
    return sku ? Math.max(0, sku.stock) : 0;
  }

  /**
   * Se existe, entre as combinações compatíveis com a seleção atual mais este
   * valor, alguma com estoque — usado para "apagar" no seletor as opções que
   * não têm mais estoque dado o que já foi escolhido.
   */
  public isVariantValueAvailable(product: Product, attrName: string, value: string): boolean {
    const trial = { ...this.selectedVariant, [attrName]: value };
    const entries = Object.entries(trial);
    return Object.values(product.skus || {}).some(
      sku => sku.stock > 0 && entries.every(([name, val]) => sku.attributes[name] === val)
    );
  }

  private variantPayload(product: Product): { skuId: string; label: string; selection: Record<string, string>; price: number; stock: number } | undefined {
    if (!product.hasVariants) return undefined;
    const sku = findSku(product, this.selectedVariant);
    if (!sku) return undefined;
    return {
      skuId: sku.id,
      label: variantLabel(variantAttributeNames(product), this.selectedVariant),
      selection: { ...this.selectedVariant },
      price: sku.price ?? priceMain(product),
      stock: sku.stock
    };
  }

  public shippingInfo(product: Product): { title: string; detail: string; icon: string; highlight: boolean } {
    switch (product.shipping) {
      case 'Frete Grátis':
        return { title: 'Frete grátis', detail: 'O vendedor paga o envio para todo o Brasil.', icon: 'gift-outline', highlight: true };
      case 'Entrega Expressa':
        return { title: 'Entrega expressa', detail: 'Envio prioritário. Prazo e valor calculados no pagamento.', icon: 'flash-outline', highlight: true };
      default:
        return { title: 'Frete calculado no pagamento', detail: 'Informe o CEP no checkout para ver prazos e valores.', icon: 'cube-outline', highlight: false };
    }
  }

  /**
   * Ficha técnica: o que o vendedor preencheu mais o que o próprio anúncio já
   * sabe (condição, dimensões, peso). Nada é inventado — campo vazio não entra.
   */
  public specRows(product: Product): ProductSpec[] {
    const rows: ProductSpec[] = (product.specs || [])
      .filter(s => s?.label?.trim() && s?.value?.trim())
      .map(s => ({ label: s.label.trim(), value: s.value.trim() }));

    rows.push({ label: 'Condição', value: this.conditionLabel(product) });

    const dims = [product.width, product.height, product.length];
    if (dims.every(d => typeof d === 'number' && d > 0)) {
      rows.push({ label: 'Dimensões da embalagem', value: `${product.width} × ${product.height} × ${product.length} cm` });
    }
    if (typeof product.weight === 'number' && product.weight > 0) {
      const weight = product.weight < 1
        ? `${Math.round(product.weight * 1000)} g`
        : `${product.weight.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`;
      rows.push({ label: 'Peso com embalagem', value: weight });
    }
    if (product.location) rows.push({ label: 'Enviado de', value: product.location });

    return rows;
  }

  /** Destaques curtos ao lado do preço: condição, envio, estoque, ofertas. */
  public highlights(product: Product): string[] {
    const list: string[] = [];
    const brand = product.specs?.find(s => /^marca$/i.test(s.label?.trim()))?.value;
    const model = product.specs?.find(s => /^modelo$/i.test(s.label?.trim()))?.value;
    if (brand || model) list.push([brand, model].filter(Boolean).join(' · '));
    list.push(this.isNew(product) ? 'Produto novo, nunca usado.' : `Produto usado, em estado ${this.conditionLabel(product).split('· ')[1] || 'informado pelo vendedor'}.`);
    if (product.acceptOffers) list.push('O vendedor aceita propostas pelo chat.');
    return list;
  }

  public descriptionIsLong(product: Product): boolean {
    return (product.description?.length || 0) > 420;
  }

  public getSellerInitials(seller: PublicSellerProfile | null): string {
    const source = seller?.shopName || seller?.displayName || seller?.username || 'VN';
    return source.split(' ').filter(Boolean).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase() || 'VN';
  }

  public sellerName(seller: PublicSellerProfile | null): string {
    return seller?.shopName || seller?.displayName || 'Loja Vineon';
  }

  public sellerSince(seller: PublicSellerProfile | null): string | null {
    const raw = seller?.createdAt;
    const date: Date | null = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    return date.getFullYear().toString();
  }

  public formatCount(value: number): string {
    return (value || 0).toLocaleString('pt-BR');
  }

  public formatCompactCount(value: number): string {
    return (value || 0).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  }

  public formatRating(value: number | null | undefined): string {
    return value == null ? '–' : value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  public starFill(rating: number, star: number): number {
    return Math.max(0, Math.min(1, rating - (star - 1)));
  }

  public isOwnSeller(seller: PublicSellerProfile | null): boolean {
    return !!seller?.uid && seller.uid === this.currentUserId;
  }

  // ---------------------------------------------------------------- interno

  private async refreshSaved(productId: string) {
    try {
      this.isSaved = await this.savedService.isProductSaved(productId);
    } catch {
      this.isSaved = false;
    }
  }

  private observeInlineBuy(el?: HTMLElement) {
    this.buyObserver?.disconnect();
    this.buyObserver = undefined;
    if (!el || typeof IntersectionObserver === 'undefined') {
      this.showStickyBuy = false;
      return;
    }
    this.buyObserver = new IntersectionObserver(([entry]) => {
      // Só mostra depois que os botões passaram para cima (não antes de chegar neles).
      const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      if (show !== this.showStickyBuy) this.zone.run(() => this.showStickyBuy = show);
    });
    this.buyObserver.observe(el);
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toastCtrl.create({ message, color, duration: 2600, position: 'bottom' });
    await toast.present();
  }
}

