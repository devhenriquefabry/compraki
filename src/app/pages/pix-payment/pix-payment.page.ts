import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController, LoadingController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import QRCode from 'qrcode';
import { OrdersService } from 'src/app/services/orders.service';
import { CoraService } from 'src/app/services/cora.service';
import { Order } from 'src/app/interfaces/order';

import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

/** Status que significam "pagamento caiu" — daqui em diante o pedido anda sozinho. */
const PAID_STATUSES: Order['status'][] = ['RECEIVED', 'CONFIRMED', 'IN_ESCROW', 'DELIVERED'];

@Component({
  selector: 'app-pix-payment',
  templateUrl: './pix-payment.page.html',
  styleUrls: ['./pix-payment.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, MiniHeaderComponent]
})
export class PixPaymentPage implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private ordersService = inject(OrdersService);
  private coraService = inject(CoraService);

  public orderId: string = '';
  public pixCode: string = '';
  /** Data URL do QR Code, gerado aqui a partir do copia e cola. */
  public qrDataUrl: string = '';

  public copied: boolean = false;
  public checking: boolean = false;

  /** Cobrança do Cora em stage: mostra o botão de simulação. */
  public sandbox: boolean = false;
  private invoiceId: string = '';

  private orderSub?: Subscription;
  private leaving = false;

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.orderId = params['orderId'];

      if (!this.orderId) {
        this.router.navigate(['/']); // Segurança se entrar sem dados
        return;
      }

      this.watchOrder();
    });
  }

  ngOnDestroy() {
    this.orderSub?.unsubscribe();
  }

  /**
   * O pedido é a fonte da tela: traz o código PIX e, quando o servidor
   * confirma o pagamento (webhook do Cora), a tela segue sozinha.
   */
  private watchOrder() {
    this.orderSub?.unsubscribe();
    this.orderSub = this.ordersService.watchOrder(this.orderId).subscribe({
      next: order => {
        if (!order) return;

        if (PAID_STATUSES.includes(order.status)) {
          this.goToSuccess();
          return;
        }

        this.invoiceId = order.coraInvoiceId || '';
        this.sandbox = order.coraPayment?.sandbox === true;

        const code = order.coraPayment?.pixCode || '';
        if (code && code !== this.pixCode) {
          this.pixCode = code;
          QRCode.toDataURL(code, { width: 320, margin: 1 })
            .then(url => this.qrDataUrl = url)
            .catch(err => console.error('Falha ao gerar QR Code', err));
        }
      },
      error: err => console.error('Falha ao acompanhar pedido', err)
    });
  }

  private goToSuccess() {
    if (this.leaving) return;
    this.leaving = true;
    this.orderSub?.unsubscribe();
    this.router.navigate(['/payment-success'], { replaceUrl: true });
  }

  async copyPixCode() {
    try {
      await navigator.clipboard.writeText(this.pixCode);
      this.copied = true;
      await this.toast('Código PIX copiado!', 'success');
      setTimeout(() => this.copied = false, 3000);
    } catch (err) {
      console.error('Erro ao copiar:', err);
    }
  }

  /** "Já paguei": pede ao servidor para conferir no Cora agora. */
  async checkPayment() {
    if (!this.invoiceId || this.checking) return;

    this.checking = true;
    try {
      const result = await this.coraService.syncCharge(this.invoiceId);
      if (result.changed || PAID_STATUSES.includes(result.orderStatus as Order['status'])) {
        this.goToSuccess();
      } else if (result.invoiceStatus === 'IN_PAYMENT') {
        await this.toast('Pagamento em processamento. Em instantes ele aparece aqui.', 'medium');
      } else {
        await this.toast('Ainda não recebemos o pagamento. Se já pagou, aguarde alguns segundos.', 'medium');
      }
    } catch (err: any) {
      await this.toast(err?.message || 'Não foi possível verificar agora.', 'danger');
    } finally {
      this.checking = false;
    }
  }

  /**
   * Paga a fatura no stage do Cora (dinheiro de mentira). O servidor recusa
   * quando `CORA_ENV=production`, então não depende deste `*ngIf`.
   */
  async simulatePayment() {
    if (!this.invoiceId) return;

    const loading = await this.loadingCtrl.create({ message: 'Simulando pagamento no Cora...' });
    await loading.present();

    try {
      const result = await this.coraService.simulatePayment(this.invoiceId);
      if (result.changed) {
        this.goToSuccess();
      } else {
        await this.toast('Pagamento simulado. Aguardando a confirmação do Cora...', 'success');
      }
    } catch (err: any) {
      await this.toast(err?.message || 'Erro na simulação.', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  private async toast(message: string, color: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, color, position: 'bottom' });
    await toast.present();
  }
}
