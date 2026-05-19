import { LOCALE_ID, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';

registerLocaleData(localePt);

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { BotStatusWidgetComponent } from './components/bot-status-widget/bot-status-widget.component';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app'
import { environment } from 'src/environments/environment.prod';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';


@NgModule({
  declarations: [AppComponent, BotStatusWidgetComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule,

  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: LOCALE_ID, useValue: 'pt-BR' },
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideFirestore(() => getFirestore()),
    provideHttpClient(),
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
