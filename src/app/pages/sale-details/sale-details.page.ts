import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController } from '@ionic/angular';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { SalesService } from 'src/app/services/sales.service';
import { MelhorEnvioService } from 'src/app/services/melhor-envio.service';
import { Order } from 'src/app/interfaces/order';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@Component({
  selector: 'app-sale-details',
  templateUrl: './sale-details.page.html',
  styleUrls: ['./sale-details.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, MiniHeaderComponent]
})
export class SaleDetailsPage implements OnInit {

  private route = inject(ActivatedRoute);
  private salesService = inject(SalesService);
  private melhorEnvioService = inject(MelhorEnvioService);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);

  public sale: Order | null = null;
  public isLoading: boolean = true;
  public shipmentStatus: string = 'PREPARING'; // Default

  constructor() { }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.sale = await this.salesService.getSaleById(id);
      if (this.sale) {
        this.shipmentStatus = (this.sale as any).shipmentStatus || 'PREPARING';
      }
      this.isLoading = false;
    }
  }

  async updateStatus() {
    if (!this.sale?.id) return;
    
    try {
      await this.salesService.updateShipmentStatus(this.sale.id, this.shipmentStatus);
      this.showToast('Status atualizado com sucesso!', 'success');
    } catch (err) {
      console.error(err);
    }
  }

  async generateShippingLabel() {
    if (!this.sale) return;

    const loading = await this.loadingCtrl.create({
      message: 'Integrando com Melhor Envio...',
      mode: 'ios'
    });
    await loading.present();

    try {
      const config = await this.melhorEnvioService.getConfig().toPromise();
      if (!config) throw new Error('Melhor Envio não configurado.');

      // 1. Adicionar ao Carrinho
      const cartRes = await this.melhorEnvioService.addToCart(config, this.sale).toPromise();
      const shipmentId = cartRes.id;

      // 2. Comprar Frete (Checkout)
      await this.melhorEnvioService.checkout(config, [shipmentId]).toPromise();

      // 3. Gerar Etiqueta
      await this.melhorEnvioService.generateLabel(config, [shipmentId]).toPromise();

      // 4. Salvar dados no Pedido
      if (this.sale.id) {
        const updateData = {
          'shippingInfo.shipmentId': shipmentId,
          // Tracking code geralmente demora uns segundos para aparecer, o ideal seria um job ou polling
          // Por enquanto salvamos o ID
        };
        await this.salesService.updateSaleData(this.sale.id, updateData);
        
        // Atualiza localmente
        if (this.sale.shippingInfo) {
          this.sale.shippingInfo.shipmentId = shipmentId;
        }
      }

      this.showToast('Etiqueta gerada com sucesso!', 'success');
    } catch (err: any) {
      console.error('Erro Melhor Envio:', err);
      this.showToast('Erro ao gerar etiqueta: ' + (err.error?.message || err.message), 'danger');
    } finally {
      loading.dismiss();
    }
  }

  async printLabel() {
    if (!this.sale?.shippingInfo?.shipmentId) return;

    const loading = await this.loadingCtrl.create({ message: 'Obtendo etiqueta...' });
    await loading.present();

    try {
      const config = await this.melhorEnvioService.getConfig().toPromise();
      if (!config) return;

      const res = await this.melhorEnvioService.getLabelUrl(config, [this.sale.shippingInfo.shipmentId]).toPromise();
      if (res.url) {
        window.open(res.url, '_blank');
      }
    } catch (err) {
      console.error(err);
      this.showToast('Erro ao obter URL da etiqueta.', 'danger');
    } finally {
      loading.dismiss();
    }
  }

  async trackShipment() {
    if (!this.sale?.shippingInfo?.shipmentId) return;
    
    const config = await this.melhorEnvioService.getConfig().toPromise();
    if (!config) return;

    this.melhorEnvioService.getTracking(config, this.sale.shippingInfo.shipmentId).subscribe({
      next: (res) => {
        console.log('Rastreio:', res);
        this.showToast('Verifique o console para detalhes do rastreio (Em breve UI completa)');
      }
    });
  }

  async showToast(message: string, color: string = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  formatPrice(price: number): string {
    return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
