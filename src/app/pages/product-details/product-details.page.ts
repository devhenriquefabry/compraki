import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subject, combineLatest } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { Product } from 'src/app/interfaces/product';
import { ProductSelectionService } from 'src/app/services/product-selection-service';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseChatService } from 'src/app/services/firebase-chat.service';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { FirebaseSavedService } from 'src/app/services/firebase-saved.service';
import { addIcons } from 'ionicons';
import { heart, heartOutline, bagAddOutline, addCircleOutline, chatbubblesOutline, star, checkmarkCircle, gridOutline } from 'ionicons/icons';

@Component({
  selector: 'app-product-details',
  templateUrl: './product-details.page.html',
  styleUrls: ['./product-details.page.scss'],
  standalone: false
})
export class ProductDetailsPage implements OnInit {
  public product$: Observable<Product | null>;
  public allProducts$: Observable<Product[]>;
  public cartQuantity$: Observable<number>;
  public isSaved = false;
  private destroy$ = new Subject<void>();


  constructor(
    private selectionService: ProductSelectionService, 
    private router: Router,
    private fbProducts: FirebaseProducts,
    private chatService: FirebaseChatService,
    private cartService: FirebaseCartService,
    private savedService: FirebaseSavedService
  ) {
    addIcons({ heart, heartOutline, bagAddOutline, addCircleOutline, chatbubblesOutline, star, checkmarkCircle, gridOutline });
    // Liga a variável local ao Observable do serviço
    this.product$ = this.selectionService.selectedProduct$;
    this.allProducts$ = this.fbProducts.getAll();

    // Monitorar a quantidade deste produto no carrinho
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
    // Monitorar se o produto está salvo
    this.product$.subscribe(async p => {
      if (p && p.id) {
        this.isSaved = await this.savedService.isProductSaved(p.id);
      }
    });
  }

  public onProductSelect(productId: string) {
    this.allProducts$.subscribe(products => {
      const selected = products.find(p => p.id === productId);
      if (selected) {
        this.selectionService.setSelectedProduct(selected);
      }
    });
  }

  public async startChat(product: Product) {
    if (!product.sellerId) {
      console.error("Produto sem vendedor definido.");
      return; // Could show a toast here
    }

    try {
      const chatId = await this.chatService.startChat(
         { uid: product.sellerId, name: 'Vendedor do Anúncio' },
         { id: product.id!, name: product.name, photo: product.photoURL?.[0] }
      );
      this.router.navigate(['/chat-details', chatId]);
    } catch (e) {
       console.error("Falha ao iniciar chat", e);
    }
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

