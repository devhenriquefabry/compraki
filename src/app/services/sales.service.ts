import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, query, where, orderBy, 
  onSnapshot, Firestore, doc, updateDoc, serverTimestamp, getDoc, deleteField
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { Observable } from 'rxjs';
import { FiscalDocument, FiscalDocumentType, Order } from '../interfaces/order';

import { environment } from '../../environments/environment';
const firebaseConfig = environment.firebase;

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
      // Data de cada marco alimenta a linha do tempo do comprador e do admin.
      ...(status === 'DELIVERED' ? { deliveredAt: serverTimestamp() } : {}),
      ...(status === 'PROBLEM' ? { shipmentProblemAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp()
    });
  }

  /**
   * Anexa (ou troca) a nota fiscal / declaração de conteúdo desta loja no
   * pedido. O arquivo antigo, se houver, é apagado depois que o novo entra.
   */
  async attachFiscalDocument(
    orderId: string,
    file: File,
    meta: { type: FiscalDocumentType; number?: string | null },
    previous?: FiscalDocument | null
  ): Promise<void> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) throw new Error('Sessão expirada. Entre de novo.');

    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `orders/${orderId}/fiscal/${uid}/${Date.now()}_${safeName}`;
    const storageRef = ref(getStorage(), path);
    await uploadBytes(storageRef, file, { contentType: file.type });
    const url = await getDownloadURL(storageRef);

    const document: FiscalDocument = {
      type: meta.type,
      url,
      path,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      number: meta.number?.trim() || null,
      uploadedAt: serverTimestamp(),
      uploadedBy: uid
    };

    await updateDoc(doc(this.db, 'orders', orderId), {
      [`fiscalDocuments.${uid}`]: document,
      updatedAt: serverTimestamp()
    });

    if (previous?.path && previous.path !== path) {
      await deleteObject(ref(getStorage(), previous.path)).catch(() => undefined);
    }
  }

  async removeFiscalDocument(orderId: string, current: FiscalDocument): Promise<void> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) throw new Error('Sessão expirada. Entre de novo.');
    await updateDoc(doc(this.db, 'orders', orderId), {
      [`fiscalDocuments.${uid}`]: deleteField(),
      updatedAt: serverTimestamp()
    });
    await deleteObject(ref(getStorage(), current.path)).catch(() => undefined);
  }

  /** Venda em tempo real (a tela de detalhe reflete o que o comprador confirma). */
  watchSale(id: string): Observable<Order | null> {
    return new Observable<Order | null>(subscriber =>
      onSnapshot(
        doc(this.db, 'orders', id),
        snap => subscriber.next(snap.exists() ? ({ ...snap.data(), id: snap.id } as Order) : null),
        err => subscriber.error(err)
      )
    );
  }

  /**
   * Loja postou o pedido. O código de rastreio é opcional: sem ele o comprador
   * vê "A caminho" e a loja pode informar depois.
   */
  async markShipped(orderId: string, trackingCode?: string): Promise<void> {
    const code = trackingCode?.trim().toUpperCase();
    await updateDoc(doc(this.db, 'orders', orderId), {
      shipmentStatus: 'SHIPPED',
      shippedAt: serverTimestamp(),
      ...(code ? { 'shippingInfo.trackingCode': code } : {}),
      updatedAt: serverTimestamp()
    });
  }

  async setTrackingCode(orderId: string, trackingCode: string): Promise<void> {
    await updateDoc(doc(this.db, 'orders', orderId), {
      'shippingInfo.trackingCode': trackingCode.trim().toUpperCase(),
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
