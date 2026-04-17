import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { SalesService } from 'src/app/services/sales.service';
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
  private toastCtrl = inject(ToastController);

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
      const toast = await this.toastCtrl.create({
        message: 'Status atualizado com sucesso!',
        duration: 2000,
        color: 'success'
      });
      await toast.present();
    } catch (err) {
      console.error(err);
    }
  }

  formatPrice(price: number): string {
    return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
