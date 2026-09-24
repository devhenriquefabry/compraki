import { CartItem } from './cart-item';

export type OrderStatus = 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'DELIVERED' | 'IN_ESCROW' | 'CANCELLED' | 'REFUNDED';

export type ShipmentStatus = 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'PROBLEM';

export type EscrowStatus ='HOLDING' | 'RELEASED' | 'REFUNDED';

export type RefundRequestStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'COMPLETED';

export interface EscrowInfo {
  /** Data em que o escrow será liberado automaticamente (createdAt + 7 dias) */
  releaseDate: any;
  /** Status atual do escrow */
  status: EscrowStatus;
  /** Data em que o escrow foi efetivamente liberado */
  releasedAt?: any;
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
    reason: 'VALUE_MISMATCH' | 'OWNER_MISMATCH';
    expectedValue?: number;
    paidValue?: number;
    detectedAt: any;
  };


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
    serviceId: number;
    serviceName: string;
    price: number;
    /** Pedido saiu com frete grátis (vendedor ou regra da loja); `price` é 0. */
    freeShipping?: boolean;
    /** Valor da cotação do Melhor Envio — o custo real da etiqueta. */
    quotedPrice?: number;
    deliveryTime: number;
    shipmentId?: string;
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

  // Sistema de Escrow — retenção de 7 dias
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
