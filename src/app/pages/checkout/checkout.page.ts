import { Component, inject, OnInit } from '@angular/core';
import { Product } from 'src/app/interfaces/product';
import { ProductSelectionService } from 'src/app/services/product-selection-service';

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
  standalone: false
})
export class CheckoutPage implements OnInit {
  
  public product!: Product | null;
  private selectionService = inject(ProductSelectionService);

  constructor() { }

  ngOnInit() {
    this.selectionService.selectedProduct$.subscribe(p => {
      this.product = p;
    });
  }

}
