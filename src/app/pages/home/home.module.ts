import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { HomePageRoutingModule } from './home-routing.module';

import { HomePage } from './home.page';
import { ExploreContainerComponentModule } from 'src/app/explore-container/explore-container.module';
import { ProductCardComponent } from './product-card/product-card.component';
import { CustomHeaderComponent } from 'src/app/components/custom-header/custom-header.component';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { ProductDetailsPage } from '../product-details/product-details.page';
import { ProductDetailsPageModule } from '../product-details/product-details.module';
import { ProfileCardComponent } from 'src/app/components/profile-card/profile-card.component';

@NgModule({
  imports: [
    CommonModule,
    ProductCardComponent,
    FormsModule,
    ExploreContainerComponentModule,
    IonicModule ,
    MiniHeaderComponent,
    CustomHeaderComponent,
    ProfileCardComponent,
    HomePageRoutingModule
  ],
  declarations: [HomePage], 
  providers: [ProductDetailsPage]
})
export class HomePageModule {}
