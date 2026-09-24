import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';

@Component({
  selector: 'app-edit-product',
  templateUrl: './edit-product.page.html',
  styleUrls: ['./edit-product.page.scss'],
  standalone: false
})
export class EditProductPage implements OnInit, OnDestroy {
  public allProducts$!: Observable<Product[]>;
  public selectedProduct: Product | null = null;
  private fbProducts = inject(FirebaseProducts);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private productSub?: Subscription;

  ngOnDestroy() {
    this.productSub?.unsubscribe();
  }

  ngOnInit() {
    // Lista lateral para escolher outro produto do proprio vendedor.
    const uid = this.fbProducts.getUser()?.uid;
    this.allProducts$ = uid ? this.fbProducts.getBySeller(uid, true) : of([]);

    // Le o ID da URL e carrega o produto automaticamente.
    // Antes havia um subscribe dentro de outro subscribe sobre o catalogo
    // inteiro: vazava listener a cada troca de rota.
    this.productSub = this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        return id ? this.fbProducts.getById(id) : of(null);
      })
    ).subscribe(found => {
      if (found) this.selectedProduct = found;
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
