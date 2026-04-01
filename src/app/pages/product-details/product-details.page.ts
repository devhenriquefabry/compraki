import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { Product } from 'src/app/interfaces/product';
import { ProductSelectionService } from 'src/app/services/product-selection-service';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseChatService } from 'src/app/services/firebase-chat.service';

@Component({
  selector: 'app-product-details',
  templateUrl: './product-details.page.html',
  styleUrls: ['./product-details.page.scss'],
  standalone: false
})
export class ProductDetailsPage implements OnInit {
  public product$: Observable<Product | null>;
  public allProducts$: Observable<Product[]>;


  constructor(
    private selectionService: ProductSelectionService, 
    private router: Router,
    private fbProducts: FirebaseProducts,
    private chatService: FirebaseChatService
  ) {
    // Liga a variável local ao Observable do serviço
    this.product$ = this.selectionService.selectedProduct$;
    this.allProducts$ = this.fbProducts.getAll();
  }

  ngOnInit() {
    // Agora não redirecionamos mais se estiver nulo, permitindo o seletor aparecer
  }

  public onProductSelect(productId: string) {
    this.allProducts$.subscribe(products => {
      const selected = products.find(p => p.id === productId);
      if (selected) {
        this.selectionService.setSelectedProduct(selected);
      }
    });
  }

  public async startChat(product: Product) {
    if (!product.sellerId) {
      console.error("Produto sem vendedor definido.");
      return; // Could show a toast here
    }

    try {
      const chatId = await this.chatService.startChat(
         { uid: product.sellerId, name: 'Vendedor do Anúncio' },
         { id: product.id!, name: product.name, photo: product.photoURL?.[0] }
      );
      this.router.navigate(['/chat-details', chatId]);
    } catch (e) {
       console.error("Falha ao iniciar chat", e);
    }
  }

  public goToCheckout() {
    console.log('Indo para o checkout...');
    this.router.navigate(['/checkout']);
  }

  public getFloating(number: number): string {
    const transformedNumber = number.toFixed(2);
    const parts = transformedNumber.split('.');
    return parts[1];
  }

  public priceOrganize(price:any, priceDiscounted:any) : number {
    return price || priceDiscounted;
  }
}

