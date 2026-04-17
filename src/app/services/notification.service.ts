import { Injectable, inject } from '@angular/core';
import { collection, query, where, onSnapshot, getFirestore, query as fsQuery, orderBy, limit } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { AlertController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';

const firebaseConfig = {
  apiKey: "AIzaSyDD50YO6EznucB9D1yx6ujwjdD3v-ZCfyg",
  authDomain: "compraki-mcu.firebaseapp.com",
  projectId: "compraki-mcu",
  storageBucket: "compraki-mcu.firebasestorage.app",
  messagingSenderId: "2028715763",
  appId: "1:2028715763:web:5507a8b12473bfc6e50186",
  measurementId: "G-92Q7R0CQR0"
};

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private router = inject(Router);
  private db;
  private auth;
  private isFirstRun = true;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.auth = getAuth(app);
  }

  initOrderListener() {
    onAuthStateChanged(this.auth, (user) => {
      if (user) {
        const q = fsQuery(
          collection(this.db, 'orders'),
          where('sellerIds', 'array-contains', user.uid),
          orderBy('createdAt', 'desc'),
          limit(1)
        );

        onSnapshot(q, async (snapshot) => {
          if (this.isFirstRun) {
            this.isFirstRun = false;
            return;
          }

          if (!snapshot.empty) {
            const newOrder = snapshot.docs[0].data();
            const orderId = snapshot.docs[0].id;
            
            // Só alertar se for um pedido novo e pago (RECEIVED)
            if (newOrder['status'] === 'RECEIVED' || newOrder['status'] === 'PENDING') {
              this.showSaleAlert(orderId, newOrder);
            }
          }
        });
      }
    });
  }

  private async showSaleAlert(orderId: string, orderData: any) {
    const alert = await this.alertCtrl.create({
      header: '🎉 Nova Venda Realizada!',
      subHeader: `Você vendeu um item por ${orderData.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
      message: 'Clique para ver os detalhes da entrega e o comprador.',
      cssClass: 'sale-notification-alert',
      buttons: [
        {
          text: 'Agora não',
          role: 'cancel'
        },
        {
          text: 'Ver Venda',
          handler: () => {
            this.router.navigate(['/sale-details', orderId]);
          }
        }
      ]
    });

    await alert.present();
  }
}
