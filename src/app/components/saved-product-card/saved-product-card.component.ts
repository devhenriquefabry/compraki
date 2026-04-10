import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonCard, IonRippleEffect, IonIcon, IonText, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { heart, locationOutline, star, cartOutline, flash, checkmarkDoneOutline } from 'ionicons/icons';
import { FirebaseCartService } from '../../services/firebase-cart.service';
import { ProductSelectionService } from '../../services/product-selection-service';
import { Observable, map } from 'rxjs';
import { RouterLink } from '@angular/router';
import { SavedItem } from '../../interfaces/saved-item';
import { Product } from '../../interfaces/product';

@Component({
  selector: 'app-saved-product-card',
  templateUrl: './saved-product-card.component.html',
  styleUrls: ['./saved-product-card.component.scss'],
  standalone: true,
  imports: [CommonModule, IonCard, IonRippleEffect, IonIcon, IonText, IonButton, RouterLink]
})
export class SavedProductCardComponent implements OnInit {
  @Input() item!: SavedItem;
  @Output() remove = new EventEmitter<SavedItem>();
  
  cartQuantity$: Observable<number>;

  constructor(
    private router: Router,
    private cartService: FirebaseCartService,
    private selectionService: ProductSelectionService
  ) {
    addIcons({ heart, locationOutline, star, cartOutline, flash, checkmarkDoneOutline });
    
    // Monitorar quantidade no carrinho reativamente
    this.cartQuantity$ = this.cartService.getAllCartItems().pipe(
      map(items => {
        const cartItem = items.find(i => i.productId === this.product.id);
        return cartItem ? cartItem.quantity : 0;
      })
    );
  }

  ngOnInit() {}

  get product(): Product {
    return this.item.productData;
  }

  onRemove(event: Event) {
    event.stopPropagation();
    this.remove.emit(this.item);
  }

  goToDetails() {
    if (this.product && this.product.id) {
      this.selectionService.setSelectedProduct(this.product);
      this.router.navigate(['/product-details']);
    }
  }

  addToCart(event: Event) {
    event.stopPropagation();
    this.cartService.addToCart(this.product);
  }

  formatPrice(price: number | undefined): string {
    if (price === undefined) return '0.00';
    return price.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  }
}
