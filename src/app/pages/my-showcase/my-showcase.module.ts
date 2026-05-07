import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { MyShowcasePageRoutingModule } from './my-showcase-routing.module';

import { MyShowcasePage } from './my-showcase.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MyShowcasePageRoutingModule
  ],
  declarations: [MyShowcasePage]
})
export class MyShowcasePageModule {}
