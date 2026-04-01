import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonCard, IonRippleEffect, IonIcon, IonText, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { heart, locationOutline, star } from 'ionicons/icons';
import { SavedItem } from '../../interfaces/saved-item';
import { Product } from '../../interfaces/product';

@Component({
  selector: 'app-saved-product-card',
  templateUrl: './saved-product-card.component.html',
  styleUrls: ['./saved-product-card.component.scss'],
  standalone: true,
  imports: [CommonModule, IonCard, IonRippleEffect, IonIcon, IonText, IonButton]
})
export class SavedProductCardComponent {
  @Input() item!: SavedItem;
  @Output() remove = new EventEmitter<SavedItem>();

  constructor(private router: Router) {
    addIcons({ heart, locationOutline, star });
  }

  get product(): Product {
    return this.item.productData;
  }

  onRemove(event: Event) {
    event.stopPropagation();
    this.remove.emit(this.item);
  }

  goToDetails() {
    if (this.product && this.product.id) {
      this.router.navigate(['/product-details', this.product.id]);
    }
  }

  formatPrice(price: number | undefined): string {
    if (price === undefined) return '0.00';
    return price.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  }
}
