import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { BotsPageRoutingModule } from './bots-routing.module';

import { BotsPage } from './bots.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    BotsPageRoutingModule
  ],
  declarations: [BotsPage]
})
export class BotsPageModule {}
