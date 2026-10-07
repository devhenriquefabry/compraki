/**
 * Avaliação de produto — documento `products/{productId}/reviews/{userId}`.
 *
 * O id do documento é o uid de quem avaliou: uma avaliação por pessoa por
 * produto, e editar é só regravar os campos do autor no mesmo documento.
 *
 * Campos do servidor (o cliente não grava): `verifiedPurchase`, `sellerId`,
 * `productName`, `productPhoto` (Cloud Function `onProductReviewWritten`,
 * depois de conferir que o pedido é da pessoa, foi entregue e contém o
 * produto), `helpfulCount` (`onReviewVotesWritten`) e `sellerReply` (só a loja
 * dona do produto).
 */
export type ListingMatch = 'yes' | 'partly' | 'no';

export interface SellerReply {
  text: string;
  createdAt: any;
  updatedAt: any;
}

export interface ProductReview {
  id?: string;
  /** Produto avaliado. Não é gravado: vem do caminho do documento na leitura. */
  productId?: string;
  userId: string;
  /** Primeiro nome e inicial do sobrenome — nunca o nome completo. */
  userName: string;
  rating: number;
  comment: string;
  orderId: string;
  /** Caminhos no Storage (`review-photos/{uid}/{productId}/...`). */
  photos?: string[];
  /** "O produto é como no anúncio?" — pergunta opcional. */
  matchesListing?: ListingMatch | null;
  verifiedPurchase?: boolean;
  sellerId?: string;
  productName?: string;
  productPhoto?: string | null;
  helpfulCount?: number;
  sellerReply?: SellerReply | null;
  createdAt: any;
  updatedAt: any;
}

export interface ReviewSummary {
  average: number;
  count: number;
  /** Índice 0 = 5 estrelas ... índice 4 = 1 estrela. */
  bars: { stars: number; count: number; percent: number }[];
  /** Quem respondeu "como no anúncio?": total e % de "sim". `null` sem respostas. */
  listing: { answered: number; yesPercent: number } | null;
  photoCount: number;
}

/** Produto entregue que a pessoa ainda pode avaliar (aba "Para avaliar"). */
export interface PendingReview {
  key: string;
  orderId: string;
  productId: string;
  name: string;
  photo: string | null;
  variant: string | null;
  sellerId: string | null;
  deliveredAt: Date | null;
}
