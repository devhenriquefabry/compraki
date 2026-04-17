import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { SaleDetailsPageRoutingModule } from './sale-details-routing.module';

import { SaleDetailsPage } from './sale-details.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SaleDetailsPageRoutingModule,
    SaleDetailsPage
  ]
})
export class SaleDetailsPageModule {}
