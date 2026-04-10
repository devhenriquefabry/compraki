import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonSpinner, IonIcon, IonButton, IonFooter
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cartOutline, bagCheckOutline, trashOutline, arrowForward, lockClosed, airplaneOutline } from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { CartItem } from '../../interfaces/cart-item';
import { FirebaseCartService } from '../../services/firebase-cart.service';
import { CartItemCardComponent } from '../../components/cart-item-card/cart-item-card.component';
import { AlertController } from '@ionic/angular/standalone';

@Component({
  selector: 'app-cart-page',
  templateUrl: './cart.page.html',
  styleUrls: ['./cart.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonSpinner, IonIcon, IonButton, IonFooter,
    CartItemCardComponent
  ]
})
export class CartPage implements OnInit, OnDestroy {
  cartItems: CartItem[] = [];
  isLoading = true;
  isClearing = false;

  private sub!: Subscription;

  constructor(
    private cartService: FirebaseCartService,
    private router: Router,
    private alertCtrl: AlertController
  ) {
    addIcons({ cartOutline, bagCheckOutline, trashOutline, arrowForward, lockClosed, airplaneOutline });
  }

  ngOnInit() {
    this.sub = this.cartService.getAllCartItems().subscribe({
      next: (items) => {
        this.cartItems = items;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Erro ao buscar carrinho', err);
        this.isLoading = false;
      }
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  get totalItems(): number {
    return this.cartItems.reduce((sum, item) => sum + item.quantity, 0);
  }

  get subtotal(): number {
    return this.cartItems.reduce((sum, item) => {
      const price = item.productData.priceDiscounted || item.productData.price;
      return sum + (price * item.quantity);
    }, 0);
  }

  get totalDiscount(): number {
    return this.cartItems.reduce((sum, item) => {
      if (item.productData.priceDiscounted) {
        return sum + ((item.productData.price - item.productData.priceDiscounted) * item.quantity);
      }
      return sum;
    }, 0);
  }

  get total(): number {
    return this.subtotal;
  }

  get hasFreeShipping(): boolean {
    return this.cartItems.some(item => item.productData.shipping === 'Frete Grátis');
  }

  async onRemove(item: CartItem) {
    if (!item.id) return;
    try {
      await this.cartService.removeFromCart(item.id);
    } catch (e) {
      console.error('Erro ao remover item:', e);
    }
  }

  async onQuantityChange(event: { item: CartItem; quantity: number }) {
    if (!event.item.id) return;
    try {
      await this.cartService.updateQuantity(event.item.id, event.quantity);
    } catch (e) {
      console.error('Erro ao atualizar quantidade:', e);
    }
  }

  async clearCart() {
    const alert = await this.alertCtrl.create({
      header: 'Limpar carrinho',
      message: 'Tem certeza que deseja remover todos os itens do carrinho?',
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel'
        },
        {
          text: 'Limpar',
          handler: async () => {
            this.isClearing = true;
            try {
              await this.cartService.clearCart();
            } catch (e) {
              console.error('Erro ao limpar carrinho:', e);
            } finally {
              this.isClearing = false;
            }
          }
        }
      ]
    });
    await alert.present();
  }

  goToCheckout() {
    this.router.navigate(['/checkout']);
  }

  continueShopping() {
    this.router.navigate(['/tabs/tab2']);
  }

  formatPrice(price: number): string {
    return price.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  }

  trackItem(index: number, item: CartItem): string {
    return item.id || index.toString();
  }
}
