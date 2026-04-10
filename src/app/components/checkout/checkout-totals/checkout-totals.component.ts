import { Component, Input, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { CartItem } from 'src/app/interfaces/cart-item';

@Component({
  selector: 'app-checkout-totals',
  templateUrl: './checkout-totals.component.html',
  styleUrls: ['./checkout-totals.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class CheckoutTotalsComponent implements OnInit {

  @Input() items: CartItem[] = [];
  
  get subtotal() { 
    return this.items.reduce((sum, item) => sum + (item.productData.price * item.quantity), 0);
  }
  
  get discount() { 
    return this.items.reduce((sum, item) => {
      const disc = item.productData.priceDiscounted ? (item.productData.price - item.productData.priceDiscounted) : 0;
      return sum + (disc * item.quantity);
    }, 0);
  }
  
  get total() { 
    return this.subtotal - this.discount;
  }

  constructor() { }

  ngOnInit() {}

}
