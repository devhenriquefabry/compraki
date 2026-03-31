import { Component, Input, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { Product } from 'src/app/interfaces/product';

@Component({
  selector: 'app-checkout-totals',
  templateUrl: './checkout-totals.component.html',
  styleUrls: ['./checkout-totals.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class CheckoutTotalsComponent implements OnInit {

  @Input() produto: Product | null = null;
  
  get subtotal() { 
    return this.produto?.price || 0; 
  }
  
  get discount() { 
    return this.produto?.priceDiscounted ? (this.produto.price - this.produto.priceDiscounted) : 0; 
  }
  
  get total() { 
    return this.produto?.priceDiscounted || this.produto?.price || 0; 
  }

  constructor() { }

  ngOnInit() {}

}
