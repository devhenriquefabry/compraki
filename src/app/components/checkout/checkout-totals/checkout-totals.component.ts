import { Component, Input, OnInit, inject } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { CartItem } from 'src/app/interfaces/cart-item';
import { CheckoutStateService } from 'src/app/services/checkout-state.service';

@Component({
  selector: 'app-checkout-totals',
  templateUrl: './checkout-totals.component.html',
  styleUrls: ['./checkout-totals.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class CheckoutTotalsComponent implements OnInit {

  @Input() items: CartItem[] = [];
  private stateService = inject(CheckoutStateService);
  
  get subtotal() { 
    return this.items.reduce((sum, item) => {
      const original = Math.max(item.productData.price, item.productData.priceDiscounted || 0);
      return sum + (original * item.quantity);
    }, 0);
  }
  
  get discount() { 
    return this.items.reduce((sum, item) => {
      const original = Math.max(item.productData.price, item.productData.priceDiscounted || 0);
      const finalPrice = item.productData.priceDiscounted 
          ? Math.min(item.productData.price, item.productData.priceDiscounted) 
          : item.productData.price;
      return sum + ((original - finalPrice) * item.quantity);
    }, 0);
  }

  get shipping() {
    return this.stateService.shippingData?.price || 0;
  }
  
  get total() { 
    return this.subtotal - this.discount + this.shipping;
  }

  constructor() { }

  ngOnInit() {}

}
