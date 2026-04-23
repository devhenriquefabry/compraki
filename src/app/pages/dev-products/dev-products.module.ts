import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { DevProductsPageRoutingModule } from './dev-products-routing.module';
import { DevProductsPage } from './dev-products.page';

import { AdminStatsGridComponent } from 'src/app/components/admin-stats-grid/admin-stats-grid.component';

import { AdminFilterModalComponent } from 'src/app/components/admin-filter-modal/admin-filter-modal.component';
import { AdminProductCardComponent } from 'src/app/components/admin-product-card/admin-product-card.component';
import { AdminChatSidebarComponent } from 'src/app/components/admin-chat-sidebar/admin-chat-sidebar.component';

import { AdminHeaderComponent } from 'src/app/components/admin-header/admin-header.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    DevProductsPageRoutingModule,
    AdminStatsGridComponent,
    AdminFilterModalComponent,
    AdminProductCardComponent,
    AdminChatSidebarComponent,
    AdminHeaderComponent,
    DevProductsPage
  ],
  declarations: []
})
export class DevProductsPageModule {}
