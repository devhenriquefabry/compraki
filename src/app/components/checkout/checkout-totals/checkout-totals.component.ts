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
    // O subtotal deve refletir o valor final de cada item a menos que a gente queira exibir desconto.
    // Vamos somar os valores originais (price) ignorando descontos para exibir o Subtotal "bruto"
    return this.items.reduce((sum, item) => {
      // Pega sempre o maior valor como preço original para evitar subtotal negativo/bugado se o BD tiver invertido
      const original = Math.max(item.productData.price, item.productData.priceDiscounted || 0);
      return sum + (original * item.quantity);
    }, 0);
  }
  
  get discount() { 
    return this.items.reduce((sum, item) => {
      const original = Math.max(item.productData.price, item.productData.priceDiscounted || 0);
      // O preço final é o menor valor entre os dois, apenas se priceDiscounted existir
      const finalPrice = item.productData.priceDiscounted 
          ? Math.min(item.productData.price, item.productData.priceDiscounted) 
          : item.productData.price;
          
      const disc = original - finalPrice;
      return sum + (disc * item.quantity);
    }, 0);
  }
  
  get total() { 
    return this.subtotal - this.discount;
  }

  constructor() { }

  ngOnInit() {}

}
