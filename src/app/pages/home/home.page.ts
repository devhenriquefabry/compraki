import { Component, inject, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { ProductDetailsPage } from '../product-details/product-details.page';
import { Router } from '@angular/router';
import { ProductSelectionService } from 'src/app/services/product-selection-service';
import { User } from 'firebase/auth';


@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false
})
export class HomePage implements OnInit {

  public usuario! : User | null
  

  constructor(  public selectionService: ProductSelectionService , private router : Router) { }
  public products$!: Observable<Product[]> 
  public servicoDeProdutosDoFirebase = inject(FirebaseProducts)


  ngOnInit() {
    this.products$ = this.servicoDeProdutosDoFirebase.getAll()
    
    // Atualização do usuário
    setInterval(()=>{
      if( this.servicoDeProdutosDoFirebase.getUser()){
        this.usuario = this.servicoDeProdutosDoFirebase.getUser()
      }
    }, 1000)
  }


sendProductToDetailPage(product: Product) { // Receba o objeto Product diretamente
  this.selectionService.setSelectedProduct(product);
  this.router.navigate(['/product-details']);
} 

logout(){
  this.servicoDeProdutosDoFirebase.signOut()
}
}
