import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, doc, updateDoc, query, where, 
  orderBy, onSnapshot, serverTimestamp, Firestore 
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { Order } from '../interfaces/order';

import { environment } from '../../environments/environment';
const firebaseConfig = environment.firebase;

@Injectable({
  providedIn: 'root'
})
export class RefundsService {
  private db: Firestore;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
  }

  // Comprador solicita devolução
  async requestRefund(orderId: string, userId: string, reason: string): Promise<void> {
    const orderDoc = doc(this.db, 'orders', orderId);
    await updateDoc(orderDoc, {
      'refundInfo.status': 'REQUESTED',
      'refundInfo.reason': reason,
      'refundInfo.requestedAt': serverTimestamp(),
      'refundInfo.requestedBy': userId
    });
  }

  // Admin aprova devolução
  async approveRefund(orderId: string, adminId: string, notes?: string): Promise<void> {
    const orderDoc = doc(this.db, 'orders', orderId);
    await updateDoc(orderDoc, {
      'refundInfo.status': 'APPROVED',
      'refundInfo.adminNotes': notes || '',
      'refundInfo.processedAt': serverTimestamp(),
      'refundInfo.processedBy': adminId
    });
  }

  // Admin rejeita devolução
  async rejectRefund(orderId: string, adminId: string, notes?: string): Promise<void> {
    const orderDoc = doc(this.db, 'orders', orderId);
    await updateDoc(orderDoc, {
      'refundInfo.status': 'REJECTED',
      'refundInfo.adminNotes': notes || '',
      'refundInfo.processedAt': serverTimestamp(),
      'refundInfo.processedBy': adminId
    });
  }

  // Atualiza após o estorno no Asaas ser concluído
  async completeRefundProcess(orderId: string, refundId: string): Promise<void> {
    const orderDoc = doc(this.db, 'orders', orderId);
    await updateDoc(orderDoc, {
      status: 'REFUNDED',
      'refundInfo.status': 'COMPLETED',
      'refundInfo.asaasRefundId': refundId,
      'escrowInfo.status': 'REFUNDED'
    });
  }

  // Libera o dinheiro para o vendedor manualmente (Admin)
  async releaseEscrowManually(orderId: string): Promise<void> {
    const orderDoc = doc(this.db, 'orders', orderId);
    await updateDoc(orderDoc, {
      'escrowInfo.status': 'RELEASED',
      'escrowInfo.releasedAt': serverTimestamp()
    });
  }

  // --- Observables para o Dashboard do Admin ---

  getAllRefundRequests(): Observable<Order[]> {
    return new Observable<Order[]>(subscriber => {
      const q = query(
        collection(this.db, 'orders'),
        where('refundInfo.status', 'in', ['REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED']),
        orderBy('refundInfo.requestedAt', 'desc')
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const orders = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Order));
        subscriber.next(orders);
      }, (err) => subscriber.error(err));

      return () => unsub();
    });
  }

  getOrdersInEscrow(): Observable<Order[]> {
    return new Observable<Order[]>(subscriber => {
      const q = query(
        collection(this.db, 'orders'),
        where('escrowInfo.status', '==', 'HOLDING'),
        orderBy('escrowInfo.releaseDate', 'asc')
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const orders = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Order));
        subscriber.next(orders);
      }, (err) => subscriber.error(err));

      return () => unsub();
    });
  }

  getOrdersWithReleasedEscrow(): Observable<Order[]> {
    return new Observable<Order[]>(subscriber => {
      const q = query(
        collection(this.db, 'orders'),
        where('escrowInfo.status', '==', 'RELEASED'),
        orderBy('escrowInfo.releasedAt', 'desc')
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const orders = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Order));
        subscriber.next(orders);
      }, (err) => subscriber.error(err));

      return () => unsub();
    });
  }
}
