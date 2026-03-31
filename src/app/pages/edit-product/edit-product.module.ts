import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { EditProductPageRoutingModule } from './edit-product-routing.module';
import { ProductSelectorComponent } from 'src/app/components/product-selector/product-selector.component';
import { EditProductFormComponent } from './edit-product-form/edit-product-form.component';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

import { EditProductPage } from './edit-product.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    EditProductPageRoutingModule,
    ProductSelectorComponent,
    EditProductFormComponent,
    MiniHeaderComponent
  ],
  declarations: [EditProductPage]
})
export class EditProductPageModule {}
