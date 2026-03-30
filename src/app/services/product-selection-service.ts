import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Product } from '../interfaces/product';

@Injectable({
  providedIn: 'root'
})
export class ProductSelectionService {
  private selectedProductSource = new BehaviorSubject<Product | null>(null);
  // Observable para as páginas se inscreverem
  selectedProduct$ = this.selectedProductSource.asObservable();

  setSelectedProduct(product: Product) {
    this.selectedProductSource.next(product);
  }

  getCurrentProduct() {
  return this.selectedProductSource.getValue();
}
}
