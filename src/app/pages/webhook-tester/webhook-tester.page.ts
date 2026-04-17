import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ToastController, LoadingController } from '@ionic/angular';
import { WebhookHistoryService, WebhookEvent } from 'src/app/services/webhook-history.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-webhook-tester',
  templateUrl: './webhook-tester.page.html',
  styleUrls: ['./webhook-tester.page.scss'],
  standalone: false
})
export class WebhookTesterPage implements OnInit, OnDestroy {

  private http = inject(HttpClient);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private historyService = inject(WebhookHistoryService);

  public targetUrl = 'http://localhost:3000';
  public webhookToken = 'whsec_RS2WNLw9r2sJr6H80ctPiF0nosAdDXZNpTcdp80WsdM';
  
  public eventsList = [
    { id: 'PAYMENT_CREATED', label: 'Cobrança Criada', color: 'primary' },
    { id: 'PAYMENT_RECEIVED', label: 'Cobrança Recebida (Paga)', color: 'success' },
    { id: 'PAYMENT_OVERDUE', label: 'Cobrança Vencida', color: 'danger' },
    { id: 'PAYMENT_DELETED', label: 'Cobrança Removida', color: 'medium' },
    { id: 'PAYMENT_REFUNDED', label: 'Cobrança Estornada', color: 'warning' }
  ];

  public selectedEventId: string = 'PAYMENT_CREATED';
  public currentPayload: any = {};
  public lastResponse: string = '';

  // Histórico
  public history: WebhookEvent[] = [];
  private historySub?: Subscription;

  constructor() { }

  ngOnInit() {
    this.updatePayloadPreview();
    this.historySub = this.historyService.getHistory().subscribe(events => {
      this.history = events;
    });
  }

  ngOnDestroy() {
    this.historySub?.unsubscribe();
  }

  updatePayloadPreview() {
    const basePayment = {
      object: "payment",
      id: `pay_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`,
      dateCreated: new Date().toISOString().split('T')[0],
      customer: "cus_000005030225",
      paymentLink: null,
      value: 150.00,
      netValue: 145.00,
      description: "Pedido Teste via Webhook Simulator",
      billingType: "PIX",
      status: this.getStatusForEvent(this.selectedEventId),
      dueDate: new Date().toISOString().split('T')[0],
      invoiceUrl: "https://sandbox.asaas.com/i/123",
      invoiceNumber: "12345"
    };

    this.currentPayload = {
      event: this.selectedEventId,
      payment: basePayment
    };
  }

  onEventSelect(eventId: string) {
    this.selectedEventId = eventId;
    this.updatePayloadPreview();
  }

  private getStatusForEvent(event: string) {
    switch(event) {
      case 'PAYMENT_CREATED': return 'PENDING';
      case 'PAYMENT_RECEIVED': return 'RECEIVED';
      case 'PAYMENT_OVERDUE': return 'OVERDUE';
      case 'PAYMENT_DELETED': return 'DELETED';
      case 'PAYMENT_REFUNDED': return 'REFUNDED';
      default: return 'PENDING';
    }
  }

  getPayloadString() {
    return JSON.stringify(this.currentPayload, null, 2);
  }

  getSelectedLabel(): string {
    return this.eventsList.find(e => e.id === this.selectedEventId)?.label || this.selectedEventId;
  }

  async testLocalWebhook() {
    this.lastResponse = '';
    
    if (!this.targetUrl) {
       this.showToast('Digite uma URL válida.', 'danger');
       return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Disparando evento...' });
    await loading.present();

    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'asaas-access-token': this.webhookToken
    });

    this.http.post(this.targetUrl, this.currentPayload, { headers, observe: 'response' }).subscribe({
      next: async (res) => {
        loading.dismiss();
        this.lastResponse = `[SUCESSO] Status: ${res.status}\n\n` + JSON.stringify(res.body, null, 2);
        this.showToast('Webhook entregue ao servidor!', 'success');

        // Salvar no Firestore
        await this.historyService.saveEvent({
          eventType: this.selectedEventId,
          eventLabel: this.getSelectedLabel(),
          status: 'SUCCESS',
          payload: this.currentPayload,
          response: this.lastResponse,
          success: true
        });
      },
      error: async (err) => {
        loading.dismiss();
        this.lastResponse = `[ERRO HTTP ${err.status}]\n\n` + JSON.stringify(err.error || err.message, null, 2);
        this.showToast('Falha ao entregar o webhook.', 'danger');

        // Salvar erro no Firestore
        await this.historyService.saveEvent({
          eventType: this.selectedEventId,
          eventLabel: this.getSelectedLabel(),
          status: 'ERROR',
          payload: this.currentPayload,
          response: this.lastResponse,
          success: false
        });
      }
    });
  }

  formatDate(date: Date): string {
    if (!date) return '-';
    return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  async showToast(msg: string, color: string) {
    const toast = await this.toastCtrl.create({
      message: msg,
      duration: 3000,
      color: color,
      position: 'top'
    });
    toast.present();
  }
}
