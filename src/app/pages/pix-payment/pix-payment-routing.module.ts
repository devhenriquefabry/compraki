import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { PixPaymentPage } from './pix-payment.page';

const routes: Routes = [
  {
    path: '',
    component: PixPaymentPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PixPaymentPageRoutingModule {}
