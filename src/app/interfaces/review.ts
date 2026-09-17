/**
 * Avaliação de produto — documento `products/{productId}/reviews/{userId}`.
 *
 * O id do documento é o uid de quem avaliou: uma avaliação por pessoa por
 * produto, e editar é só regravar o mesmo documento.
 *
 * `verifiedPurchase` é escrito apenas pela Cloud Function `onProductReviewWritten`,
 * depois de conferir que o pedido citado é da pessoa, está pago e contém o produto.
 */
export interface ProductReview {
  id?: string;
  userId: string;
  /** Primeiro nome e inicial do sobrenome — nunca o nome completo. */
  userName: string;
  rating: number;
  comment: string;
  orderId: string;
  verifiedPurchase?: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface ReviewSummary {
  average: number;
  count: number;
  /** Índice 0 = 5 estrelas ... índice 4 = 1 estrela. */
  bars: { stars: number; count: number; percent: number }[];
}
