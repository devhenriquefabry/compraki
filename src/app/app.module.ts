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
const firebaseConfig = {
  apiKey: "AIzaSyDD50YO6EznucB9D1yx6ujwjdD3v-ZCfyg",
  authDomain: "compraki-mcu.firebaseapp.com",
  databaseURL: "https://compraki-mcu-default-rtdb.firebaseio.com",
  projectId: "compraki-mcu",
  storageBucket: "compraki-mcu.firebasestorage.app",
  messagingSenderId: "2028715763",
  appId: "1:2028715763:web:5507a8b12473bfc6e50186",
  measurementId: "G-92Q7R0CQR0"

}


@NgModule({
  declarations: [AppComponent, BotStatusWidgetComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule,

  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: LOCALE_ID, useValue: 'pt-BR' },
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideFirestore(() => getFirestore()),
    provideHttpClient(),
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
