import { Injectable, inject } from '@angular/core';
import { collection, query, where, onSnapshot, getFirestore, query as fsQuery, orderBy, limit } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { AlertController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';

import { environment } from '../../environments/environment';
const firebaseConfig = environment.firebase;

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
        }, (err) => {
          // Sem handler aqui, o SDK loga "Uncaught Error in snapshot listener"
          // em TODA sessão logada — mesmo quando o alerta de venda nunca é o
          // problema real. Só silencia; não afeta o resto do app.
          console.warn('Listener de novos pedidos parou (alerta de venda em tempo real desativado nesta sessão):', err);
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
