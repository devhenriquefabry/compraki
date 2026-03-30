import { Component, inject, Input, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Product } from '../../../interfaces/product'

import { RouterLink } from '@angular/router';
import { FirebaseProducts } from '../../../services/firebase-products'
@Component({
  selector: 'app-product-card',
  templateUrl: './product-card.component.html',
  styleUrls: ['./product-card.component.scss'],
  standalone: true,
  imports: [IonicModule]
})
export class ProductCardComponent  implements OnInit {
    constructor() { }

    
  @Input() item! : Product;

  private servicoDeProdutosDoFirebase = inject(FirebaseProducts)

  enviarProdutoProFirebase(){
    this.servicoDeProdutosDoFirebase.add(this.item)
  }


  ngOnInit() {}


}
