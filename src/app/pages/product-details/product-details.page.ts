import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Observable, Subject, combineLatest, from, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';
import { 
  IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton, 
  IonFooter, IonButton, IonIcon, IonModal, IonCard, IonSpinner, IonImg, IonText, IonThumbnail, IonLabel, IonItem
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { heart, heartOutline, bagAddOutline, addCircleOutline, chatbubblesOutline, star, checkmarkCircle, gridOutline, closeCircle, cart } from 'ionicons/icons';

import { Product } from 'src/app/interfaces/product';
import { ProductSelectionService } from 'src/app/services/product-selection-service';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseChatService } from 'src/app/services/firebase-chat.service';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { FirebaseSavedService } from 'src/app/services/firebase-saved.service';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { AppUser } from 'src/app/interfaces/app-user';

import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { ProductSelectorComponent } from 'src/app/components/product-selector/product-selector.component';
import { ChatBoxComponent } from 'src/app/components/chat-box/chat-box.component';

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
  public product$: Observable<Product | null>;
  public allProducts$: Observable<Product[]>;
  public seller$: Observable<AppUser | null>;
  public cartQuantity$: Observable<number>;
  public isSaved = false;
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
    addIcons({ heart, heartOutline, bagAddOutline, addCircleOutline, chatbubblesOutline, star, checkmarkCircle, gridOutline, closeCircle, cart });
    
    this.product$ = this.route.params.pipe(
      switchMap(params => {
        const id = params['id'];
        if (id) {
          return this.fbProducts.getById(id);
        }
        return this.selectionService.selectedProduct$;
      })
    );

    this.allProducts$ = this.fbProducts.getAll();

    this.seller$ = this.product$.pipe(
      switchMap(p => {
        if (p && p.sellerId) {
          return from(this.fbUsers.getUserById(p.sellerId));
        }
        return of(null);
      })
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
    this.product$.pipe(takeUntil(this.destroy$)).subscribe(async p => {
      if (p && p.id) {
        this.selectionService.setSelectedProduct(p);
        this.isSaved = await this.savedService.isProductSaved(p.id);
      }
    });
  }

  public onProductSelect(productId: string) {
    this.allProducts$.pipe(takeUntil(this.destroy$)).subscribe(products => {
      const selected = products.find(p => p.id === productId);
      if (selected) {
        this.selectionService.setSelectedProduct(selected);
      }
    });
  }

  public async startChat(product: Product) {
    if (!product.sellerId) {
      console.error("Produto sem vendedor definido.");
      return; 
    }

    try {
      const chatId = await this.chatService.startChat(
         { uid: product.sellerId, name: 'Vendedor do Anúncio' },
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

  public priceOrganize(price:any, priceDiscounted:any) : number {
    return price || priceDiscounted;
  }
}
