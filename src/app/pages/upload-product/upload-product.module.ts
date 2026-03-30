import { NgModule } from '@angular/core';
import { CommonModule, NgIf } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { UploadProductPageRoutingModule } from './upload-product-routing.module';

import { UploadProductPage } from './upload-product.page';
import { UploadProductFormComponent } from './upload-product-form/upload-product-form.component';
import { RouterLink } from '@angular/router';
import { LoadingComponent } from 'src/app/components/loading/loading.component';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    UploadProductFormComponent,
    IonicModule,
    FormsModule,
    NgIf,
    MiniHeaderComponent,
    LoadingComponent,
    UploadProductPageRoutingModule
  ],
  declarations: [UploadProductPage]
})
export class UploadProductPageModule {} 
