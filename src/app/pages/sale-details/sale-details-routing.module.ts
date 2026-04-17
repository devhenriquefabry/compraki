import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { SaleDetailsPage } from './sale-details.page';

const routes: Routes = [
  {
    path: '',
    component: SaleDetailsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SaleDetailsPageRoutingModule {}
