import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { Product } from 'src/app/interfaces/product';
import { ProductSelectionService } from 'src/app/services/product-selection-service';

@Component({
  selector: 'app-product-details',
  templateUrl: './product-details.page.html',
  styleUrls: ['./product-details.page.scss'],
  standalone: false
})
export class ProductDetailsPage implements OnInit {
  public product$: Observable<Product | null>;


  constructor(private selectionService: ProductSelectionService, private router: Router) {
    console.log('a')
    // Liga a variável local ao Observable do serviço
    this.product$ = this.selectionService.selectedProduct$;


  }
  ngOnInit() {
    // Verifica se o valor atual é nulo ou indefinido
    const productExists = this.selectionService.getCurrentProduct();

    if (!productExists) {
      console.log('Nenhum produto selecionado, voltando para Home...');
      this.router.navigate(['/home']); // ou a rota da sua home
    }
  }

  public getFloating(number: number): string {
    const transformedNumber = number.toFixed(2); // Ex: "10.50"
    const parts = transformedNumber.split('.');  // Divide em ["10", "50"]

    return parts[1]; // Retorna apenas "50"
  }

  public priceOrganize(price:any, priceDiscounted:any) : number{
    if (price){
      return price
    }
    return priceDiscounted
  }
}

