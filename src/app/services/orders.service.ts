import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, updateDoc, doc, 
  query, where, orderBy, onSnapshot, serverTimestamp, 
  Firestore, getDocs 
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
export class OrdersService {
  private db: Firestore;
  private auth;

  constructor() {
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
}
