import { Injectable } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { getCurrentUser } from '../core/auth-state';
import { Product } from '../interfaces/product';
import { ProductReview, ReviewSummary } from '../interfaces/review';

/** Status de pedido que contam como compra paga. Mesma lista das regras e da função. */
export const PAID_ORDER_STATUSES = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'] as const;

export const REVIEW_MAX_LENGTH = 2000;

/** Até onde a página lista avaliações. Acima disso o resumo vem do produto. */
const REVIEWS_PAGE_SIZE = 50;

/** Situação da pessoa logada diante do formulário de avaliação. */
export type ReviewEligibility =
  | { kind: 'guest' }
  | { kind: 'seller' }
  | { kind: 'not-buyer' }
  | { kind: 'can-review'; orderId: string; existing: ProductReview | null };

@Injectable({ providedIn: 'root' })
export class ProductReviewsService {
  private readonly db: Firestore;
  private readonly streams = new Map<string, Observable<ProductReview[]>>();

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
  }

  /** Avaliações mais recentes do produto, em tempo real. Leitura pública. */
  watchReviews(productId: string): Observable<ProductReview[]> {
    const cached = this.streams.get(productId);
    if (cached) return cached;

    const stream = new Observable<ProductReview[]>(subscriber => {
      const q = query(
        collection(this.db, 'products', productId, 'reviews'),
        orderBy('createdAt', 'desc'),
        limit(REVIEWS_PAGE_SIZE)
      );
      return onSnapshot(
        q,
        snapshot => subscriber.next(snapshot.docs.map(d => ({ ...(d.data() as ProductReview), id: d.id }))),
        // Sem avaliações legíveis a página segue funcionando — só não lista nada.
        () => subscriber.next([])
      );
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.streams.set(productId, stream);
    return stream;
  }

  /**
   * Nota do produto. Usa o agregado mantido pela Cloud Function quando existe;
   * antes do primeiro cálculo (ou se a função ainda não foi publicada) conta a
   * partir da lista carregada.
   */
  summarize(product: Product, reviews: ProductReview[]): ReviewSummary {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let count = 0;
    let average = 0;

    const aggregate = product.ratingBreakdown;
    const aggregateCount = product.reviewCount ?? 0;

    if (aggregate && aggregateCount >= reviews.length && aggregateCount > 0) {
      for (let star = 1; star <= 5; star++) counts[star] = aggregate[String(star)] ?? 0;
      count = aggregateCount;
      average = product.rating ?? 0;
    } else {
      for (const review of reviews) {
        const star = Math.min(5, Math.max(1, Math.round(review.rating)));
        counts[star]++;
      }
      count = reviews.length;
      average = count ? reviews.reduce((sum, r) => sum + r.rating, 0) / count : 0;
    }

    return {
      average: Math.round(average * 10) / 10,
      count,
      bars: [5, 4, 3, 2, 1].map(stars => ({
        stars,
        count: counts[stars],
        percent: count ? Math.round((counts[stars] / count) * 100) : 0
      }))
    };
  }

  /**
   * Diz se a pessoa logada pode avaliar: precisa ter um pedido pago com o
   * produto e não ser a própria vendedora. As regras do Firestore e a Cloud
   * Function conferem de novo do lado do servidor — isto só decide o que mostrar.
   */
  async getEligibility(product: Product): Promise<ReviewEligibility> {
    const user = getCurrentUser();
    if (!user) return { kind: 'guest' };
    if (!product.id) return { kind: 'not-buyer' };
    if (product.sellerId === user.uid) return { kind: 'seller' };

    const [orders, existingSnap] = await Promise.all([
      getDocs(query(collection(this.db, 'orders'), where('userId', '==', user.uid))),
      getDoc(doc(this.db, 'products', product.id, 'reviews', user.uid))
    ]);

    const existing = existingSnap.exists()
      ? ({ ...(existingSnap.data() as ProductReview), id: existingSnap.id })
      : null;

    const paidOrder = orders.docs.find(orderDoc => {
      const order = orderDoc.data();
      const paid = (PAID_ORDER_STATUSES as readonly string[]).includes(order['status']);
      const items: any[] = Array.isArray(order['items']) ? order['items'] : [];
      return paid && items.some(item => (item?.productId ?? item?.productData?.id) === product.id);
    });

    if (!paidOrder) return { kind: 'not-buyer' };
    return { kind: 'can-review', orderId: existing?.orderId || paidOrder.id, existing };
  }

  /** Cria ou substitui a avaliação da pessoa logada. */
  async saveReview(productId: string, input: { rating: number; comment: string; orderId: string }, existing: ProductReview | null) {
    const user = getCurrentUser();
    if (!user) throw new Error('Entre na sua conta para avaliar.');

    const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
    const comment = input.comment.trim().slice(0, REVIEW_MAX_LENGTH);

    // `setDoc` sem merge: o documento inteiro é regravado, então o cliente
    // nunca carrega `verifiedPurchase` adiante — a função recalcula.
    await setDoc(doc(this.db, 'products', productId, 'reviews', user.uid), {
      userId: user.uid,
      userName: publicReviewerName(user.displayName, user.email),
      rating,
      comment,
      orderId: input.orderId,
      createdAt: existing?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  async deleteReview(productId: string) {
    const user = getCurrentUser();
    if (!user) return;
    await deleteDoc(doc(this.db, 'products', productId, 'reviews', user.uid));
  }
}

/** "Henrique Fabry" vira "Henrique F." — avaliação é pública. */
export function publicReviewerName(displayName: string | null, email: string | null): string {
  const source = displayName?.trim() || email?.split('@')[0] || 'Comprador';
  const [first, ...rest] = source.split(/\s+/);
  const initial = rest.length ? ` ${rest[rest.length - 1].charAt(0).toUpperCase()}.` : '';
  return `${first}${initial}`.slice(0, 60);
}
