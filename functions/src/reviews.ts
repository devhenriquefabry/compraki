import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { region } from './shared/http';

/**
 * Avaliações de produto: `products/{productId}/reviews/{reviewerId}`.
 *
 * A cada escrita esta função faz duas coisas:
 *
 * 1. CONFERE A COMPRA. As regras do Firestore já exigem um pedido pago da
 *    própria pessoa, mas não conseguem olhar dentro de `items`. Aqui olhamos:
 *    se o produto não está no pedido citado, a avaliação é apagada. Se está,
 *    ela ganha `verifiedPurchase: true` (campo que o cliente não pode gravar).
 *
 * 2. RECALCULA A NOTA do produto (`rating`, `reviewCount`, `ratingBreakdown`)
 *    lendo todas as avaliações. Recontar em vez de somar incrementos deixa o
 *    número autocorretivo: um evento perdido se conserta na escrita seguinte.
 *    Lê só o campo `rating`, então o custo cresce devagar.
 */

const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'];

export const onProductReviewWritten = onDocumentWritten(
  { document: 'products/{productId}/reviews/{reviewerId}', region, maxInstances: 10 },
  async (event) => {
    const { productId, reviewerId } = event.params;
    const after = event.data?.after;

    if (after?.exists) {
      const review = after.data() ?? {};
      const verified = await isVerifiedPurchase(productId, reviewerId, String(review['orderId'] || ''));

      if (!verified) {
        logger.warn('Avaliação sem compra correspondente removida', { productId, reviewerId });
        await after.ref.delete();
        return; // A exclusão dispara esta função de novo, que recalcula a nota.
      }

      // Só grava se mudou: a própria escrita dispara a função outra vez.
      if (review['verifiedPurchase'] !== true) {
        await after.ref.update({ verifiedPurchase: true });
        return;
      }
    }

    await recomputeProductRating(productId);
  }
);

async function isVerifiedPurchase(productId: string, reviewerId: string, orderId: string): Promise<boolean> {
  if (!orderId) return false;

  const orderSnap = await getFirestore().doc(`orders/${orderId}`).get();
  const order = orderSnap.data();
  if (!order || order['userId'] !== reviewerId) return false;
  if (!PAID_STATUSES.includes(order['status'])) return false;

  const items: any[] = Array.isArray(order['items']) ? order['items'] : [];
  return items.some(item => (item?.productId ?? item?.productData?.id) === productId);
}

async function recomputeProductRating(productId: string): Promise<void> {
  const db = getFirestore();
  const productRef = db.doc(`products/${productId}`);

  const snapshot = await productRef.collection('reviews').select('rating').get();
  const breakdown: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let total = 0;

  snapshot.forEach(docSnap => {
    const rating = Math.min(5, Math.max(1, Math.round(Number(docSnap.get('rating')) || 0)));
    breakdown[String(rating)]++;
    total += rating;
  });

  const count = snapshot.size;

  try {
    await productRef.update({
      reviewCount: count,
      ratingBreakdown: breakdown,
      rating: count ? Math.round((total / count) * 10) / 10 : FieldValue.delete()
    });
  } catch (error) {
    // Produto apagado: não há nota a guardar.
    logger.debug('Não foi possível atualizar a nota do produto', { productId, error });
  }
}
