import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { OrdersService } from 'src/app/services/orders.service';
import { Order } from 'src/app/interfaces/order';
import { Subscription } from 'rxjs';
import { getAuth } from 'firebase/auth';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController } from '@ionic/angular';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { RefundsService } from 'src/app/services/refunds.service';

@Component({
  selector: 'app-my-orders',
  templateUrl: './my-orders.page.html',
  styleUrls: ['./my-orders.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, MiniHeaderComponent]
})
export class MyOrdersPage implements OnInit, OnDestroy {

  private ordersService = inject(OrdersService);
  private refundsService = inject(RefundsService);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  
  public allOrders: Order[] = [];
  public filteredOrders: Order[] = [];
  public isLoading: boolean = true;
  public filter: 'ALL' | 'PAID' | 'PENDING' = 'PAID'; // Default to Paid as requested

  private sub?: Subscription;

  // Modal de devolução
  public isRefundModalOpen = false;
  public refundOrder: Order | null = null;
  public refundReason = '';

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

  canRequestRefund(order: Order): boolean {
    if (order.status !== 'CONFIRMED' && order.status !== 'RECEIVED' && order.status !== 'DELIVERED') return false;
    if (order.refundInfo?.status) return false; // Já solicitou
    if (order.escrowInfo?.status !== 'HOLDING') return false; // Já liberou ou estornou
    
    // Verifica se ainda está dentro dos 7 dias
    const releaseDate = this.toDate(order.escrowInfo?.releaseDate);
    if (!releaseDate) return false;
    
    return releaseDate.getTime() > new Date().getTime();
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    return new Date(value);
  }

  openRefundModal(order: Order) {
    this.refundOrder = order;
    this.refundReason = '';
    this.isRefundModalOpen = true;
  }

  closeRefundModal() {
    this.isRefundModalOpen = false;
    this.refundOrder = null;
    this.refundReason = '';
  }

  async submitRefundRequest() {
    if (!this.refundOrder?.id) return;
    if (this.refundReason.trim().length < 10) {
      this.showToast('Por favor, explique o motivo em pelo menos 10 caracteres.', 'warning');
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Enviando solicitação...' });
    await loading.present();

    try {
      const user = getAuth().currentUser;
      await this.refundsService.requestRefund(this.refundOrder.id, user?.uid || 'unknown', this.refundReason);
      
      this.showToast('Solicitação de devolução enviada com sucesso.', 'success');
      this.closeRefundModal();
    } catch (err: any) {
      console.error(err);
      this.showToast('Erro ao enviar solicitação.', 'danger');
    } finally {
      loading.dismiss();
    }
  }

  async showToast(message: string, color: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    toast.present();
  }
}
