/**
 * Nota fiscal que a Vineon emite para o vendedor, uma por mês —
 * documento `sellerInvoices/{sellerId}_{AAAA-MM}`.
 *
 * O admin anexa na aba Vendedores; o vendedor vê em "Notas fiscais" e recebe
 * por e-mail (Cloud Function `onSellerInvoiceWritten`, que dispara quando
 * `emailRequestedAt` muda). Só admin escreve; o vendedor só marca `seenAt`.
 */
export interface SellerInvoice {
  id?: string;
  sellerId: string;
  /** Mês de referência, `AAAA-MM`. */
  period: string;
  file: SellerInvoiceFile;
  /** Retrato do mês no momento do envio (o que o e-mail e o vendedor veem). */
  summary: SellerInvoiceSummary;
  uploadedAt: any;
  uploadedBy: string;
  /** Muda a cada pedido de envio por e-mail — é o gatilho da function. */
  emailRequestedAt: any;
  email?: SellerInvoiceEmail;
  /** Quando o vendedor abriu a nota no app. */
  seenAt?: any;
}

export interface SellerInvoiceFile {
  name: string;
  path: string;
  url: string;
  contentType: string;
  size: number;
}

export interface SellerInvoiceSummary {
  grossRevenue: number;
  platformFee: number;
  netAmount: number;
  orderCount: number;
  itemCount: number;
  commissionRate: number;
}

export type SellerInvoiceEmailStatus = 'sending' | 'sent' | 'failed' | 'no_email' | 'simulated';

export interface SellerInvoiceEmail {
  status: SellerInvoiceEmailStatus;
  /** Endereço usado, para o admin conferir. */
  to?: string | null;
  at?: any;
  error?: string | null;
}

export const INVOICE_EMAIL_LABEL: Record<SellerInvoiceEmailStatus, string> = {
  sending: 'Enviando e-mail…',
  sent: 'Enviada por e-mail',
  failed: 'E-mail falhou',
  no_email: 'Vendedor sem e-mail',
  simulated: 'E-mail simulado (emulador)',
};

export function invoiceId(sellerId: string, period: string): string {
  return `${sellerId}_${period}`;
}
