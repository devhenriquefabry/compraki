import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';

import { MyAccountPageRoutingModule } from './my-account-routing.module';
import { MyAccountPage } from './my-account.page';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { SocialLinksComponent } from 'src/app/components/social-links/social-links.component';
import { VnIconComponent } from 'src/app/components/vn-icon/vn-icon.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IonicModule,
    MiniHeaderComponent,
    SocialLinksComponent,
    VnIconComponent,
    MyAccountPageRoutingModule
  ],
  declarations: [MyAccountPage]
})
export class MyAccountPageModule {}
