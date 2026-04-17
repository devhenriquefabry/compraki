import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ToastController, LoadingController } from '@ionic/angular';
import { OrdersService } from 'src/app/services/orders.service';

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
  private http = inject(HttpClient);
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

  async simulatePayment() {
    const loading = await this.loadingCtrl.create({
      message: 'Simulando recebimento...',
    });
    await loading.present();

    try {
      // 1. Disparar Webhook Local (Opcional, mas completa o ciclo de testes do usuário)
      // Usamos a URL pública que geramos antes ou localhost:3000
      const webhookUrl = 'http://localhost:3000';
      const payload = {
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: this.paymentId,
          status: 'RECEIVED',
          value: 0, // O valor real não importa tanto na simulação visual
          billingType: 'PIX'
        }
      };

      // Tentamos bater no webhook local. Se falhar (ex: túnel fechado), seguimos com Firestore
      this.http.post(webhookUrl, payload, { 
        headers: { 'asaas-access-token': 'whsec_RS2WNLw9r2sJr6H80ctPiF0nosAdDXZNpTcdp80WsdM' } 
      }).subscribe({
        next: () => console.log('Webhook simulado com sucesso'),
        error: (err) => console.warn('Servidor webhook local não respondeu, mas continuaremos...', err)
      });

      // 2. Atualizar status no Firestore de PENDING -> RECEIVED
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
