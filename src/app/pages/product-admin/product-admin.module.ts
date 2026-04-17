import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ProductAdminPageRoutingModule } from './product-admin-routing.module';

import { ProductAdminPage } from './product-admin.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ProductAdminPageRoutingModule,
    ProductAdminPage
  ]
})
export class ProductAdminPageModule {}
