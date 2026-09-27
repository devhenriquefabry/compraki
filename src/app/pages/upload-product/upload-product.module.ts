import { NgModule } from '@angular/core';
import { CommonModule, NgIf } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { UploadProductPageRoutingModule } from './upload-product-routing.module';

import { UploadProductPage } from './upload-product.page';
import { UploadProductFormComponent } from './upload-product-form/upload-product-form.component';
import { RouterLink } from '@angular/router';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { CatalogFinderComponent } from './catalog-finder/catalog-finder.component';
import { CatalogConfirmComponent } from './catalog-confirm/catalog-confirm.component';

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
    CatalogFinderComponent,
    CatalogConfirmComponent,
    UploadProductPageRoutingModule
  ],
  declarations: [UploadProductPage]
})
export class UploadProductPageModule {} 
