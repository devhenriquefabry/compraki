import { CartItem } from './cart-item';

export type OrderStatus = 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'DELIVERED' | 'IN_ESCROW' | 'CANCELLED' | 'REFUNDED';

export type ShipmentStatus = 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'PROBLEM';

export type EscrowStatus ='HOLDING' | 'RELEASED' | 'REFUNDED';

export type RefundRequestStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'COMPLETED';

export interface EscrowInfo {
  /**
   * Compra + 7 dias, gravado no checkout. Só ordena a lista do admin: a
   * liberação de verdade conta da entrega (`escrowReleaseDate` em
   * core/order-stage.ts), como manda o CDC.
   */
  releaseDate: any;
  /** Status atual do escrow */
  status: EscrowStatus;
  /** Data em que o escrow foi efetivamente liberado */
  releasedAt?: any;
  /** O que foi pago a cada loja na liberação (valor e chave Pix), por uid. */
  payouts?: Record<string, {
    gross: number; fee: number; net: number;
    pixKeyType: string | null; pixKey: string | null; holderName: string | null;
  }>;
}

export interface RefundInfo {
  /** Data da solicitação de devolução */
  requestedAt: any;
  /** UID do usuário que solicitou (comprador) */
  requestedBy: string;
  /** Motivo informado pelo comprador */
  reason: string;
  /** Status da solicitação */
  status: RefundRequestStatus;
  /** Notas do admin ao processar */
  adminNotes?: string;
  /** Data em que o admin processou */
  processedAt?: any;
  /** UID do admin que processou */
  processedBy?: string;
  /** ID do estorno na API Asaas */
  asaasRefundId?: string;
}

export interface Order {
  id?: string;
  userId: string;
  items: CartItem[];
  total: number;
  /**
   * Partes do total, calculadas no servidor (`placeOrder`): produtos, frete
   * cobrado e desconto de cupom. Pedido antigo (feito pelo navegador) não tem.
   */
  subtotal?: number;
  shippingCost?: number;
  discount?: number;
  /** `server` quando o total foi calculado pelo `placeOrder`. */
  pricedBy?: 'server';
  /** Estoque baixado na confirmação do pagamento (e devolvido se cancelar). */
  inventory?: { applied?: boolean; appliedAt?: any; restored?: boolean; restoredAt?: any };
  /** Cancelado sem pagamento: pelo comprador, pelo admin ou vencido (sistema). */
  cancelledAt?: any;
  cancelledBy?: 'buyer' | 'admin' | 'system';
  cancelReason?: 'BUYER_REQUEST' | 'PAYMENT_EXPIRED' | string;
  status: OrderStatus;
  paymentMethod: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
  /**
   * Quem cobra: `cora` (PIX e boleto) ou `asaas` (cartão). Pedido antigo, sem
   * o campo, é do Asaas.
   */
  paymentProvider?: 'asaas' | 'cora';
  asaasPaymentId?: string;
  /** Fatura do Cora (inv_...). É por ela que o webhook acha o pedido. */
  coraInvoiceId?: string;
  /** Dados para reabrir a cobrança do Cora sem nova chamada. */
  coraPayment?: {
    pixCode?: string | null;
    bankSlipUrl?: string | null;
    digitableLine?: string | null;
    sandbox?: boolean;
  };
  sellerIds: string[]; // Lista de IDs de todos os vendedores envolvidos no pedido
  createdAt: any;
  updatedAt?: any;

  // Escritos apenas pela Cloud Function `asaasWebhook`; o cliente nao alcanca.
  paymentConfirmedBy?: string;
  paymentConfirmedAt?: any;

  /**
   * Sinalizado quando o valor pago nao bate com o total do pedido. O pedido
   * NAO vira pago nesse caso — precisa de conferencia manual.
   */
  paymentAlert?: {
    reason: 'VALUE_MISMATCH' | 'OWNER_MISMATCH' | 'COUPON_INVALID';
    expectedValue?: number;
    paidValue?: number;
    detectedAt: any;
  };


  /**
   * Cupom usado, copiado da reserva feita por `couponQuote` (a regra do
   * Firestore confere campo a campo). `total` já vem com o desconto.
   */
  coupon?: OrderCoupon;
  /** Escrito só por `onOrderWrittenCoupon`: `invalid` impede a confirmação do pagamento. */
  couponCheck?: 'ok' | 'invalid';
  couponCheckReason?: string;

  // Dados de entrega/comprador salvos no momento da compra
  customerData: {
    name: string;
    cpf: string;
    phone: string;
    email: string;
  };
  addressData: {
    street: string;
    number: string;
    city: string;
    state: string;
    postalCode: string;
    complement?: string;
    neighborhood?: string;
  };

  // Informações de frete (Melhor Envio)
  shippingInfo?: {
    /** `null` na entrega da própria loja (sem Melhor Envio). */
    serviceId: number | null;
    serviceName: string;
    price: number;
    /** Pedido saiu com frete grátis (vendedor ou regra da loja); `price` é 0. */
    freeShipping?: boolean;
    /** Valor da cotação do Melhor Envio — o custo real da etiqueta. */
    quotedPrice?: number;
    deliveryTime: number;
    /**
     * A própria loja entrega (core/local-delivery.ts): grátis para o comprador,
     * sem etiqueta. `deliveryTime` é o prazo da loja (0 = no mesmo dia).
     */
    localDelivery?: boolean;
    /**
     * Parte da etiqueta que cada loja paga, por uid (servidor, `placeOrder`):
     * só quando o frete grátis foi escolha da loja ("Frete Grátis" no anúncio).
     * Sai do repasse, depois da taxa. Frete grátis da Vineon não entra aqui.
     */
    sellerShippingCost?: Record<string, number>;
    shipmentId?: string;
    /**
     * Em que passo parou a etiqueta (servidor): `cart` → `paid` → `generated`.
     * Sem o campo e com `shipmentId` = etiqueta do fluxo antigo, já gerada.
     */
    labelStatus?: 'cart' | 'paid' | 'generated';
    labelGeneratedAt?: any;
    trackingCode?: string;
    labelUrl?: string;
  };

  /**
   * Andamento da entrega, independente do pagamento. O vendedor muda na tela
   * de venda; o comprador só marca `DELIVERED` ao confirmar o recebimento.
   */
  shipmentStatus?: ShipmentStatus;
  /** Quando a loja marcou como enviada (`SalesService.markShipped`). */
  shippedAt?: any;
  /** Quando a loja marcou como entregue. */
  deliveredAt?: any;
  /** Quando a loja sinalizou problema na entrega. */
  shipmentProblemAt?: any;
  /** Quando o comprador confirmou que recebeu. */
  deliveryConfirmedAt?: any;

  /**
   * Nota fiscal ou declaração de conteúdo, uma por loja do pedido (chave =
   * uid do vendedor). Só vendedor do pedido escreve (firestore.rules); o
   * arquivo fica em Storage `orders/{orderId}/fiscal/{sellerId}/`.
   */
  fiscalDocuments?: Record<string, FiscalDocument>;

  // Retenção: até 7 dias depois da entrega (prazo de desistência do CDC)
  escrowInfo?: EscrowInfo;

  // Sistema de Devoluções
  refundInfo?: RefundInfo;
}

export type FiscalDocumentType = 'NFE' | 'CONTENT_DECLARATION';

export const FISCAL_DOCUMENT_LABEL: Record<FiscalDocumentType, string> = {
  NFE: 'Nota fiscal',
  CONTENT_DECLARATION: 'Declaração de conteúdo',
};

export interface FiscalDocument {
  type: FiscalDocumentType;
  url: string;
  /** Caminho no Storage, para trocar/remover o arquivo. */
  path: string;
  fileName: string;
  contentType: string;
  size: number;
  /** Número da NF-e ou chave de acesso, quando a loja informa. */
  number?: string | null;
  uploadedAt: any;
  uploadedBy: string;
}

export interface OrderCoupon {
  redemptionId: string;
  code: string;
  /** `platform`: a Vineon banca. `seller`: sai da venda da loja `sellerId`. */
  scope: 'platform' | 'seller';
  sellerId: string | null;
  type: 'percent' | 'fixed' | 'shipping';
  /** itemsDiscount + shippingDiscount. */
  discount: number;
  itemsDiscount: number;
  shippingDiscount: number;
}
