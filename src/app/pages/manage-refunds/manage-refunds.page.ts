import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { RefundsService } from '../../services/refunds.service';
import { AsaasService } from '../../services/asaas.service';
import { Order } from '../../interfaces/order';

type ManageRefundsTab = 'escrow' | 'refunds' | 'released';

@Component({
  selector: 'app-manage-refunds',
  templateUrl: './manage-refunds.page.html',
  styleUrls: ['./manage-refunds.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class ManageRefundsPage implements OnInit, OnDestroy {
  activeTab: ManageRefundsTab = 'escrow';
  
  public escrowOrders: Order[] = [];
  public refundRequests: Order[] = [];
  public releasedOrders: Order[] = [];
  
  public isLoadingEscrow = true;
  public isLoadingRefunds = true;
  public isLoadingReleased = true;

  // Totais Escrow
  public totalRetido = 0;
  public totalLiberarHoje = 0;

  private escrowSub?: Subscription;
  private refundsSub?: Subscription;
  private releasedSub?: Subscription;

  private refundsService = inject(RefundsService);
  private asaasService = inject(AsaasService);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);

  // Modal State
  public isRefundModalOpen = false;
  public selectedRefundOrder: Order | null = null;
  public adminNotes = '';

  constructor() {}

  ngOnInit() {
    this.loadData();
  }

  ngOnDestroy() {
    this.escrowSub?.unsubscribe();
    this.refundsSub?.unsubscribe();
    this.releasedSub?.unsubscribe();
  }

  setTab(tab: ManageRefundsTab) {
    this.activeTab = tab;
  }

  private loadData() {
    this.escrowSub = this.refundsService.getOrdersInEscrow().subscribe({
      next: (orders) => {
        this.escrowOrders = orders;
        this.calculateEscrowTotals();
        this.isLoadingEscrow = false;
      },
      error: (err) => {
        console.error('Erro ao carregar escrow', err);
        this.isLoadingEscrow = false;
      }
    });

    this.refundsSub = this.refundsService.getAllRefundRequests().subscribe({
      next: (orders) => {
        this.refundRequests = orders;
        this.isLoadingRefunds = false;
      },
      error: (err) => {
        console.error('Erro ao carregar devoluções', err);
        this.isLoadingRefunds = false;
      }
    });

    this.releasedSub = this.refundsService.getOrdersWithReleasedEscrow().subscribe({
      next: (orders) => {
        this.releasedOrders = orders;
        this.isLoadingReleased = false;
      },
      error: (err) => {
        console.error('Erro ao carregar liberados', err);
        this.isLoadingReleased = false;
      }
    });
  }

  private calculateEscrowTotals() {
    this.totalRetido = 0;
    this.totalLiberarHoje = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    this.escrowOrders.forEach(order => {
      this.totalRetido += order.total;
      
      const releaseDate = this.toDate(order.escrowInfo?.releaseDate);
      if (releaseDate) {
        const releaseDay = new Date(releaseDate);
        releaseDay.setHours(0, 0, 0, 0);
        if (releaseDay.getTime() === today.getTime() || releaseDay.getTime() < today.getTime()) {
          this.totalLiberarHoje += order.total;
        }
      }
    });
  }

  openRefundModal(order: Order) {
    this.selectedRefundOrder = order;
    this.adminNotes = order.refundInfo?.adminNotes || '';
    this.isRefundModalOpen = true;
  }

  closeRefundModal() {
    this.isRefundModalOpen = false;
    this.selectedRefundOrder = null;
    this.adminNotes = '';
  }

  async approveRefund() {
    if (!this.selectedRefundOrder?.id || !this.selectedRefundOrder?.asaasPaymentId) {
      this.showToast('Pedido inválido ou sem ID de pagamento Asaas.', 'danger');
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Processando Estorno...' });
    await loading.present();

    try {
      // 1. Chama API Asaas para estornar o pagamento
      const asaasResult = await this.asaasService.refundPayment(this.selectedRefundOrder.asaasPaymentId);
      
      // 2. Atualiza no Firestore: Marca refundInfo como APPROVED e depois atualiza tudo via completeRefundProcess
      await this.refundsService.approveRefund(this.selectedRefundOrder.id, 'admin-id', this.adminNotes);
      await this.refundsService.completeRefundProcess(this.selectedRefundOrder.id, asaasResult.id || 'asaas-refund-id-gerado');

      this.showToast('Estorno realizado com sucesso no Asaas!', 'success');
      this.closeRefundModal();
    } catch (err: any) {
      console.error(err);
      this.showToast('Erro ao estornar: ' + (err.message || 'Falha na API Asaas'), 'danger');
    } finally {
      loading.dismiss();
    }
  }

  async rejectRefund() {
    if (!this.selectedRefundOrder?.id) return;
    
    if (!this.adminNotes.trim()) {
      this.showToast('Por favor, adicione uma nota explicando a rejeição.', 'warning');
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Rejeitando...' });
    await loading.present();

    try {
      await this.refundsService.rejectRefund(this.selectedRefundOrder.id, 'admin-id', this.adminNotes);
      this.showToast('Solicitação rejeitada com sucesso.', 'success');
      this.closeRefundModal();
    } catch (err: any) {
      console.error(err);
      this.showToast('Erro ao rejeitar: ' + err.message, 'danger');
    } finally {
      loading.dismiss();
    }
  }

  async forceReleaseEscrow(order: Order) {
    if (!order.id) return;
    
    const loading = await this.loadingCtrl.create({ message: 'Liberando fundos...' });
    await loading.present();

    try {
      await this.refundsService.releaseEscrowManually(order.id);
      this.showToast('Fundos liberados manualmente para o vendedor.', 'success');
    } catch (err: any) {
      console.error(err);
      this.showToast('Erro ao liberar fundos: ' + err.message, 'danger');
    } finally {
      loading.dismiss();
    }
  }

  // --- Utils ---

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  formatDate(date: any): string {
    const d = this.toDate(date);
    if (!d) return '-';
    return d.toLocaleDateString('pt-BR');
  }

  formatDateTime(date: any): string {
    const d = this.toDate(date);
    if (!d) return '-';
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  getDaysLeft(releaseDate: any): number {
    const d = this.toDate(releaseDate);
    if (!d) return 0;
    const diff = d.getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 3600 * 24));
  }

  getProgressBarValue(createdAt: any, releaseDate: any): number {
    const start = this.toDate(createdAt);
    const end = this.toDate(releaseDate);
    if (!start || !end) return 0;

    const totalDuration = end.getTime() - start.getTime();
    const passedDuration = new Date().getTime() - start.getTime();
    
    const percent = passedDuration / totalDuration;
    return Math.max(0, Math.min(1, percent));
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    return new Date(value);
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    toast.present();
  }
}
