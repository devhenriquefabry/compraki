import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { ProductAdminPage } from './product-admin.page';

const routes: Routes = [
  {
    path: '',
    component: ProductAdminPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ProductAdminPageRoutingModule {}
