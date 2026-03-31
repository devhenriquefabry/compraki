import { Component, inject, OnInit, HostListener } from '@angular/core';
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
  public projectDuration: string = '';
  public showSecretNotice: boolean = false;
  private startDate = new Date('2026-02-06T18:37:00');

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.ctrlKey && (event.key === "'" || event.code === 'Quote')) {
      event.preventDefault();
      this.showSecretNotice = !this.showSecretNotice;
    }
  }

  ngOnInit() {
    this.products$ = this.servicoDeProdutosDoFirebase.getAll()
    
    // Atualização do usuário
    setInterval(()=>{
      if( this.servicoDeProdutosDoFirebase.getUser()){
        this.usuario = this.servicoDeProdutosDoFirebase.getUser()
      }
    }, 1000)

    // Cronômetro do Projeto
    this.updateDuration();
    setInterval(() => this.updateDuration(), 1000);
  }

  private updateDuration() {
    const now = new Date();
    const diff = now.getTime() - this.startDate.getTime();

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    this.projectDuration = `${days} dias, ${hours}h ${minutes}m ${seconds}s`;
  }

sendProductToDetailPage(product: Product) { // Receba o objeto Product diretamente
  this.selectionService.setSelectedProduct(product);
  this.router.navigate(['/product-details']);
} 

logout(){
  this.servicoDeProdutosDoFirebase.signOut()
}
}
