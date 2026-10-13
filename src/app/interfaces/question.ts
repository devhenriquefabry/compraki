/**
 * Pergunta ao vendedor — documento `productQuestions/{id}`.
 *
 * Só as Cloud Functions escrevem (`askProductQuestion`, `answerProductQuestion`,
 * `deleteProductQuestion`); o app lê em tempo real e, de direto, só marca a
 * resposta como vista (`askerUnread`). Pergunta respondida é pública (aparece
 * no anúncio); a que espera resposta só o autor e a loja veem.
 */
export type QuestionStatus = 'open' | 'answered';

export interface QuestionAnswer {
  text: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ProductQuestion {
  id: string;
  productId: string;
  /** Copiados do anúncio no momento da pergunta, para as listas não dependerem dele. */
  productName: string;
  productPhoto: string | null;
  /** Loja dona do anúncio: quem responde. */
  sellerId: string;
  userId: string;
  /** Primeiro nome e inicial do sobrenome — a pergunta é pública depois de respondida. */
  userName: string;
  text: string;
  status: QuestionStatus;
  answer: QuestionAnswer | null;
  /** A resposta chegou e quem perguntou ainda não abriu "Minhas perguntas". */
  askerUnread: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
  answeredAt: Date | null;
  /** Tempo entre a pergunta e a primeira resposta, em milissegundos. */
  responseMs: number | null;
}
