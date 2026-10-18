import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore, collection, doc,
  query, where, orderBy, onSnapshot,
  Firestore, getDocs, limit
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { Observable } from 'rxjs';
import { Order } from '../interfaces/order';

import { environment } from '../../environments/environment';
const firebaseConfig = environment.firebase;

/** O que o app manda para `placeOrder`: o que comprar, para onde e como pagar. */
export interface PlaceOrderInput {
  items: { productId: string; skuId: string | null; quantity: number }[];
  shippingServiceId: number;
  address: {
    street: string; number: string; complement?: string; neighborhood?: string;
    city: string; state: string; postalCode: string;
  };
  buyer: { name: string; cpf: string; phone: string };
  method: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
  couponRedemptionId?: string | null;
  card?: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string };
  /** Total que a pessoa viu na tela: se o servidor chegar a outro, a compra para. */
  expectedTotal: number;
}

export interface PlaceOrderResult {
  orderId: string;
  total: number;
  method: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
  charge: {
    id: string; status: string; pixCode: string | null; bankSlipUrl: string | null;
    digitableLine: string | null; sandbox: boolean;
  } | null;
  cardStatus: string | null;
}

/** Erro do servidor com o código HTTP e, quando houver, o motivo e o total novo. */
export class OrderRequestError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string | null = null, readonly total: number | null = null) {
    super(message);
  }
}

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

  /**
   * Fecha o pedido no servidor (`placeOrder`): ele lê o preço atual dos
   * produtos, recota o frete, confere o cupom, emite a cobrança e grava o
   * pedido. O app só diz o que quer comprar — nunca quanto custa.
   */
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    return this.callFunction<PlaceOrderResult>('placeOrder', input);
  }

  /** Cancela um pedido que ainda espera pagamento (a cobrança é cancelada junto). */
  async cancelOrder(orderId: string): Promise<void> {
    await this.callFunction('cancelOrder', { orderId });
  }

  private async callFunction<T>(name: string, body: unknown): Promise<T> {
    const user = this.auth.currentUser;
    if (!user) throw new OrderRequestError('Entre na sua conta para continuar.', 401);
    const token = await user.getIdToken();
    let response: Response;
    try {
      response = await fetch(`${environment.functionsBaseUrl}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new OrderRequestError('Sem conexão com a Vineon. Confira a internet e tente de novo.', 0);
    }
    const data = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok) {
      throw new OrderRequestError(
        typeof data['error'] === 'string' ? data['error'] : 'Não foi possível concluir agora. Tente de novo.',
        response.status,
        data['reason'] ?? null,
        typeof data['total'] === 'number' ? data['total'] : null,
      );
    }
    return data as T;
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

  /**
   * Todos os pedidos do app, mais recentes primeiro, em tempo real. Só admin
   * lê (firestore.rules). `max` segura o custo: o painel mostra os últimos N.
   */
  watchAllOrders(max = 300): Observable<Order[]> {
    return new Observable<Order[]>(subscriber => {
      const q = query(this.getOrdersCollection(), orderBy('createdAt', 'desc'), limit(max));
      const unsub = onSnapshot(
        q,
        snapshot => subscriber.next(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Order))),
        err => subscriber.error(err)
      );
      return () => unsub();
    });
  }

  /** Acompanha um pedido em tempo real (tela de PIX espera o pagamento cair). */
  watchOrder(orderId: string): Observable<Order | null> {
    return new Observable<Order | null>(subscriber => {
      const unsub = onSnapshot(
        doc(this.db, 'orders', orderId),
        snap => subscriber.next(snap.exists() ? ({ ...snap.data(), id: snap.id } as Order) : null),
        err => subscriber.error(err)
      );

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
