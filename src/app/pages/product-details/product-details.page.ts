import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Observable, Subject, combineLatest, from, of } from 'rxjs';
import { map, shareReplay, switchMap, takeUntil, take } from 'rxjs/operators';
import { 
  IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton, 
  IonFooter, IonButton, IonIcon, IonModal, IonCard, IonSpinner, IonImg, IonText, IonThumbnail, IonLabel, IonItem
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { heart, heartOutline, bagAddOutline, addCircleOutline, chatbubblesOutline, star, checkmarkCircle, gridOutline, closeCircle, cart, flash, chevronForwardOutline, ribbon, chatbubbleEllipsesOutline, bicycleOutline } from 'ionicons/icons';

import { Product } from 'src/app/interfaces/product';
import { ProductSelectionService } from 'src/app/services/product-selection-service';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseChatService } from 'src/app/services/firebase-chat.service';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { FirebaseSavedService } from 'src/app/services/firebase-saved.service';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { PublicSellerProfile } from 'src/app/interfaces/seller';

import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { ProductSelectorComponent } from 'src/app/components/product-selector/product-selector.component';
import { ChatBoxComponent } from 'src/app/components/chat-box/chat-box.component';
import { trackById } from 'src/app/core/track-by';

@Component({
  selector: 'app-product-details',
  templateUrl: './product-details.page.html',
  styleUrls: ['./product-details.page.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton, 
    IonFooter, IonButton, IonIcon, IonModal, IonCard, IonSpinner, 
    MiniHeaderComponent, ProductSelectorComponent, ChatBoxComponent
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class ProductDetailsPage implements OnInit, OnDestroy {
  /** trackBy padrao — evita recriar a lista inteira a cada emissao. */
  public trackById = trackById;

  public product$: Observable<Product | null>;
  public relatedProducts$: Observable<Product[]>;
  /**
   * Lista do seletor de fallback, exibido so quando a rota vem sem id.
   * E uma pagina limitada — nao o catalogo inteiro.
   */
  public allProducts$: Observable<Product[]>;
  public seller$: Observable<PublicSellerProfile | null>;
  public sellerProducts$: Observable<Product[]>;
  public sellerStats$: Observable<{ productCount: number; soldCount: number; averageRating: number | null; activeProductCount: number }>;
  public sellerFollowerCount$: Observable<number>;
  public isFollowingSeller$: Observable<boolean>;
  public cartQuantity$: Observable<number>;
  public isSaved = false;
  public isFollowActionBusy = false;
  public isFollowingSeller = false;
  public currentUserId = '';
  private destroy$ = new Subject<void>();

  public isChatOpen = false;
  public activeChatId = '';

  constructor(
    private selectionService: ProductSelectionService, 
    private router: Router,
    private fbProducts: FirebaseProducts,
    private chatService: FirebaseChatService,
    private cartService: FirebaseCartService,
    private savedService: FirebaseSavedService,
    private fbUsers: FirebaseUsersService,
    private route: ActivatedRoute
  ) {
    addIcons({ heart, heartOutline, bagAddOutline, addCircleOutline, chatbubblesOutline, star, checkmarkCircle, gridOutline, closeCircle, cart, flash, chevronForwardOutline, ribbon, chatbubbleEllipsesOutline, bicycleOutline });
    this.currentUserId = this.fbProducts.getUser()?.uid || '';
    
    this.product$ = this.route.params.pipe(
      switchMap(params => {
        const id = params['id'];
        if (id) {
          return this.fbProducts.getById(id);
        }
        return this.selectionService.selectedProduct$;
      })
    );

    this.allProducts$ = from(this.fbProducts.getPage({ pageSize: 50 })).pipe(
      map(page => page.products),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Relacionados vem de uma consulta por categoria com `limit`. Antes esta
    // tela baixava a colecao `products` inteira e jogava fora tudo menos 10.
    this.relatedProducts$ = this.product$.pipe(
      switchMap(current => this.fbProducts.getRelated(current, 10)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Perfil PUBLICO do vendedor (`sellers/{uid}`), nao o documento pessoal.
    // `users/{uid}` guarda CPF, telefone e endereco e nao tem leitura publica.
    this.seller$ = this.product$.pipe(
      switchMap(p => {
        if (p && p.sellerId) {
          return from(this.fbUsers.getPublicSellerProfile(p.sellerId));
        }
        return of(null);
      })
    );

    this.sellerProducts$ = this.product$.pipe(
      switchMap(p => p?.sellerId ? this.fbProducts.getBySeller(p.sellerId) : of([]))
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
      })
    );

    this.sellerFollowerCount$ = this.product$.pipe(
      switchMap(p => p?.sellerId ? this.fbUsers.getSellerFollowerCount(p.sellerId) : of(0))
    );

    this.isFollowingSeller$ = this.product$.pipe(
      switchMap(p => p?.sellerId ? this.fbUsers.isFollowingSeller(p.sellerId) : of(false))
    );

    this.cartQuantity$ = combineLatest([
      this.product$,
      this.cartService.getAllCartItems()
    ]).pipe(
      map(([product, cartItems]) => {
        if (!product || !cartItems) return 0;
        const item = cartItems.find(i => i.productId === product.id);
        return item ? item.quantity : 0;
      })
    );
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit() {
    this.currentUserId = this.fbProducts.getUser()?.uid || this.currentUserId;

    this.isFollowingSeller$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isFollowing => {
        this.isFollowingSeller = isFollowing;
      });

    this.product$.pipe(takeUntil(this.destroy$)).subscribe(async p => {
      if (p && p.id) {
        this.selectionService.setSelectedProduct(p);
        this.isSaved = await this.savedService.isProductSaved(p.id);
      }
    });
  }

  public onProductSelect(productId: string) {
    // `take(1)` encerra sozinho: antes cada clique deixava uma inscricao viva.
    this.fbProducts.getById(productId).pipe(
      take(1),
      takeUntil(this.destroy$)
    ).subscribe(selected => {
      if (selected) {
        this.selectionService.setSelectedProduct(selected);
      }
    });
  }

  public async startChat(product: Product, seller?: PublicSellerProfile | null) {
    if (!product.sellerId) {
      console.error("Produto sem vendedor definido.");
      return; 
    }

    try {
      const chatId = await this.chatService.startChat(
        {
          uid: product.sellerId,
          name: seller?.shopName || seller?.displayName || 'Vendedor do Anúncio',
          photoUrl: seller?.photoURL || undefined
        },
        { id: product.id!, name: product.name, photo: product.photoURL?.[0] }
      );
      this.activeChatId = chatId;
      this.isChatOpen = true;
    } catch (e) {
       console.error("Falha ao iniciar chat", e);
    }
  }

  public closeChat() {
    this.isChatOpen = false;
    this.activeChatId = '';
  }

  public async goToCheckout() {
    const product = this.selectionService.getCurrentProduct();
    if (product) {
      try {
        await this.cartService.addToCart(product, 1);
      } catch (e) {
        console.error('Erro ao adicionar ao carrinho:', e);
      }
    }
    this.router.navigate(['/tabs/cart']);
  }

  public async toggleFavorite() {
    const product = this.selectionService.getCurrentProduct();
    if (!product || !product.id) return;

    try {
      if (this.isSaved) {
        await this.savedService.removeByProductId(product.id);
        this.isSaved = false;
      } else {
        await this.savedService.saveProduct(product);
        this.isSaved = true;
      }
    } catch (e) {
      console.error('Erro ao alternar favorito:', e);
    }
  }

  public getFloating(number: number): string {
    const transformedNumber = number.toFixed(2);
    const parts = transformedNumber.split('.');
    return parts[1];
  }

  public goToProduct(product: Product) {
    this.selectionService.setSelectedProduct(product);
    this.router.navigate(['/product-details', product.id]);
  }

  public goToSellerProfile(sellerId?: string) {
    if (!sellerId) return;
    this.router.navigate(['/seller-profile', sellerId]);
  }

  public getSellerInitials(seller: PublicSellerProfile | null): string {
    const source = seller?.shopName || seller?.displayName || seller?.username || 'VC';
    return source
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0])
      .join('')
      .toUpperCase() || 'VC';
  }

  public formatCount(value: number): string {
    return value.toLocaleString('pt-BR');
  }

  public formatCompactCount(value: number): string {
    return value.toLocaleString('pt-BR', {
      notation: 'compact',
      maximumFractionDigits: 1
    });
  }

  public formatRating(value: number | null): string {
    return value === null ? '-' : value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  public getPaymentMethodsLabel(product: Product): string {
    const methods = product.paymentMethods || [];
    return methods.length ? methods.join(', ') : 'Não informado';
  }

  public isOwnSeller(seller: PublicSellerProfile | null): boolean {
    return !!seller?.uid && seller.uid === this.currentUserId;
  }

  public async toggleFollowSeller(seller: PublicSellerProfile, event?: Event) {
    event?.stopPropagation();
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
    } finally {
      this.isFollowActionBusy = false;
    }
  }

  public getDiscountPercent(price: number, priceDiscounted?: number): number | null {
    if (!priceDiscounted || priceDiscounted <= price) return null;
    return Math.round((1 - price / priceDiscounted) * 100);
  }

  public priceOrganize(price:any, priceDiscounted:any) : number {
    return price || priceDiscounted;
  }
}
