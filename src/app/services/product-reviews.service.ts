import { Injectable } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
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
  updateDoc,
  where
} from 'firebase/firestore';
import { deleteObject, getStorage, ref, uploadBytes } from 'firebase/storage';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { getCurrentUser } from '../core/auth-state';
import { resizeImage } from '../core/image-resize';
import { orderStage, productIdOf, receivedAt, toDate } from '../core/order-stage';
import { Order } from '../interfaces/order';
import { Product } from '../interfaces/product';
import { ListingMatch, PendingReview, ProductReview, ReviewSummary } from '../interfaces/review';

/** Status de pedido que contam como compra paga. Mesma lista das regras e da função. */
export const PAID_ORDER_STATUSES = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'] as const;

export const REVIEW_MAX_LENGTH = 2000;
export const REVIEW_MAX_PHOTOS = 5;
export const REPLY_MAX_LENGTH = 1000;

/** Até onde a página do produto lista avaliações. Acima disso o resumo vem do produto. */
const REVIEWS_PAGE_SIZE = 50;

/** Situação da pessoa logada diante do formulário de avaliação. */
export type ReviewEligibility =
  | { kind: 'guest' }
  | { kind: 'seller' }
  | { kind: 'not-buyer' }
  /** Comprou, mas ainda não chegou: avalia depois da entrega. */
  | { kind: 'awaiting-delivery' }
  | { kind: 'can-review'; orderId: string; existing: ProductReview | null };

export interface ReviewInput {
  rating: number;
  comment: string;
  orderId: string;
  photos: string[];
  matchesListing: ListingMatch | null;
}

@Injectable({ providedIn: 'root' })
export class ProductReviewsService {
  private readonly db: Firestore;
  private readonly streams = new Map<string, Observable<ProductReview[]>>();

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
  }

  // ------------------------------------------------------------------ leitura

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
        snapshot => subscriber.next(snapshot.docs.map(d => ({ ...(d.data() as ProductReview), id: d.id, productId }))),
        // Sem avaliações legíveis a página segue funcionando — só não lista nada.
        () => subscriber.next([])
      );
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.streams.set(productId, stream);
    return stream;
  }

  /** Todas as avaliações que a pessoa escreveu, mais recentes primeiro. */
  watchMine(uid: string): Observable<ProductReview[]> {
    return this.watchGroup(where('userId', '==', uid));
  }

  /** Avaliações dos produtos de uma loja (preenchido pela função ao verificar). */
  watchStore(sellerId: string): Observable<ProductReview[]> {
    return this.watchGroup(where('sellerId', '==', sellerId));
  }

  /**
   * Consulta de grupo (`reviews` de todos os produtos). Ordena aqui para usar
   * só o índice de campo único — sem índice composto para manter.
   */
  private watchGroup(filter: ReturnType<typeof where>): Observable<ProductReview[]> {
    return new Observable<ProductReview[]>(subscriber => onSnapshot(
      query(collectionGroup(this.db, 'reviews'), filter),
      snapshot => {
        const list = snapshot.docs.map(d => ({
          ...(d.data() as ProductReview),
          id: d.id,
          productId: d.ref.parent.parent?.id ?? '',
        }));
        list.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? Date.now()) - (toDate(a.createdAt)?.getTime() ?? Date.now()));
        subscriber.next(list);
      },
      error => subscriber.error(error)
    ));
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
    let match = { yes: 0, partly: 0, no: 0 };
    let photoCount = 0;

    const aggregate = product.ratingBreakdown;
    const aggregateCount = product.reviewCount ?? 0;

    if (aggregate && aggregateCount >= reviews.length && aggregateCount > 0) {
      for (let star = 1; star <= 5; star++) counts[star] = aggregate[String(star)] ?? 0;
      count = aggregateCount;
      average = product.rating ?? 0;
      match = { yes: 0, partly: 0, no: 0, ...(product.listingMatch ?? {}) };
      photoCount = product.reviewPhotoCount ?? reviews.filter(r => reviewPhotos(r).length).length;
    } else {
      for (const review of reviews) {
        const star = Math.min(5, Math.max(1, Math.round(review.rating)));
        counts[star]++;
        if (review.matchesListing) match[review.matchesListing]++;
        if (reviewPhotos(review).length) photoCount++;
      }
      count = reviews.length;
      average = count ? reviews.reduce((sum, r) => sum + r.rating, 0) / count : 0;
    }

    const answered = match.yes + match.partly + match.no;

    return {
      average: Math.round(average * 10) / 10,
      count,
      bars: [5, 4, 3, 2, 1].map(stars => ({
        stars,
        count: counts[stars],
        percent: count ? Math.round((counts[stars] / count) * 100) : 0
      })),
      listing: answered ? { answered, yesPercent: Math.round((match.yes / answered) * 100) } : null,
      photoCount,
    };
  }

  /**
   * Diz se a pessoa logada pode avaliar: precisa ter recebido um pedido com o
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
      ? ({ ...(existingSnap.data() as ProductReview), id: existingSnap.id, productId: product.id })
      : null;
    if (existing) return { kind: 'can-review', orderId: existing.orderId, existing };

    const withProduct = orders.docs
      .map(d => ({ ...(d.data() as Order), id: d.id }))
      .filter(order => (order.items || []).some(item => productIdOf(item) === product.id));

    const delivered = withProduct.find(order => orderStage(order) === 'done');
    if (delivered) return { kind: 'can-review', orderId: delivered.id!, existing: null };

    const onTheWay = withProduct.some(order => ['preparing', 'shipping'].includes(orderStage(order)));
    return onTheWay ? { kind: 'awaiting-delivery' } : { kind: 'not-buyer' };
  }

  /** A avaliação que a pessoa logada já fez deste produto, se houver. */
  async getMyReview(productId: string): Promise<ProductReview | null> {
    const user = getCurrentUser();
    if (!user) return null;
    const snap = await getDoc(doc(this.db, 'products', productId, 'reviews', user.uid));
    return snap.exists() ? { ...(snap.data() as ProductReview), id: snap.id, productId } : null;
  }

  /**
   * Produtos entregues que a pessoa ainda não avaliou. Um produto aparece uma
   * vez só (a avaliação é por produto), pelo pedido entregue mais recente.
   * Produto da própria loja não entra.
   */
  pendingFrom(orders: Order[], mine: ProductReview[], uid: string): PendingReview[] {
    const reviewed = new Set(mine.map(r => r.productId));
    const byProduct = new Map<string, PendingReview>();

    for (const order of orders) {
      if (orderStage(order) !== 'done' || !order.id) continue;
      const delivered = receivedAt(order);
      for (const item of order.items || []) {
        const productId = productIdOf(item);
        const data = item.productData;
        if (!productId || reviewed.has(productId) || data?.sellerId === uid) continue;
        const current = byProduct.get(productId);
        if (current && (current.deliveredAt?.getTime() ?? 0) >= (delivered?.getTime() ?? 0)) continue;
        byProduct.set(productId, {
          key: `${order.id}_${productId}`,
          orderId: order.id,
          productId,
          name: data?.name || 'Produto',
          photo: data?.photoURL?.[0] || null,
          variant: item.variantLabel || null,
          sellerId: data?.sellerId || null,
          deliveredAt: delivered,
        });
      }
    }

    return [...byProduct.values()].sort((a, b) => (b.deliveredAt?.getTime() ?? 0) - (a.deliveredAt?.getTime() ?? 0));
  }

  // ------------------------------------------------------------------ escrita

  /**
   * Cria ou edita a avaliação da pessoa logada. Na edição só os campos do
   * autor são enviados: selo de compra, "útil" e resposta da loja ficam como
   * estão (as regras recusam qualquer outra coisa).
   */
  async saveReview(productId: string, input: ReviewInput, existing: ProductReview | null) {
    const user = getCurrentUser();
    if (!user) throw new Error('Entre na sua conta para avaliar.');

    const fields = {
      userId: user.uid,
      userName: publicReviewerName(user.displayName, user.email),
      rating: Math.min(5, Math.max(1, Math.round(input.rating))),
      comment: input.comment.trim().slice(0, REVIEW_MAX_LENGTH),
      photos: input.photos.slice(0, REVIEW_MAX_PHOTOS),
      matchesListing: input.matchesListing,
      updatedAt: serverTimestamp(),
    };
    const reviewRef = doc(this.db, 'products', productId, 'reviews', user.uid);

    if (existing) {
      await updateDoc(reviewRef, fields);
    } else {
      await setDoc(reviewRef, { ...fields, orderId: input.orderId, createdAt: serverTimestamp() });
    }
  }

  async deleteReview(productId: string) {
    const user = getCurrentUser();
    if (!user) return;
    await deleteDoc(doc(this.db, 'products', productId, 'reviews', user.uid));
  }

  /** Reduz e sobe uma foto. Devolve o caminho no Storage, que vai na avaliação. */
  async uploadPhoto(productId: string, file: File): Promise<string> {
    const user = getCurrentUser();
    if (!user) throw new Error('Entre na sua conta para enviar fotos.');
    const blob = await resizeImage(file);
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `review-photos/${user.uid}/${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await uploadBytes(ref(getStorage(), path), blob, { contentType: blob.type || 'image/jpeg' });
    return path;
  }

  /** Foto enviada mas descartada antes de publicar (a função cuida das publicadas). */
  async discardPhoto(path: string) {
    try {
      await deleteObject(ref(getStorage(), path));
    } catch {
      // Sem importância: arquivo órfão não aparece em lugar nenhum.
    }
  }

  // ------------------------------------------------------------ "útil" e loja

  /** Ids (uid do autor) das avaliações deste produto que a pessoa marcou como úteis. */
  async getMyVotes(productId: string): Promise<string[]> {
    const user = getCurrentUser();
    if (!user) return [];
    try {
      const snap = await getDoc(doc(this.db, 'products', productId, 'reviewVotes', user.uid));
      const ids = snap.get('reviewIds');
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  }

  async setVotes(productId: string, reviewIds: string[]) {
    const user = getCurrentUser();
    if (!user) throw new Error('Entre na sua conta.');
    await setDoc(doc(this.db, 'products', productId, 'reviewVotes', user.uid), {
      reviewIds: [...new Set(reviewIds)].slice(-200),
      updatedAt: serverTimestamp(),
    });
  }

  /** Resposta pública da loja. Só a loja dona do produto consegue (regras). */
  async saveReply(productId: string, reviewerId: string, text: string, existing: ProductReview['sellerReply']) {
    await updateDoc(doc(this.db, 'products', productId, 'reviews', reviewerId), {
      sellerReply: {
        text: text.trim().slice(0, REPLY_MAX_LENGTH),
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  async deleteReply(productId: string, reviewerId: string) {
    await updateDoc(doc(this.db, 'products', productId, 'reviews', reviewerId), { sellerReply: deleteField() });
  }
}

/** "Henrique Fabry" vira "Henrique F." — avaliação é pública. */
export function publicReviewerName(displayName: string | null, email: string | null): string {
  const source = displayName?.trim() || email?.split('@')[0] || 'Comprador';
  const [first, ...rest] = source.split(/\s+/);
  const initial = rest.length ? ` ${rest[rest.length - 1].charAt(0).toUpperCase()}.` : '';
  return `${first}${initial}`.slice(0, 60);
}

/** Caminhos de foto válidos desta avaliação (só da pasta do próprio autor). */
export function reviewPhotos(review: ProductReview): string[] {
  const prefix = `review-photos/${review.userId}/`;
  return (review.photos || []).filter(path => typeof path === 'string' && path.startsWith(prefix));
}

/**
 * URL pública de uma foto de avaliação. As regras do Storage deixam ler a
 * pasta sem token, então dá para montar a URL sem ida ao servidor.
 */
export function reviewPhotoUrl(path: string): string {
  const bucket = environment.firebase.storageBucket;
  const emulators = (environment as { emulators?: { host: string; storage: number } }).emulators;
  const base = emulators ? `http://${emulators.host}:${emulators.storage}` : 'https://firebasestorage.googleapis.com';
  return `${base}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}

export const STAR_LABELS = ['', 'Péssimo', 'Ruim', 'Regular', 'Bom', 'Excelente'];

export const LISTING_MATCH_LABEL: Record<ListingMatch, string> = {
  yes: 'Sim, igual ao anúncio',
  partly: 'Em parte',
  no: 'Não, é diferente',
};
