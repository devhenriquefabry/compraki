import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { PixPaymentPageRoutingModule } from './pix-payment-routing.module';
import { PixPaymentPage } from './pix-payment.page';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PixPaymentPageRoutingModule,
    PixPaymentPage // Agora é importado pois é standalone
  ]
})
export class PixPaymentPageModule {}
