import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { notifyUser } from './notifications';
import { region } from './shared/http';

/**
 * Avaliações de produto: `products/{productId}/reviews/{reviewerId}`.
 *
 * A cada escrita esta função:
 *
 * 1. CONFERE A COMPRA. As regras do Firestore já exigem um pedido entregue da
 *    própria pessoa, mas não conseguem olhar dentro de `items`. Aqui olhamos:
 *    se o produto não está no pedido citado, a avaliação é apagada. Se está,
 *    ela ganha `verifiedPurchase: true` e os campos de leitura rápida
 *    (`sellerId`, `productName`, `productPhoto`) que "Minhas avaliações" e
 *    "Avaliações da loja" consultam — nenhum deles o cliente pode gravar.
 *
 * 2. LIMPA AS FOTOS. Caminho que não é da pasta da própria pessoa para este
 *    produto sai da lista; arquivo que saiu da avaliação (ou da avaliação
 *    apagada) sai do Storage.
 *
 * 3. RECALCULA A NOTA do produto (`rating`, `reviewCount`, `ratingBreakdown`,
 *    `reviewPhotoCount`, `listingMatch`) lendo todas as avaliações — só quando
 *    algo que entra na conta mudou (nota, fotos, "como no anúncio"). Voto de
 *    "útil" e resposta da loja não recalculam. Recontar em vez de somar deixa
 *    o número autocorretivo.
 *
 * 4. AVISA o comprador quando a loja responde pela primeira vez.
 */

const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'];
const MAX_PHOTOS = 5;

export const onProductReviewWritten = onDocumentWritten(
  { document: 'products/{productId}/reviews/{reviewerId}', region, maxInstances: 3 },
  async (event) => {
    const { productId, reviewerId } = event.params;
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    const before = beforeSnap?.exists ? beforeSnap.data() ?? {} : null;
    const after = afterSnap?.exists ? afterSnap.data() ?? {} : null;

    // Fotos que deixaram de fazer parte da avaliação (ou dela inteira).
    const removedPhotos = photoPaths(before).filter(path => !photoPaths(after).includes(path));
    if (removedPhotos.length) await deletePhotos(removedPhotos);

    if (!after || !afterSnap) {
      await recomputeProductRating(productId);
      return;
    }

    const fixes: Record<string, unknown> = {};

    const cleanPhotos = sanitizePhotos(after['photos'], reviewerId, productId);
    if (Array.isArray(after['photos']) && cleanPhotos.length !== after['photos'].length) {
      fixes['photos'] = cleanPhotos;
    }

    if (after['verifiedPurchase'] !== true || !after['sellerId']) {
      const product = (await getFirestore().doc(`products/${productId}`).get()).data();
      const verified = product
        ? await isVerifiedPurchase(productId, reviewerId, String(after['orderId'] || ''))
        : false;

      if (!verified) {
        logger.warn('Avaliação sem compra correspondente removida', { productId, reviewerId });
        await afterSnap.ref.delete();
        return; // A exclusão dispara esta função de novo, que recalcula a nota.
      }

      fixes['verifiedPurchase'] = true;
      fixes['sellerId'] = String(product?.['sellerId'] || '');
      fixes['productName'] = String(product?.['name'] || 'Produto').slice(0, 200);
      fixes['productPhoto'] = firstPhoto(product?.['photoURL']);
    }

    // Só grava se mudou: a própria escrita dispara a função outra vez, e é
    // nessa segunda volta (já verificada) que a nota é recalculada.
    if (Object.keys(fixes).length) {
      await afterSnap.ref.update(fixes);
      return;
    }

    const wasCounted = before?.['verifiedPurchase'] === true;
    if (!wasCounted || aggregateChanged(before, after)) {
      await recomputeProductRating(productId);
    }

    const replyBefore = String(before?.['sellerReply']?.text || '');
    const replyAfter = String(after['sellerReply']?.text || '');
    if (replyAfter && !replyBefore) {
      await notifyUser(reviewerId, `review-reply-${productId}-${reviewerId}`, {
        kind: 'review', icon: 'chat',
        title: 'A loja respondeu sua avaliação',
        body: `${after['productName'] || 'Produto'}: “${replyAfter}”`,
        link: '/my-reviews?aba=feitas',
        image: typeof after['productPhoto'] === 'string' ? after['productPhoto'] : null,
      }).catch(error => logger.warn('Aviso de resposta não enviado', { productId, reviewerId, error: String(error) }));
    }
  }
);

/**
 * Votos de "útil": `products/{productId}/reviewVotes/{voterId}` guarda a lista
 * de avaliações (uid do autor) que a pessoa marcou. A diferença entre antes e
 * depois vira +1/−1 em `helpfulCount` de cada avaliação. Voto na própria
 * avaliação não conta.
 */
export const onReviewVotesWritten = onDocumentWritten(
  { document: 'products/{productId}/reviewVotes/{voterId}', region, maxInstances: 2 },
  async (event) => {
    const { productId, voterId } = event.params;
    const before = idsOf(event.data?.before?.exists ? event.data.before.get('reviewIds') : null);
    const after = idsOf(event.data?.after?.exists ? event.data.after.get('reviewIds') : null);

    const changes: [string, number][] = [
      ...after.filter(id => !before.includes(id)).map(id => [id, 1] as [string, number]),
      ...before.filter(id => !after.includes(id)).map(id => [id, -1] as [string, number]),
    ].filter(([id]) => id !== voterId);

    const db = getFirestore();
    await Promise.all(changes.map(async ([reviewerId, delta]) => {
      try {
        await db.doc(`products/${productId}/reviews/${reviewerId}`).update({ helpfulCount: FieldValue.increment(delta) });
      } catch {
        // Avaliação apagada: não há contagem a mexer.
      }
    }));
  }
);

// ------------------------------------------------------------------ apoio

async function isVerifiedPurchase(productId: string, reviewerId: string, orderId: string): Promise<boolean> {
  if (!orderId) return false;

  const orderSnap = await getFirestore().doc(`orders/${orderId}`).get();
  const order = orderSnap.data();
  if (!order || order['userId'] !== reviewerId) return false;
  if (!PAID_STATUSES.includes(order['status'])) return false;

  const items: any[] = Array.isArray(order['items']) ? order['items'] : [];
  return items.some(item => (item?.productId ?? item?.productData?.id) === productId);
}

/** Só caminhos da pasta da própria pessoa para este produto, no máximo cinco. */
function sanitizePhotos(value: unknown, reviewerId: string, productId: string): string[] {
  if (!Array.isArray(value)) return [];
  const prefix = `review-photos/${reviewerId}/${productId}/`;
  return value
    .filter((path): path is string => typeof path === 'string' && path.startsWith(prefix) && !path.includes('..'))
    .slice(0, MAX_PHOTOS);
}

function photoPaths(review: FirebaseFirestore.DocumentData | null): string[] {
  const photos = review?.['photos'];
  return Array.isArray(photos)
    ? photos.filter((p): p is string => typeof p === 'string' && p.startsWith('review-photos/'))
    : [];
}

async function deletePhotos(paths: string[]): Promise<void> {
  const bucket = getStorage().bucket();
  await Promise.all(paths.map(path =>
    bucket.file(path).delete({ ignoreNotFound: true }).catch(error =>
      logger.warn('Foto de avaliação não apagada', { path, error: String(error) }))
  ));
}

function aggregateChanged(before: FirebaseFirestore.DocumentData | null, after: FirebaseFirestore.DocumentData): boolean {
  if (!before) return true;
  return before['rating'] !== after['rating']
    || (before['matchesListing'] ?? null) !== (after['matchesListing'] ?? null)
    || photoPaths(before).length > 0 !== photoPaths(after).length > 0;
}

function firstPhoto(value: unknown): string | null {
  const photo = Array.isArray(value) ? value[0] : value;
  return typeof photo === 'string' && photo.startsWith('http') ? photo : null;
}

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
}

async function recomputeProductRating(productId: string): Promise<void> {
  const db = getFirestore();
  const productRef = db.doc(`products/${productId}`);

  const snapshot = await productRef.collection('reviews').select('rating', 'photos', 'matchesListing').get();
  const breakdown: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const listingMatch: Record<string, number> = { yes: 0, partly: 0, no: 0 };
  let total = 0;
  let withPhotos = 0;

  snapshot.forEach(docSnap => {
    const rating = Math.min(5, Math.max(1, Math.round(Number(docSnap.get('rating')) || 0)));
    breakdown[String(rating)]++;
    total += rating;
    if (photoPaths(docSnap.data()).length) withPhotos++;
    const match = docSnap.get('matchesListing');
    if (typeof match === 'string' && match in listingMatch) listingMatch[match]++;
  });

  const count = snapshot.size;

  try {
    await productRef.update({
      reviewCount: count,
      ratingBreakdown: breakdown,
      reviewPhotoCount: withPhotos,
      listingMatch,
      rating: count ? Math.round((total / count) * 10) / 10 : FieldValue.delete()
    });
  } catch (error) {
    // Produto apagado: não há nota a guardar.
    logger.debug('Não foi possível atualizar a nota do produto', { productId, error });
  }
}
