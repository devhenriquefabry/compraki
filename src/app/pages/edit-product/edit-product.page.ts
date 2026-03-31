import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  ngOnInit() {
    this.allProducts$ = this.fbProducts.getAll();

    // Lê o ID da URL e carrega o produto automaticamente
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.allProducts$.subscribe(products => {
          const found = products.find(p => p.id === id);
          if (found) {
            this.selectedProduct = found;
          }
        });
      }
    });
  }

  onProductSelect(productId: string) {
    // Navega para a URL com o ID do produto
    this.router.navigate(['/edit-product', productId]);
  }

  onCancelEdit() {
    this.selectedProduct = null;
    // Volta para a URL sem ID
    this.router.navigate(['/edit-product']);
  }
}
