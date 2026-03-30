import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';


import { LoginPageRoutingModule } from './login-routing.module';

import { LoginPage } from './login.page';

import { LoginFormComponent } from './login-form/login-form.component';
import { LoadingComponent } from 'src/app/components/loading/loading.component';

@NgModule({
  imports: [
    CommonModule,
    LoadingComponent,
    FormsModule,
    LoginFormComponent,
    IonicModule,
    LoginPageRoutingModule
  ],
  declarations: [LoginPage]
})
export class LoginPageModule {}
