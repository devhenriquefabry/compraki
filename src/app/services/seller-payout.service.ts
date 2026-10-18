import { Injectable } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { Firestore, deleteDoc, doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { Observable } from 'rxjs';

import { SellerPayout } from '../core/pix';
import { environment } from '../../environments/environment';

/**
 * Dados para receber (chave Pix) da loja — `sellerPayouts/{uid}`. A loja lê e
 * grava a própria; o admin lê na hora de pagar o repasse (aba Devoluções e
 * repasses). Nada disso é público.
 */
@Injectable({ providedIn: 'root' })
export class SellerPayoutService {
  private readonly db: Firestore;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
  }

  watch(uid: string): Observable<SellerPayout | null> {
    return new Observable<SellerPayout | null>(subscriber =>
      onSnapshot(
        doc(this.db, 'sellerPayouts', uid),
        snap => subscriber.next(snap.exists() ? (snap.data() as SellerPayout) : null),
        err => subscriber.error(err)
      )
    );
  }

  async get(uid: string): Promise<SellerPayout | null> {
    const snap = await getDoc(doc(this.db, 'sellerPayouts', uid));
    return snap.exists() ? (snap.data() as SellerPayout) : null;
  }

  async save(uid: string, payout: Omit<SellerPayout, 'updatedAt'>): Promise<void> {
    await setDoc(doc(this.db, 'sellerPayouts', uid), {
      method: 'pix',
      pixKeyType: payout.pixKeyType,
      pixKey: payout.pixKey,
      holderName: payout.holderName.trim(),
      holderDocument: payout.holderDocument.replace(/\D/g, ''),
      updatedAt: serverTimestamp(),
    });
  }

  async remove(uid: string): Promise<void> {
    await deleteDoc(doc(this.db, 'sellerPayouts', uid));
  }

  /** Nome público da loja (sellers/), para o admin saber para quem paga. */
  async shopName(uid: string): Promise<string | null> {
    const snap = await getDoc(doc(this.db, 'sellers', uid)).catch(() => null);
    const data = snap?.exists() ? snap.data() : null;
    return (data?.['shopName'] || data?.['displayName'] || null) as string | null;
  }
}
