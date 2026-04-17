import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { MyProductsPageRoutingModule } from './my-products-routing.module';

import { MyProductsPage } from './my-products.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MyProductsPageRoutingModule,
    MyProductsPage
  ]
})
export class MyProductsPageModule {}
