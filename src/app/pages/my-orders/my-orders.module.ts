import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { MyOrdersPageRoutingModule } from './my-orders-routing.module';
import { MyOrdersPage } from './my-orders.page';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MyOrdersPageRoutingModule,
    MyOrdersPage // Agora é importado pois é standalone
  ]
})
export class MyOrdersPageModule {}
