import type { OrderStage } from '../core/order-stage';

/**
 * Atendimento "Fale com a Vineon": `supportTickets/{id}`, com `replies/` (a
 * conversa) e `notes/` (notas internas, só a equipe lê).
 *
 * O cliente só LÊ estes documentos; quem grava são as Cloud Functions
 * `createSupportTicket` e `replySupportTicket` (functions/src/support.ts).
 */

/**
 * `waiting_staff`: na fila da Vineon. `waiting_customer`: a bola está com a
 * pessoa. `resolved`: respondido, a pessoa pode reabrir por 7 dias.
 * `closed`: encerrado, não recebe mais mensagem.
 */
export type SupportStatus = 'waiting_staff' | 'waiting_customer' | 'resolved' | 'closed';

export type SupportPriority = 'normal' | 'high';

/** Lado em que a pessoa entrou no atendimento. */
export type SupportRole = 'buyer' | 'seller';

export interface SupportAttachment {
  /** Caminho no Storage: `support/{uid}/{ticketId}/{arquivo}`. */
  path: string;
  name: string;
  contentType: string;
  size: number;
}

/** Foto do pedido no momento do contato (gravada pelo servidor). */
export interface SupportOrderSnapshot {
  shortId: string;
  stage: OrderStage | null;
  items: string;
  photo: string | null;
  /** Comprador: total do pedido. Vendedor: só a parte da loja. */
  total: number;
  asRole: SupportRole;
}

export interface SupportCsat {
  score: number;
  comment: string;
  at: Date | null;
}

export interface SupportTicket {
  id: string;
  /** `VN-2026-000123`. */
  protocol: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  userRole: SupportRole;
  topic: string;
  topicLabel: string;
  subject: string;
  orderId: string | null;
  orderSnapshot: SupportOrderSnapshot | null;
  /** Pergunta da Central de onde a pessoa veio (mede o que a Central não resolveu). */
  fromHelpArticle: string | null;
  relatedTicketId: string | null;
  status: SupportStatus;
  priority: SupportPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  channel: 'app';
  createdAt: Date | null;
  updatedAt: Date | null;
  lastReplyAt: Date | null;
  lastReplyBy: 'user' | 'staff';
  replyCount: number;
  /** Meta interna de 1ª resposta (horas úteis), não a promessa mostrada ao cliente. */
  firstResponseDueAt: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  /** A equipe respondeu e a pessoa ainda não abriu. */
  userUnread: boolean;
  /** A pessoa escreveu e a equipe ainda não abriu. */
  staffUnread: boolean;
  csat: SupportCsat | null;
}

export type SupportReplyEvent = 'resolved' | 'reopened' | 'closed';

export interface SupportReply {
  id: string;
  senderId: string;
  senderRole: 'user' | 'staff' | 'system';
  senderName: string;
  text: string;
  attachments: SupportAttachment[];
  createdAt: Date | null;
  /** Só nas linhas de sistema ("marcado como resolvido"). */
  event: SupportReplyEvent | null;
  eventBy: 'user' | 'staff' | null;
}

export interface SupportNote {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: Date | null;
}
