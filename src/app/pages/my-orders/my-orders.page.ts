import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { OrdersService } from 'src/app/services/orders.service';
import { Order } from 'src/app/interfaces/order';
import { Subscription } from 'rxjs';
import { getAuth } from 'firebase/auth';

import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@Component({
  selector: 'app-my-orders',
  templateUrl: './my-orders.page.html',
  styleUrls: ['./my-orders.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, MiniHeaderComponent]
})
export class MyOrdersPage implements OnInit, OnDestroy {

  private ordersService = inject(OrdersService);
  
  public allOrders: Order[] = [];
  public filteredOrders: Order[] = [];
  public isLoading: boolean = true;
  public filter: 'ALL' | 'PAID' | 'PENDING' = 'PAID'; // Default to Paid as requested

  private sub?: Subscription;

  constructor() { }

  ngOnInit() {
    const user = getAuth().currentUser;
    if (user) {
      this.sub = this.ordersService.getUserOrders(user.uid).subscribe({
        next: (orders) => {
          this.allOrders = orders;
          this.applyFilter();
          this.isLoading = false;
        },
        error: (err) => {
          console.error(err);
          this.isLoading = false;
        }
      });
    } else {
      this.isLoading = false;
    }
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  setFilter(f: 'ALL' | 'PAID' | 'PENDING') {
    this.filter = f;
    this.applyFilter();
  }

  applyFilter() {
    if (this.filter === 'ALL') {
      this.filteredOrders = [...this.allOrders];
    } else if (this.filter === 'PAID') {
      this.filteredOrders = this.allOrders.filter(o => o.status === 'RECEIVED' || o.status === 'CONFIRMED');
    } else {
      this.filteredOrders = this.allOrders.filter(o => o.status === 'PENDING');
    }
  }

  getStatusLabel(status: string): string {
    switch(status) {
      case 'PENDING': return 'Aguardando Pagamento';
      case 'RECEIVED': return 'Pagamento Confirmado';
      case 'CONFIRMED': return 'Em Separação';
      case 'CANCELLED': return 'Cancelado';
      case 'REFUNDED': return 'Estornado';
      default: return status;
    }
  }

  formatDate(date: any): string {
    if (!date) return '-';
    // Se for Firebase Timestamp
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('pt-BR');
  }

}
