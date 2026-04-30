import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, updateDoc, doc, 
  query, where, orderBy, onSnapshot, serverTimestamp, 
  Firestore, getDocs, increment
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { Observable } from 'rxjs';
import { Order } from '../interfaces/order';
import { WhatsappInstancesService } from './whatsapp-instances.service';

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
export class OrdersService {
  private db: Firestore;
  private auth;

  constructor(private whatsappService: WhatsappInstancesService) {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.auth = getAuth(app);
  }

  private getOrdersCollection() {
    return collection(this.db, 'orders');
  }

  async createOrder(orderData: Omit<Order, 'id' | 'createdAt'>): Promise<string> {
    const docRef = await addDoc(this.getOrdersCollection(), {
      ...orderData,
      createdAt: serverTimestamp()
    });

    // ATUALIZAÇÃO DO DASHBOARD FINANCEIRO E INVENTÁRIO (soldCount)
    try {
      if (orderData.items && orderData.items.length > 0) {
        for (const item of orderData.items) {
          if (item.productData && item.productData.id) {
            const productRef = doc(this.db, 'products', item.productData.id);
            await updateDoc(productRef, {
              soldCount: increment(item.quantity),
              stock: increment(-item.quantity)
            });
          }
        }
      }
    } catch (metricError) {
      console.warn("Aviso: Falha ao atualizar as métricas financeiras do produto", metricError);
    }

    void this.dispatchProductSoldTrigger(docRef.id, orderData);

    return docRef.id;
  }

  async updateOrderStatus(orderId: string, status: Order['status']): Promise<void> {
    const orderDoc = doc(this.db, 'orders', orderId);
    await updateDoc(orderDoc, { 
      status: status,
      updatedAt: serverTimestamp()
    });
  }

  getUserOrders(userId: string): Observable<Order[]> {
    return new Observable<Order[]>(subscriber => {
      const q = query(
        this.getOrdersCollection(), 
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const orders = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Order));
        subscriber.next(orders);
      }, (err) => subscriber.error(err));

      return () => unsub();
    });
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    const q = query(this.getOrdersCollection(), where('id', '==', orderId));
    // Since we usually have the ID from the route, we can use doc()
    const docRef = doc(this.db, 'orders', orderId);
    const snap = await getDocs(query(this.getOrdersCollection(), where('__name__', '==', orderId)));
    
    if (!snap.empty) {
      return { ...snap.docs[0].data(), id: snap.docs[0].id } as Order;
    }
    return null;
  }

  private async dispatchProductSoldTrigger(orderId: string, orderData: Omit<Order, 'id' | 'createdAt'>): Promise<void> {
    try {
      const productNames = orderData.items
        .map(item => item.productData?.name)
        .filter(Boolean)
        .join(', ');

      await this.whatsappService.dispatchTrigger({
        eventType: 'product_sold',
        data: {
          pedido: orderId,
          nome: orderData.customerData?.name || 'Cliente',
          email: orderData.customerData?.email || '',
          telefone: orderData.customerData?.phone || '',
          produto: productNames,
          valor: this.formatCurrency(orderData.total)
        }
      });
    } catch (error) {
      console.warn('Falha ao disparar gatilho de venda de produto:', error);
    }
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value || 0);
  }
}
