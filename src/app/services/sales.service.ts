import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, query, where, orderBy, 
  onSnapshot, Firestore, doc, updateDoc, serverTimestamp, getDoc 
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { Observable } from 'rxjs';
import { Order } from '../interfaces/order';

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
export class SalesService {
  private db: Firestore;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
  }

  // Busca todas as vendas (pedidos) de um vendedor específico
  getSellerSales(sellerId: string): Observable<Order[]> {
    return new Observable<Order[]>(subscriber => {
      const q = query(
        collection(this.db, 'orders'),
        where('sellerIds', 'array-contains', sellerId),
        orderBy('createdAt', 'desc')
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const sales = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Order));
        subscriber.next(sales);
      }, (err) => subscriber.error(err));

      return () => unsub();
    });
  }

  // Atualiza o status da entrega
  async updateShipmentStatus(orderId: string, status: string): Promise<void> {
    const orderRef = doc(this.db, 'orders', orderId);
    await updateDoc(orderRef, {
      shipmentStatus: status,
      updatedAt: serverTimestamp()
    });
  }

  async getSaleById(id: string): Promise<Order | null> {
    const docRef = doc(this.db, 'orders', id);
    const snap = await getDoc(docRef);
    if(snap.exists()) {
      return { id: snap.id, ...snap.data() } as Order;
    }
    return null;
  }

  async updateSaleData(orderId: string, data: any): Promise<void> {
    const orderRef = doc(this.db, 'orders', orderId);
    await updateDoc(orderRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
  }
}
