import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonCard, IonRippleEffect, IonIcon, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { trashOutline, addCircleOutline, removeCircleOutline } from 'ionicons/icons';
import { CartItem } from '../../interfaces/cart-item';
import { Product } from '../../interfaces/product';
import { ProductSelectionService } from '../../services/product-selection-service';

@Component({
  selector: 'app-cart-item-card',
  templateUrl: './cart-item-card.component.html',
  styleUrls: ['./cart-item-card.component.scss'],
  standalone: true,
  imports: [CommonModule, IonCard, IonRippleEffect, IonIcon, IonButton]
})
export class CartItemCardComponent {
  @Input() item!: CartItem;
  @Output() remove = new EventEmitter<CartItem>();
  @Output() quantityChange = new EventEmitter<{ item: CartItem; quantity: number }>();

  constructor(
    private router: Router,
    private selectionService: ProductSelectionService
  ) {
    addIcons({ trashOutline, addCircleOutline, removeCircleOutline });
  }

  get product(): Product {
    return this.item.productData;
  }

  get effectivePrice(): number {
    return this.product.priceDiscounted || this.product.price;
  }

  get subtotal(): number {
    return this.effectivePrice * this.item.quantity;
  }

  onRemove(event: Event) {
    event.stopPropagation();
    this.remove.emit(this.item);
  }

  increment(event: Event) {
    event.stopPropagation();
    if (this.item.quantity < this.product.stock) {
      this.quantityChange.emit({ item: this.item, quantity: this.item.quantity + 1 });
    }
  }

  decrement(event: Event) {
    event.stopPropagation();
    if (this.item.quantity > 1) {
      this.quantityChange.emit({ item: this.item, quantity: this.item.quantity - 1 });
    }
  }

  goToDetails() {
    if (this.product) {
      this.selectionService.setSelectedProduct(this.product);
      this.router.navigate(['/product-details']);
    }
  }

  formatPrice(price: number | undefined): string {
    if (price === undefined) return '0,00';
    return price.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  }
}
