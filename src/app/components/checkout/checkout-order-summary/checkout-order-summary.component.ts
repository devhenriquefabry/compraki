import { Component, Input, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { CartItem } from 'src/app/interfaces/cart-item';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-checkout-order-summary',
  templateUrl: './checkout-order-summary.component.html',
  styleUrls: ['./checkout-order-summary.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, RouterLink]
})
export class CheckoutOrderSummaryComponent implements OnInit {

  @Input() items: CartItem[] = [];

  constructor() { }

  ngOnInit() {}

  getOriginalPrice(item: CartItem): number {
    return Math.max(item.productData.price, item.productData.priceDiscounted || 0);
  }

  getFinalPrice(item: CartItem): number {
    return item.productData.priceDiscounted 
      ? Math.min(item.productData.price, item.productData.priceDiscounted) 
      : item.productData.price;
  }

}

