import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { WebhookTesterPageRoutingModule } from './webhook-tester-routing.module';
import { WebhookTesterPage } from './webhook-tester.page';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    WebhookTesterPageRoutingModule,
    MiniHeaderComponent
  ],
  declarations: [WebhookTesterPage]
})
export class WebhookTesterPageModule {}
