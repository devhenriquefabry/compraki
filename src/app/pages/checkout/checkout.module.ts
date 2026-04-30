import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { CheckoutPageRoutingModule } from './checkout-routing.module';
import { CheckoutPage } from './checkout.page';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { CheckoutOrderSummaryComponent } from 'src/app/components/checkout/checkout-order-summary/checkout-order-summary.component';
import { CheckoutAddressComponent } from 'src/app/components/checkout/checkout-address/checkout-address.component';
import { CheckoutPaymentComponent } from 'src/app/components/checkout/checkout-payment/checkout-payment.component';
import { CheckoutTotalsComponent } from 'src/app/components/checkout/checkout-totals/checkout-totals.component';
import { CheckoutShippingComponent } from 'src/app/components/checkout/checkout-shipping/checkout-shipping.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CheckoutPageRoutingModule,
    MiniHeaderComponent,
    CheckoutOrderSummaryComponent,
    CheckoutAddressComponent,
    CheckoutPaymentComponent,
    CheckoutTotalsComponent,
    CheckoutShippingComponent
  ],
  declarations: [CheckoutPage]
})
export class CheckoutPageModule {}
