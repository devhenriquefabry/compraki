import { Component, inject, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';

@Component({
  selector: 'app-edit-product',
  templateUrl: './edit-product.page.html',
  styleUrls: ['./edit-product.page.scss'],
  standalone: false
})
export class EditProductPage implements OnInit {
  public allProducts$!: Observable<Product[]>;
  public selectedProduct: Product | null = null;
  private fbProducts = inject(FirebaseProducts);

  ngOnInit() {
    this.allProducts$ = this.fbProducts.getAll();
  }

  onProductSelect(productId: string) {
    this.allProducts$.subscribe(products => {
      const found = products.find(p => p.id === productId);
      if (found) {
        this.selectedProduct = found;
      }
    });
  }

  onCancelEdit() {
    this.selectedProduct = null;
  }
}
