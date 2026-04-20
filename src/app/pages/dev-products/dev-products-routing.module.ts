import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { DevProductsPage } from './dev-products.page';

const routes: Routes = [
  {
    path: '',
    component: DevProductsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class DevProductsPageRoutingModule {}
