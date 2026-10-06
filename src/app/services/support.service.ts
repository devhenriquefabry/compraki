import { Injectable } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore, addDoc, collection, doc, getFirestore, limit, onSnapshot, orderBy, query, serverTimestamp,
  updateDoc, where,
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { getFirebaseAuth } from '../core/auth-state';
import { toDate } from '../core/order-stage';
import { SUPPORT } from '../core/support-config';
import {
  SupportAttachment, SupportNote, SupportPriority, SupportReply, SupportRole, SupportStatus, SupportTicket,
} from '../interfaces/support';

export interface NewTicketInput {
  /** Id gerado por `newTicketId()`: os anexos já foram para a pasta dele. */
  ticketId: string;
  topic: string;
  role: SupportRole;
  subject: string;
  message: string;
  orderId?: string | null;
  fromHelpArticle?: string | null;
  relatedTicketId?: string | null;
  attachments?: SupportAttachment[];
}

export interface ReplyInput {
  message?: string;
  attachments?: SupportAttachment[];
  /** Cliente: só `resolved`. Equipe: também `waiting_customer`, `waiting_staff` e `closed`. */
  status?: SupportStatus;
}

export class SupportError extends Error {}

/**
 * "Fale com a Vineon": atendimentos por protocolo.
 *
 * Leitura é direta no Firestore (tempo real). Abrir atendimento e responder
 * passam pelas Cloud Functions `createSupportTicket` e `replySupportTicket`
 * — as regras do Firestore não deixam o cliente criar nada em `supportTickets`.
 * Direto só: marcar como lido, avaliar, e (equipe) atribuir, prioridade e notas.
 */
@Injectable({ providedIn: 'root' })
export class SupportService {
  private readonly db: Firestore;
  private readonly baseUrl = environment.functionsBaseUrl;
  private readonly urls = new Map<string, Promise<string>>();

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
  }

  // ----------------------------------------------------------------- leitura

  /** Atendimentos da pessoa, o último movimento primeiro. */
  watchMyTickets(uid: string, max = 50): Observable<SupportTicket[]> {
    return new Observable<SupportTicket[]>(subscriber => {
      const q = query(
        collection(this.db, 'supportTickets'),
        where('userId', '==', uid),
        orderBy('updatedAt', 'desc'),
        limit(max),
      );
      const unsub = onSnapshot(
        q,
        snap => subscriber.next(snap.docs.map(d => ticketFrom(d.id, d.data()))),
        err => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  watchTicket(id: string): Observable<SupportTicket | null> {
    return new Observable<SupportTicket | null>(subscriber => {
      const unsub = onSnapshot(
        doc(this.db, 'supportTickets', id),
        snap => subscriber.next(snap.exists() ? ticketFrom(snap.id, snap.data()) : null),
        err => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  watchReplies(id: string, max = 200): Observable<SupportReply[]> {
    return new Observable<SupportReply[]>(subscriber => {
      const q = query(collection(this.db, 'supportTickets', id, 'replies'), orderBy('createdAt', 'asc'), limit(max));
      const unsub = onSnapshot(
        q,
        snap => subscriber.next(snap.docs.map(d => replyFrom(d.id, d.data()))),
        err => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  // ------------------------------------------------------------------- abrir

  /** Id do próximo atendimento: os anexos sobem para a pasta dele antes de ele existir. */
  newTicketId(): string {
    return doc(collection(this.db, 'supportTickets')).id;
  }

  /**
   * Sobe um anexo para `support/{dono}/{ticketId}/`. Confere tipo e tamanho antes.
   * A equipe passa o `ownerUid` (a pasta é sempre a da pessoa dona do atendimento).
   */
  async uploadAttachment(ticketId: string, file: File, ownerUid?: string): Promise<SupportAttachment> {
    const uid = ownerUid ?? getFirebaseAuth().currentUser?.uid;
    if (!uid) throw new SupportError('Sua sessão expirou. Entre de novo.');
    if (!SUPPORT.fileTypes.includes(file.type)) throw new SupportError('Só dá para anexar fotos (JPG, PNG, WebP) e PDF.');
    if (file.size > SUPPORT.maxFileBytes) throw new SupportError('Cada anexo pode ter até 5 MB.');

    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-60) || 'anexo';
    const path = `support/${uid}/${ticketId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safe}`;
    try {
      await uploadBytes(ref(getStorage(), path), file, { contentType: file.type });
    } catch {
      throw new SupportError('Não foi possível enviar o anexo. Confira a internet e tente de novo.');
    }
    return { path, name: file.name.slice(0, 120), contentType: file.type, size: file.size };
  }

  async createTicket(input: NewTicketInput): Promise<{ id: string; protocol: string }> {
    const result = await this.call('createSupportTicket', {
      ...input,
      orderId: input.orderId || undefined,
      fromHelpArticle: input.fromHelpArticle || undefined,
      relatedTicketId: input.relatedTicketId || undefined,
      attachments: input.attachments ?? [],
    });
    return { id: String(result['id']), protocol: String(result['protocol']) };
  }

  // ---------------------------------------------------------------- responder

  async reply(ticketId: string, input: ReplyInput): Promise<SupportStatus> {
    const result = await this.call('replySupportTicket', {
      ticketId,
      message: input.message ?? '',
      attachments: input.attachments ?? [],
      status: input.status,
    });
    return result['status'] as SupportStatus;
  }

  // ------------------------------------------------------------- escrita direta

  /** A pessoa abriu a conversa: tira a marca de "resposta nova". */
  markReadByUser(ticketId: string): Promise<void> {
    return updateDoc(doc(this.db, 'supportTickets', ticketId), { userUnread: false });
  }

  rate(ticketId: string, score: number, comment: string): Promise<void> {
    return updateDoc(doc(this.db, 'supportTickets', ticketId), {
      csat: { score, comment: comment.trim().slice(0, 500), at: serverTimestamp() },
    });
  }

  /** URL de download de um anexo (cache por caminho). */
  attachmentUrl(path: string): Promise<string> {
    let url = this.urls.get(path);
    if (!url) {
      url = getDownloadURL(ref(getStorage(), path));
      this.urls.set(path, url);
      url.catch(() => this.urls.delete(path));
    }
    return url;
  }

  // -------------------------------------------------------------------- equipe

  /** Fila do painel: os últimos atendimentos, em tempo real. Só admin lê. */
  watchAllTickets(max = 300): Observable<SupportTicket[]> {
    return new Observable<SupportTicket[]>(subscriber => {
      const q = query(collection(this.db, 'supportTickets'), orderBy('updatedAt', 'desc'), limit(max));
      const unsub = onSnapshot(
        q,
        snap => subscriber.next(snap.docs.map(d => ticketFrom(d.id, d.data()))),
        err => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  markReadByStaff(ticketId: string): Promise<void> {
    return updateDoc(doc(this.db, 'supportTickets', ticketId), { staffUnread: false });
  }

  assign(ticketId: string, assignee: { id: string; name: string } | null): Promise<void> {
    return updateDoc(doc(this.db, 'supportTickets', ticketId), {
      assigneeId: assignee?.id ?? null,
      assigneeName: assignee?.name ?? null,
    });
  }

  setPriority(ticketId: string, priority: SupportPriority): Promise<void> {
    return updateDoc(doc(this.db, 'supportTickets', ticketId), { priority });
  }

  watchNotes(ticketId: string): Observable<SupportNote[]> {
    return new Observable<SupportNote[]>(subscriber => {
      const q = query(collection(this.db, 'supportTickets', ticketId, 'notes'), orderBy('createdAt', 'asc'), limit(100));
      const unsub = onSnapshot(
        q,
        snap => subscriber.next(snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            authorId: String(data['authorId'] ?? ''),
            authorName: String(data['authorName'] ?? ''),
            text: String(data['text'] ?? ''),
            createdAt: toDate(data['createdAt']),
          } satisfies SupportNote;
        })),
        err => subscriber.error(err),
      );
      return () => unsub();
    });
  }

  async addNote(ticketId: string, text: string): Promise<void> {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new SupportError('Sua sessão expirou. Entre de novo.');
    await addDoc(collection(this.db, 'supportTickets', ticketId, 'notes'), {
      authorId: user.uid,
      authorName: (user.displayName || user.email || 'Equipe').split(' ')[0].slice(0, 40),
      text: text.trim().slice(0, SUPPORT.noteMax),
      createdAt: serverTimestamp(),
    });
  }

  // ----------------------------------------------------------------- interno

  private async call(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new SupportError('Sua sessão expirou. Entre de novo.');

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new SupportError('Sem conexão com a Vineon. Confira a internet e tente de novo.');
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new SupportError(typeof data['error'] === 'string' ? data['error'] : 'Não foi possível concluir agora. Tente de novo em instantes.');
    }
    return data;
  }
}

// --------------------------------------------------------------- conversões

function ticketFrom(id: string, d: Record<string, any>): SupportTicket {
  const csat = d['csat'];
  return {
    id,
    protocol: String(d['protocol'] ?? ''),
    userId: String(d['userId'] ?? ''),
    userName: String(d['userName'] ?? ''),
    userEmail: typeof d['userEmail'] === 'string' ? d['userEmail'] : null,
    userRole: d['userRole'] === 'seller' ? 'seller' : 'buyer',
    topic: String(d['topic'] ?? 'outro'),
    topicLabel: String(d['topicLabel'] ?? ''),
    subject: String(d['subject'] ?? ''),
    orderId: typeof d['orderId'] === 'string' ? d['orderId'] : null,
    orderSnapshot: d['orderSnapshot'] ?? null,
    fromHelpArticle: typeof d['fromHelpArticle'] === 'string' ? d['fromHelpArticle'] : null,
    relatedTicketId: typeof d['relatedTicketId'] === 'string' ? d['relatedTicketId'] : null,
    status: d['status'] as SupportStatus,
    priority: d['priority'] === 'high' ? 'high' : 'normal',
    assigneeId: typeof d['assigneeId'] === 'string' ? d['assigneeId'] : null,
    assigneeName: typeof d['assigneeName'] === 'string' ? d['assigneeName'] : null,
    channel: 'app',
    createdAt: toDate(d['createdAt']),
    updatedAt: toDate(d['updatedAt']),
    lastReplyAt: toDate(d['lastReplyAt']),
    lastReplyBy: d['lastReplyBy'] === 'staff' ? 'staff' : 'user',
    replyCount: Number(d['replyCount']) || 0,
    firstResponseDueAt: toDate(d['firstResponseDueAt']),
    firstResponseAt: toDate(d['firstResponseAt']),
    resolvedAt: toDate(d['resolvedAt']),
    closedAt: toDate(d['closedAt']),
    userUnread: d['userUnread'] === true,
    staffUnread: d['staffUnread'] === true,
    csat: csat ? { score: Number(csat.score) || 0, comment: String(csat.comment ?? ''), at: toDate(csat.at) } : null,
  };
}

function replyFrom(id: string, d: Record<string, any>): SupportReply {
  return {
    id,
    senderId: String(d['senderId'] ?? ''),
    senderRole: d['senderRole'] === 'staff' ? 'staff' : d['senderRole'] === 'system' ? 'system' : 'user',
    senderName: String(d['senderName'] ?? ''),
    text: String(d['text'] ?? ''),
    attachments: Array.isArray(d['attachments']) ? d['attachments'] : [],
    createdAt: toDate(d['createdAt']),
    event: d['event'] === 'resolved' || d['event'] === 'reopened' || d['event'] === 'closed' ? d['event'] : null,
    eventBy: d['eventBy'] === 'user' || d['eventBy'] === 'staff' ? d['eventBy'] : null,
  };
}
