import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { SalesService } from 'src/app/services/sales.service';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { Order } from 'src/app/interfaces/order';
import { Subscription } from 'rxjs';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@Component({
  selector: 'app-my-sales',
  templateUrl: './my-sales.page.html',
  styleUrls: ['./my-sales.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, MiniHeaderComponent]
})
export class MySalesPage implements OnInit, OnDestroy {

  private salesService = inject(SalesService);
  private fbProducts = inject(FirebaseProducts);
  
  public sales: Order[] = [];
  public isLoading: boolean = true;
  private sub?: Subscription;

  constructor() { }

  ngOnInit() {
    const user = this.fbProducts.getUser();
    if (user) {
      this.sub = this.salesService.getSellerSales(user.uid).subscribe({
        next: (orders) => {
          this.sales = orders;
          this.isLoading = false;
        },
        error: (err) => {
          console.error(err);
          this.isLoading = false;
        }
      });
    }
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  getStatusLabel(status: string): string {
    switch(status) {
      case 'PENDING': return 'Aguardando Pagamento';
      case 'RECEIVED': return 'Pago - Preparando';
      case 'CONFIRMED': return 'Em Trânsito';
      case 'CANCELLED': return 'Cancelado';
      default: return status;
    }
  }

  formatDate(date: any): string {
    if (!date) return '-';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('pt-BR');
  }
}
