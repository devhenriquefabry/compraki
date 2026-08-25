import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController, LoadingController } from '@ionic/angular';
import { OrdersService } from 'src/app/services/orders.service';
import { environment } from 'src/environments/environment';

import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@Component({
  selector: 'app-pix-payment',
  templateUrl: './pix-payment.page.html',
  styleUrls: ['./pix-payment.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, MiniHeaderComponent]
})
export class PixPaymentPage implements OnInit {

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private ordersService = inject(OrdersService);

  public orderId: string = '';
  public paymentId: string = '';
  public pixCode: string = '';
  public qrCode: string = '';
  
  public copied: boolean = false;

  constructor() { }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.orderId = params['orderId'];
      this.paymentId = params['paymentId'];
      this.pixCode = params['pixCode'];
      this.qrCode = params['qrCode'];

      if (!this.pixCode) {
        this.router.navigate(['/']); // Segurança se entrar sem dados
      }
    });
  }

  async copyPixCode() {
    try {
      await navigator.clipboard.writeText(this.pixCode);
      this.copied = true;
      const toast = await this.toastCtrl.create({
        message: 'Código PIX copiado!',
        duration: 2000,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
      setTimeout(() => this.copied = false, 3000);
    } catch (err) {
      console.error('Erro ao copiar:', err);
    }
  }

  /** Só existe fora de produção — controla a exibição do botão no template. */
  public readonly canSimulatePayment = !environment.production;

  /**
   * Marca o pedido como recebido SEM cobrança real.
   *
   * Ferramenta de desenvolvimento. Em produção estaria dando produto de graça:
   * qualquer comprador apertaria o botão e teria o pedido como pago. Por isso
   * a checagem abaixo, além do `*ngIf` no template.
   *
   * A confirmação de pagamento de verdade tem que vir do webhook do Asaas
   * (server-side) — está na Fase 1.
   */
  async simulatePayment() {
    if (environment.production) {
      console.warn('simulatePayment está desativado em produção.');
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Simulando recebimento...',
    });
    await loading.present();

    try {
      // Atualizar status no Firestore de PENDING -> RECEIVED
      await this.ordersService.updateOrderStatus(this.orderId, 'RECEIVED');

      await loading.dismiss();

      // 3. Ir para a tela de Sucesso Intermediária
      this.router.navigate(['/payment-success']);

    } catch (e) {
      await loading.dismiss();
      console.error(e);
      const toast = await this.toastCtrl.create({
        message: 'Erro na simulação.',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    }
  }

}
