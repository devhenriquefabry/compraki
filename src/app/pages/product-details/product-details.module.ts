import { NgModule } from '@angular/core';
import { CommonModule, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ProductDetailsPageRoutingModule } from './product-details-routing.module';

import { ProductDetailsPage } from './product-details.page';
import { CustomHeaderComponent } from 'src/app/components/custom-header/custom-header.component';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@NgModule({
  imports: [
    CommonModule,
    CustomHeaderComponent,
    NgIf,
    FormsModule,
    MiniHeaderComponent,
    IonicModule,
    ProductDetailsPageRoutingModule
  ],
  declarations: [ProductDetailsPage]
})
export class ProductDetailsPageModule {}
