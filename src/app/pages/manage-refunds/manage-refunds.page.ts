import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { RefundsService } from '../../services/refunds.service';
import { AsaasService } from '../../services/asaas.service';
import { Order } from '../../interfaces/order';
import { escrowReleaseDate, isPaid, receivedAt } from '../../core/order-stage';

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
  private alertCtrl = inject(AlertController);
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
        // O checkout já cria o pedido "retido"; sem pagamento não há o que reter.
        this.escrowOrders = orders.filter(isPaid);
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
      
      const releaseDate = escrowReleaseDate(order);
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
    // PIX e boleto do Cora: a API do Cora não estorna cobrança recebida. O
    // dinheiro volta por PIX feito no app do Cora; aqui só se registra.
    if (this.selectedRefundOrder?.id && this.selectedRefundOrder.coraInvoiceId) {
      return this.approveCoraRefund();
    }

    if (!this.selectedRefundOrder?.id || !this.selectedRefundOrder?.asaasPaymentId) {
      this.showToast('Pedido inválido ou sem ID de pagamento Asaas.', 'danger');
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Processando Estorno...' });
    await loading.present();

    try {
      // 1. Chama API Asaas para estornar o pagamento
      const asaasResult = await this.asaasService.refundPayment(
        this.selectedRefundOrder.asaasPaymentId
      ) as { id?: string } | null;
      
      // 2. Atualiza no Firestore: Marca refundInfo como APPROVED e depois atualiza tudo via completeRefundProcess
      await this.refundsService.approveRefund(this.selectedRefundOrder.id, 'admin-id', this.adminNotes);
      await this.refundsService.completeRefundProcess(this.selectedRefundOrder.id, asaasResult?.id || 'asaas-refund-id-gerado');

      this.showToast('Estorno realizado com sucesso no Asaas!', 'success');
      this.closeRefundModal();
    } catch (err: any) {
      console.error(err);
      this.showToast('Erro ao estornar: ' + (err.message || 'Falha na API Asaas'), 'danger');
    } finally {
      loading.dismiss();
    }
  }

  private async approveCoraRefund() {
    const order = this.selectedRefundOrder!;
    const alert = await this.alertCtrl.create({
      header: 'Estorno pelo Cora',
      message: `Este pedido foi pago pelo Cora (${order.paymentMethod}). Devolva R$ ${order.total.toFixed(2)} ao comprador por PIX no app do Cora e só então confirme aqui.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Já devolvi', role: 'confirm' }
      ]
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    const loading = await this.loadingCtrl.create({ message: 'Registrando estorno...' });
    await loading.present();
    try {
      await this.refundsService.approveRefund(order.id!, 'admin-id', this.adminNotes);
      await this.refundsService.completeRefundProcess(order.id!, `cora-manual-${order.coraInvoiceId}`);
      this.showToast('Estorno registrado.', 'success');
      this.closeRefundModal();
    } catch (err: any) {
      console.error(err);
      this.showToast('Erro ao registrar estorno: ' + (err.message || 'falha'), 'danger');
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
    if (!order.id || this.refundOpen(order)) return;

    if (!this.canRelease(order)) {
      const release = this.releaseDate(order);
      const alert = await this.alertCtrl.create({
        header: 'Liberar antes do prazo?',
        message: release
          ? `O comprador pode desistir da compra até ${this.formatDate(release)} (7 dias depois da entrega, pelo CDC). Se ele desistir depois da liberação, a devolução sai do caixa da Vineon.`
          : 'Este pedido ainda não tem entrega registrada. Pelo CDC o comprador pode desistir até 7 dias depois de receber. Libere só se tiver certeza de que o produto foi entregue e não há reclamação.',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Liberar mesmo assim', role: 'confirm' },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'confirm') return;
    }

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

  /** Quando o comprador recebeu (`null` = ainda não chegou). */
  receivedDate(order: Order): Date | null {
    return receivedAt(order);
  }

  /** Fim do prazo de desistência: 7 dias depois da entrega (`null` antes dela). */
  releaseDate(order: Order): Date | null {
    return escrowReleaseDate(order);
  }

  /** Devolução pedida ou aprovada: o dinheiro não sai para a loja enquanto isso. */
  refundOpen(order: Order): boolean {
    const status = order.refundInfo?.status;
    return status === 'REQUESTED' || status === 'APPROVED';
  }

  /** Já passou o prazo de desistência? Só então a liberação é a normal. */
  canRelease(order: Order): boolean {
    const release = this.releaseDate(order);
    return !!release && release.getTime() <= Date.now();
  }

  daysLeft(order: Order): number {
    const release = this.releaseDate(order);
    if (!release) return 0;
    return Math.max(0, Math.ceil((release.getTime() - Date.now()) / (1000 * 3600 * 24)));
  }

  /** Andamento da entrega até o fim do prazo de desistência. */
  releaseProgress(order: Order): number {
    const start = this.receivedDate(order);
    const end = this.releaseDate(order);
    if (!start || !end) return 0;
    const percent = (Date.now() - start.getTime()) / (end.getTime() - start.getTime());
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
