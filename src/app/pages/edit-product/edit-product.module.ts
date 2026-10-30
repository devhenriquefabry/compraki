import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { IonicModule } from '@ionic/angular';

import { EditProductPageRoutingModule } from './edit-product-routing.module';
import { EditProductFormComponent } from './edit-product-form/edit-product-form.component';
import { VnIconComponent } from 'src/app/components/vn-icon/vn-icon.component';

import { EditProductPage } from './edit-product.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    RouterModule,
    EditProductPageRoutingModule,
    EditProductFormComponent,
    VnIconComponent,
  ],
  declarations: [EditProductPage]
})
export class EditProductPageModule {}
