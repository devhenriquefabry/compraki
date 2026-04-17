import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { PaymentSuccessPageRoutingModule } from './payment-success-routing.module';

import { PaymentSuccessPage } from './payment-success.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PaymentSuccessPageRoutingModule,
    PaymentSuccessPage // Agora é importado pois é standalone
  ]
})
export class PaymentSuccessPageModule {}
