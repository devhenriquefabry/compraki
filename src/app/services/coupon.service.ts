import { Injectable } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore, collection, getDocs, getFirestore, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { getFirebaseAuth } from '../core/auth-state';
import { toDate } from '../core/order-stage';
import { Coupon, CouponInput, CouponQuote, CouponStatus } from '../interfaces/coupon';
import { CartItem } from '../interfaces/cart-item';

export class CouponError extends Error {}

export interface CouponReservation {
  redemptionId: string;
  quote: CouponQuote;
  expiresAt: number;
}

/**
 * Cupons. Leitura direta no Firestore (as regras só deixam ver os públicos e
 * ativos, os da própria loja, ou tudo para o admin). Calcular, reservar,
 * criar e editar passam pelas Cloud Functions `couponQuote` e `saveCoupon`.
 */
@Injectable({ providedIn: 'root' })
export class CouponService {
  private readonly db: Firestore;
  private readonly baseUrl = environment.functionsBaseUrl;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
  }

  // ----------------------------------------------------------------- leitura

  /** Cupons públicos e ativos (Vineon e lojas). Datas e esgotados filtra quem usa. */
  async listPublic(max = 100): Promise<Coupon[]> {
    const snap = await getDocs(query(
      collection(this.db, 'coupons'),
      where('visibility', '==', 'public'),
      where('status', '==', 'active'),
      limit(max),
    ));
    return snap.docs.map(d => couponFrom(d.id, d.data()));
  }

  /** Cupons públicos e ativos de uma loja (ficha do produto). */
  async listPublicOfSeller(sellerId: string): Promise<Coupon[]> {
    const snap = await getDocs(query(
      collection(this.db, 'coupons'),
      where('sellerId', '==', sellerId),
      where('visibility', '==', 'public'),
      where('status', '==', 'active'),
      limit(20),
    ));
    return snap.docs.map(d => couponFrom(d.id, d.data()));
  }

  /** Todos os cupons da loja, inclusive pausados e encerrados. */
  watchMine(sellerId: string): Observable<Coupon[]> {
    return this.watch(query(collection(this.db, 'coupons'), where('sellerId', '==', sellerId), limit(100)));
  }

  /** Todos os cupons do app, mais novos primeiro. Só admin lê. */
  watchAll(max = 300): Observable<Coupon[]> {
    return this.watch(query(collection(this.db, 'coupons'), orderBy('createdAt', 'desc'), limit(max)));
  }

  private watch(q: ReturnType<typeof query>): Observable<Coupon[]> {
    return new Observable<Coupon[]>(subscriber => {
      const unsub = onSnapshot(
        q,
        snap => subscriber.next(
          snap.docs
            .map(d => couponFrom(d.id, d.data() as Record<string, any>))
            .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
        ),
        err => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  // ---------------------------------------------------------------- cálculo

  /** Quanto o cupom desconta neste carrinho. Erro traz a frase para a pessoa. */
  async preview(code: string, items: CartItem[], shippingPrice: number): Promise<CouponQuote> {
    const result = await this.call('couponQuote', { action: 'preview', code, items: cartLines(items), shippingPrice });
    return result['quote'] as CouponQuote;
  }

  /** Segura um uso do cupom por 30 min, logo antes de cobrar. */
  async reserve(code: string, items: CartItem[], shippingPrice: number): Promise<CouponReservation> {
    const result = await this.call('couponQuote', { action: 'reserve', code, items: cartLines(items), shippingPrice });
    return {
      redemptionId: String(result['redemptionId']),
      quote: result['quote'] as CouponQuote,
      expiresAt: Number(result['expiresAt']),
    };
  }

  /** Devolve a reserva (a cobrança falhou ou a pessoa tirou o cupom). Nunca lança. */
  async release(redemptionId: string): Promise<void> {
    await this.call('couponQuote', { action: 'release', redemptionId }).catch(() => undefined);
  }

  // ------------------------------------------------------------ criar/editar

  async create(input: CouponInput): Promise<string> {
    const result = await this.call('saveCoupon', { action: 'create', ...input });
    return String(result['code']);
  }

  async update(input: CouponInput): Promise<void> {
    await this.call('saveCoupon', { action: 'update', ...input });
  }

  async setStatus(code: string, status: CouponStatus): Promise<void> {
    await this.call('saveCoupon', { action: 'status', code, status });
  }

  async remove(code: string): Promise<void> {
    await this.call('saveCoupon', { action: 'delete', code });
  }

  private async call(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new CouponError('Entre na sua conta para usar cupons.');

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new CouponError('Sem conexão com a Vineon. Confira a internet e tente de novo.');
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new CouponError(typeof data['error'] === 'string' ? data['error'] : 'Não foi possível conferir o cupom agora.');
    }
    return data;
  }
}

/** Só o que o servidor precisa: ele busca o preço em `products/`. */
function cartLines(items: CartItem[]) {
  return items.map(item => ({
    productId: item.productId || item.productData?.id,
    skuId: item.skuId || null,
    quantity: item.quantity,
  }));
}

export function couponFrom(code: string, d: Record<string, any>): Coupon {
  return {
    code,
    scope: d['scope'] === 'seller' ? 'seller' : 'platform',
    sellerId: d['sellerId'] ?? null,
    sellerName: d['sellerName'] ?? null,
    type: d['type'] ?? 'fixed',
    value: Number(d['value']) || 0,
    maxDiscount: d['maxDiscount'] ? Number(d['maxDiscount']) : null,
    minSubtotal: Number(d['minSubtotal']) || 0,
    productIds: Array.isArray(d['productIds']) ? d['productIds'] : [],
    startsAt: toDate(d['startsAt']),
    endsAt: toDate(d['endsAt']),
    usageLimit: d['usageLimit'] ? Number(d['usageLimit']) : null,
    perUserLimit: Number(d['perUserLimit']) || 1,
    firstPurchaseOnly: d['firstPurchaseOnly'] === true,
    visibility: d['visibility'] === 'private' ? 'private' : 'public',
    status: d['status'] ?? 'paused',
    redeemedCount: Number(d['redeemedCount']) || 0,
    ordersCount: Number(d['ordersCount']) || 0,
    discountTotal: Math.round((Number(d['discountTotal']) || 0) * 100) / 100,
    pausedByAdmin: d['pausedByAdmin'] === true,
    createdAt: toDate(d['createdAt']),
  };
}
