import { Injectable } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  DocumentData, Firestore, Query, collection, doc, getDoc, getFirestore, limit, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { getFirebaseAuth } from '../core/auth-state';
import { toDate } from '../core/order-stage';
import { QUESTION_LIMITS } from '../core/question-rules';
import { ProductQuestion } from '../interfaces/question';

export class QuestionError extends Error {}

/** Até onde a página do produto lista perguntas respondidas. */
const PUBLIC_PAGE_SIZE = 100;

/**
 * "Perguntas aos vendedores".
 *
 * Leitura é direta no Firestore (tempo real). Perguntar, responder e apagar
 * passam pelas Cloud Functions `askProductQuestion`, `answerProductQuestion` e
 * `deleteProductQuestion`: as regras do Firestore não deixam o app escrever em
 * `productQuestions` (a não ser marcar a resposta como vista).
 *
 * Todas as listas ordenam aqui, no app: as consultas só usam filtros de
 * igualdade, que dispensam índice composto.
 */
@Injectable({ providedIn: 'root' })
export class ProductQuestionsService {
  private readonly db: Firestore;
  private readonly baseUrl = environment.functionsBaseUrl;
  private readonly publicStreams = new Map<string, Observable<ProductQuestion[]>>();

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
  }

  // ----------------------------------------------------------------- leitura

  /** Perguntas respondidas de um anúncio (públicas): a resposta mais recente primeiro. */
  watchAnswered(productId: string): Observable<ProductQuestion[]> {
    const cached = this.publicStreams.get(productId);
    if (cached) return cached;

    const stream = new Observable<ProductQuestion[]>(subscriber => onSnapshot(
      query(
        collection(this.db, 'productQuestions'),
        where('productId', '==', productId),
        where('status', '==', 'answered'),
        limit(PUBLIC_PAGE_SIZE),
      ),
      snap => subscriber.next(sortByActivity(snap.docs.map(d => questionFrom(d.id, d.data())), 'answeredAt')),
      // Sem perguntas legíveis a página do produto segue funcionando.
      () => subscriber.next([]),
    )).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.publicStreams.set(productId, stream);
    return stream;
  }

  /** Perguntas que a própria pessoa fez neste anúncio (inclui as que esperam resposta). */
  watchMineOnProduct(uid: string, productId: string): Observable<ProductQuestion[]> {
    return this.watch(query(
      collection(this.db, 'productQuestions'),
      where('userId', '==', uid),
      where('productId', '==', productId),
    ));
  }

  /** Todas as perguntas que a pessoa fez, a mais recente primeiro. */
  watchMine(uid: string): Observable<ProductQuestion[]> {
    return this.watch(query(collection(this.db, 'productQuestions'), where('userId', '==', uid)));
  }

  /** Perguntas feitas nos anúncios da loja. */
  watchStore(sellerId: string): Observable<ProductQuestion[]> {
    return this.watch(query(collection(this.db, 'productQuestions'), where('sellerId', '==', sellerId)));
  }

  private watch(q: Query<DocumentData>): Observable<ProductQuestion[]> {
    return new Observable<ProductQuestion[]>(subscriber => onSnapshot(
      q,
      snap => subscriber.next(sortByActivity(snap.docs.map(d => questionFrom(d.id, d.data())), 'createdAt')),
      error => subscriber.error(error),
    ));
  }

  // ------------------------------------------------------------------ escrita

  async ask(productId: string, text: string): Promise<string> {
    const data = await this.call('askProductQuestion', { productId, text });
    return String(data['id'] ?? '');
  }

  async answer(questionId: string, text: string): Promise<{ first: boolean }> {
    const data = await this.call('answerProductQuestion', { questionId, text });
    return { first: data['first'] === true };
  }

  /** A loja retira só a resposta: a pergunta volta para a fila. */
  async retractAnswer(questionId: string): Promise<void> {
    await this.call('deleteProductQuestion', { questionId, scope: 'answer' });
  }

  /** Quem perguntou ou a loja apaga a pergunta inteira. */
  async remove(questionId: string): Promise<void> {
    await this.call('deleteProductQuestion', { questionId, scope: 'question' });
  }

  /** Quem perguntou viu a resposta: some a bolinha de "nova". */
  async markSeen(questionId: string): Promise<void> {
    try {
      await updateDoc(doc(this.db, 'productQuestions', questionId), { askerUnread: false });
    } catch {
      // Pergunta apagada nesse meio tempo: não há o que marcar.
    }
  }

  // --------------------------------------------------------- respostas rápidas

  async getQuickReplies(uid: string): Promise<string[]> {
    try {
      const snap = await getDoc(doc(this.db, 'sellerQuickReplies', uid));
      const items = snap.get('items');
      return Array.isArray(items) ? items.filter((t): t is string => typeof t === 'string') : [];
    } catch {
      return [];
    }
  }

  async saveQuickReplies(uid: string, items: string[]): Promise<void> {
    const clean = items
      .map(t => t.trim().slice(0, QUESTION_LIMITS.quickReplyMax))
      .filter(Boolean)
      .slice(0, QUESTION_LIMITS.quickRepliesMax);
    await setDoc(doc(this.db, 'sellerQuickReplies', uid), { items: clean, updatedAt: serverTimestamp() });
  }

  // ------------------------------------------------------------------- função

  private async call(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new QuestionError('Sua sessão expirou. Entre de novo.');

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new QuestionError('Sem conexão com a Vineon. Confira a internet e tente de novo.');
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new QuestionError(typeof data['error'] === 'string' ? data['error'] : 'Não foi possível concluir agora. Tente de novo em instantes.');
    }
    return data;
  }
}

// --------------------------------------------------------------- conversões

function questionFrom(id: string, d: Record<string, any>): ProductQuestion {
  const answer = d['answer'];
  return {
    id,
    productId: String(d['productId'] ?? ''),
    productName: String(d['productName'] ?? 'Produto'),
    productPhoto: typeof d['productPhoto'] === 'string' ? d['productPhoto'] : null,
    sellerId: String(d['sellerId'] ?? ''),
    userId: String(d['userId'] ?? ''),
    userName: String(d['userName'] ?? 'Cliente'),
    text: String(d['text'] ?? ''),
    status: d['status'] === 'answered' ? 'answered' : 'open',
    answer: answer && typeof answer['text'] === 'string'
      ? { text: answer['text'], createdAt: toDate(answer['createdAt']), updatedAt: toDate(answer['updatedAt']) }
      : null,
    askerUnread: d['askerUnread'] === true,
    createdAt: toDate(d['createdAt']),
    updatedAt: toDate(d['updatedAt']),
    answeredAt: toDate(d['answeredAt']),
    responseMs: typeof d['responseMs'] === 'number' ? d['responseMs'] : null,
  };
}

/** Mais recente primeiro (pelo campo dado; sem data, vai para o topo — acabou de ser escrita). */
function sortByActivity(list: ProductQuestion[], field: 'createdAt' | 'answeredAt'): ProductQuestion[] {
  const time = (q: ProductQuestion) => q[field]?.getTime() ?? Date.now();
  return list.sort((a, b) => time(b) - time(a));
}
