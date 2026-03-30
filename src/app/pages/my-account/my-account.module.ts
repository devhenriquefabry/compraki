import { NgModule } from '@angular/core';
import { CommonModule, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';



import { IonicModule } from '@ionic/angular';

import { MyAccountPageRoutingModule } from './my-account-routing.module';

import { MyAccountPage } from './my-account.page';
import { CustomHeaderComponent } from 'src/app/components/custom-header/custom-header.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    NgIf,
    IonicModule,
    CustomHeaderComponent,
    MyAccountPageRoutingModule
  ],
  declarations: [MyAccountPage]
})
export class MyAccountPageModule {}
