import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';

import { notifyUser } from './notifications';
import { defaultRuntime, handleCors, methodNotAllowed, region, requireAuthenticated } from './shared/http';

/**
 * "Perguntas aos vendedores": dúvidas públicas sobre um anúncio, respondidas
 * pela loja. Documento `productQuestions/{id}`.
 * ----------------------------------------------------------------------------
 * O app só LÊ essa coleção (e marca "resposta vista"). Perguntar, responder e
 * apagar passam pelas três funções abaixo, que:
 *  - confirmam quem é quem (a loja é a dona do anúncio; o autor é quem pergunta);
 *  - copiam do anúncio os campos que a lista da loja precisa (`sellerId`,
 *    `productName`, `productPhoto`) — o cliente nunca os grava;
 *  - barram contato por fora ("me chama no zap", e-mail, link) nas perguntas e
 *    nas respostas, como os marketplaces fazem, porque a venda por fora tira a
 *    proteção do comprador e o pagamento em custódia;
 *  - limitam abuso (poucas perguntas em aberto por produto, teto diário, pausa
 *    entre perguntas);
 *  - calculam o tempo de resposta (`responseMs`) e avisam a outra parte;
 *  - e, quando o anúncio é apagado, `onProductDeletedQuestions` apaga as
 *    perguntas dele (sem anúncio a pergunta não tem para onde apontar).
 *
 * Os limites e o detector de contato espelham `src/app/core/question-rules.ts`.
 * Mudou lá, mude aqui.
 */

export const QUESTION_LIMITS = {
  questionMin: 5,
  questionMax: 500,
  answerMin: 2,
  answerMax: 1000,
  openPerProduct: 3,
  perDay: 20,
  cooldownMs: 8_000,
} as const;

class QuestionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// -------------------------------------------------------------- texto

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Texto de usuário: quebras normalizadas, sem caracteres de controle, no limite. */
function cleanText(value: unknown, max: number): string {
  return str(value)
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const DOMAIN_LOWER = /\b[a-zA-Z0-9-]{2,}\.(?:com|com\.br|net|org|me|io|link|app|shop|store|site|xyz|ly|gg)\b/;
const DOMAIN_UPPER = /\b[A-Z0-9-]{2,}\.(?:COM|COM\.BR|NET|ORG|ME|IO|LINK|APP|SHOP|STORE|SITE|XYZ|LY|GG)\b/;

export type ContactKind= 'email' | 'link' | 'phone' | 'social' | 'offsite';

/**
 * Procura contato por fora da Vineon: e-mail, link, telefone, rede social ou
 * "vamos combinar por fora". Devolve o tipo achado ou `null`.
 *
 * Tem que errar para o lado de deixar passar: "iPhone 15 128 256", código de
 * peça e medidas são perguntas normais. Telefone só vale com DDD (10 ou 11
 * dígitos) e em formato de telefone.
 */
export function findContactInfo(text: string): ContactKind | null {
  const t = normalize(text);

  if (/[a-z0-9._%+-]+\s?(@|\(at\)|\[at\]| arroba )\s?[a-z0-9-]+(\.[a-z]{2,})/.test(t)) return 'email';
  if (/(https?:\/\/|www\.)\S+/.test(t)) return 'link';
  // Endereço sem http ("loja.com.br"). "Funciona.Com cabo?" — frase sem espaço depois do ponto — não é
  // site: o final precisa ser todo minúsculo ou todo maiúsculo.
  const raw = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (DOMAIN_LOWER.test(raw) || DOMAIN_UPPER.test(raw)) return 'link';
  if (/(^|\s)@[a-z0-9_.]{3,}/.test(t)) return 'social';
  if (/\b(whats\s?app|whatsapp|zap\s?zap|zapzap|wpp|zap|telegram|instagram|insta|facebook|tiktok|direct)\b/.test(t)) return 'social';

  // 10 ou 11 dígitos seguidos, ou (DDD) 9xxxx-xxxx / +55 ... com separadores comuns.
  if (/(^|\D)\d{10,11}(\D|$)/.test(t)) return 'phone';
  if (/(\+?55[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]\d{4}\b/.test(t)) return 'phone';

  if (/\b(por fora|fora do site|fora da plataforma|fora do vineon|fora do app|pix direto|pagamento direto|depositar na conta|me passa seu (numero|contato)|passa seu (numero|contato)|chama no privado|chama no pv)\b/.test(t)) return 'offsite';
  return null;
}

const CONTACT_MESSAGE: Record<ContactKind, string> = {
  email: 'Não é possível enviar e-mail por aqui. Use o Vineon para conversar e comprar com proteção.',
  link: 'Links e endereços de sites não são permitidos nas perguntas e respostas.',
  phone: 'Não é possível enviar telefone ou números de contato por aqui.',
  social: 'Não é possível divulgar WhatsApp, redes sociais ou perfis por aqui.',
  offsite: 'Compra e pagamento acontecem só pelo Vineon, com proteção ao comprador. Tire a combinação por fora do texto.',
};

/** Nome público: primeiro nome + inicial do sobrenome ("Henrique F."). */
export function publicName(displayName: string, email?: string | null): string {
  const source = displayName.trim() || email?.split('@')[0] || 'Cliente';
  const [first, ...rest] = source.split(/\s+/);
  const initial = rest.length ? ` ${rest[rest.length - 1].charAt(0).toUpperCase()}.` : '';
  return `${first}${initial}`.slice(0, 60);
}

function firstPhoto(value: unknown): string | null {
  const photo = Array.isArray(value) ? value[0] : value;
  return typeof photo === 'string' && photo.startsWith('http') ? photo : null;
}

function fail(res: { status(code: number): { json(body: unknown): void } }, error: unknown, fallback: string): void {
  if (error instanceof QuestionError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error('[perguntas] falha inesperada', { message: (error as Error)?.message, stack: (error as Error)?.stack });
  res.status(500).json({ error: fallback });
}

async function assertNotSuspended(uid: string): Promise<void> {
  const snap = await getFirestore().doc(`accountSuspensions/${uid}`).get();
  if (snap.exists) throw new QuestionError(403, 'Sua conta está suspensa e não pode enviar perguntas ou respostas.');
}

// ----------------------------------------------------------- perguntar

/**
 * `{ productId, text }` → cria a pergunta e avisa a loja.
 * Quem é a loja do anúncio não pergunta no próprio anúncio.
 */
export const askProductQuestion = onRequest({ ...defaultRuntime, maxInstances: 2 }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const db = getFirestore();
    const uid = auth.uid;

    const productId = str(body['productId']);
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(productId)) throw new QuestionError(400, 'Anúncio inválido.');

    const text = cleanText(body['text'], QUESTION_LIMITS.questionMax + 50);
    if (text.length < QUESTION_LIMITS.questionMin) {
      throw new QuestionError(400, `Escreva sua dúvida com pelo menos ${QUESTION_LIMITS.questionMin} caracteres.`);
    }
    if (text.length > QUESTION_LIMITS.questionMax) {
      throw new QuestionError(400, `A pergunta pode ter até ${QUESTION_LIMITS.questionMax} caracteres.`);
    }
    const contact = findContactInfo(text);
    if (contact) throw new QuestionError(422, CONTACT_MESSAGE[contact]);

    await assertNotSuspended(uid);

    const product = (await db.doc(`products/${productId}`).get()).data();
    if (!product || product['moderation']?.['hidden'] === true) {
      throw new QuestionError(404, 'Este anúncio não está mais disponível.');
    }
    const sellerId = str(product['sellerId']);
    if (!sellerId) throw new QuestionError(404, 'Este anúncio não está mais disponível.');
    if (sellerId === uid) throw new QuestionError(403, 'Você é a loja deste anúncio. Responda as perguntas em Minha conta.');

    // Limites: poucas em aberto por produto, teto diário e uma pausa curta.
    const now = Timestamp.now();
    const recent = await db.collection('productQuestions')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const dayAgo = now.toMillis() - 24 * 60 * 60 * 1000;
    const inLastDay = recent.docs.filter(d => ((d.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0) > dayAgo);
    if (inLastDay.length >= QUESTION_LIMITS.perDay) {
      throw new QuestionError(429, 'Você já fez muitas perguntas hoje. Tente de novo amanhã.');
    }
    const lastAt = (recent.docs[0]?.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0;
    if (now.toMillis() - lastAt < QUESTION_LIMITS.cooldownMs) {
      throw new QuestionError(429, 'Aguarde alguns segundos antes de enviar outra pergunta.');
    }
    const openHere = recent.docs.filter(d => d.get('productId') === productId && d.get('status') === 'open');
    if (openHere.length >= QUESTION_LIMITS.openPerProduct) {
      throw new QuestionError(429, `Você já tem ${QUESTION_LIMITS.openPerProduct} perguntas aguardando resposta neste anúncio. Espere a loja responder.`);
    }
    const sameText = normalize(text);
    if (recent.docs.some(d => d.get('productId') === productId && normalize(str(d.get('text'))) === sameText)) {
      throw new QuestionError(409, 'Você já fez essa pergunta neste anúncio.');
    }

    const userSnap = await db.doc(`users/${uid}`).get();
    const userName = publicName(str(userSnap.get('displayName')), auth.email);

    const ref = db.collection('productQuestions').doc();
    const productName = clip(str(product['name']) || 'Produto', 200);
    const productPhoto = firstPhoto(product['photoURL']);
    await ref.set({
      productId,
      productName,
      productPhoto,
      sellerId,
      userId: uid,
      userName,
      text,
      status: 'open',
      answer: null,
      askerUnread: false,
      createdAt: now,
      updatedAt: now,
      answeredAt: null,
      responseMs: null,
    });

    await notifyUser(sellerId, `question-${ref.id}`, {
      kind: 'question', icon: 'question',
      title: 'Nova pergunta no seu anúncio',
      body: `${productName}: “${clip(text, 120)}”`,
      link: '/my-questions?aba=loja',
      image: productPhoto,
    }).catch(error => logger.warn('[perguntas] aviso à loja não enviado', { id: ref.id, error: String(error) }));

    res.status(200).json({ ok: true, id: ref.id });
  } catch (error) {
    fail(res, error, 'Não foi possível enviar a pergunta agora. Tente de novo em instantes.');
  }
});

// ----------------------------------------------------------- responder

/**
 * `{ questionId, text }` → a loja responde (ou edita a resposta). Só a loja
 * dona do anúncio. A primeira resposta fecha o tempo de resposta e avisa quem
 * perguntou; editar não avisa de novo.
 */
export const answerProductQuestion = onRequest({ ...defaultRuntime, maxInstances: 2 }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const db = getFirestore();
    const uid = auth.uid;

    const questionId = str(body['questionId']);
    if (!/^[A-Za-z0-9]{10,40}$/.test(questionId)) throw new QuestionError(400, 'Pergunta inválida.');

    const text = cleanText(body['text'], QUESTION_LIMITS.answerMax + 50);
    if (text.length < QUESTION_LIMITS.answerMin) throw new QuestionError(400, 'Escreva a resposta.');
    if (text.length > QUESTION_LIMITS.answerMax) {
      throw new QuestionError(400, `A resposta pode ter até ${QUESTION_LIMITS.answerMax} caracteres.`);
    }
    const contact = findContactInfo(text);
    if (contact) throw new QuestionError(422, CONTACT_MESSAGE[contact]);

    await assertNotSuspended(uid);

    const ref = db.doc(`productQuestions/${questionId}`);
    const now = Timestamp.now();

    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const q = snap.data();
      if (!q) throw new QuestionError(404, 'Essa pergunta não existe mais. Quem perguntou pode tê-la apagado.');
      if (q['sellerId'] !== uid) throw new QuestionError(403, 'Só a loja deste anúncio pode responder.');

      const first = !q['answer'];
      const createdAt = q['createdAt'] as Timestamp;
      const answer = {
        text,
        createdAt: first ? now : (q['answer']?.['createdAt'] ?? now),
        updatedAt: now,
      };
      tx.update(ref, {
        answer,
        status: 'answered',
        updatedAt: now,
        ...(first
          ? { answeredAt: now, responseMs: Math.max(0, now.toMillis() - createdAt.toMillis()), askerUnread: true }
          : {}),
      });
      return { first, q };
    });

    if (result.first) {
      await notifyUser(str(result.q['userId']), `question-answer-${questionId}`, {
        kind: 'question', icon: 'chat',
        title: 'A loja respondeu sua pergunta',
        body: `${str(result.q['productName']) || 'Produto'}: “${clip(text, 120)}”`,
        link: '/my-questions?aba=minhas',
        image: typeof result.q['productPhoto'] === 'string' ? result.q['productPhoto'] : null,
      }).catch(error => logger.warn('[perguntas] aviso de resposta não enviado', { id: questionId, error: String(error) }));
    }

    res.status(200).json({ ok: true, first: result.first });
  } catch (error) {
    fail(res, error, 'Não foi possível publicar a resposta agora. Tente de novo em instantes.');
  }
});

// -------------------------------------------------------------- anúncio apagado

/** Apaga as perguntas (respondidas ou não) de um anúncio que deixou de existir. */
export const onProductDeletedQuestions = onDocumentDeleted(
  { document: 'products/{productId}', region, maxInstances: 2 },
  async (event) => {
    const db = getFirestore();
    // Gatilho atrasado + anúncio recriado com o mesmo id (reset do emulador, importação): não apaga nada.
    if ((await db.doc(`products/${event.params.productId}`).get()).exists) return;
    const questions = await db.collection('productQuestions').where('productId', '==', event.params.productId).get();
    for (let i = 0; i < questions.docs.length; i += 400) {
      const batch = db.batch();
      questions.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    if (!questions.empty) logger.info('[perguntas] anúncio apagado: perguntas removidas', { productId: event.params.productId, count: questions.size });
  }
);

// -------------------------------------------------------------- apagar

/**
 * `{ questionId, scope }`:
 *  - `question` — apaga a pergunta inteira. Quem perguntou ou a loja dona do anúncio.
 *  - `answer`   — a loja retira só a resposta; a pergunta volta para a fila.
 */
export const deleteProductQuestion = onRequest({ ...defaultRuntime, maxInstances: 2 }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const db = getFirestore();
    const uid = auth.uid;

    const questionId = str(body['questionId']);
    if (!/^[A-Za-z0-9]{10,40}$/.test(questionId)) throw new QuestionError(400, 'Pergunta inválida.');
    const scope = body['scope'] === 'answer' ? 'answer' : 'question';

    const ref = db.doc(`productQuestions/${questionId}`);
    const q = (await ref.get()).data();
    if (!q) {
      res.status(200).json({ ok: true, already: true });
      return;
    }

    const isAsker = q['userId'] === uid;
    const isSeller = q['sellerId'] === uid;

    if (scope === 'answer') {
      if (!isSeller) throw new QuestionError(403, 'Só a loja deste anúncio pode retirar a resposta.');
      if (!q['answer']) {
        res.status(200).json({ ok: true, already: true });
        return;
      }
      await ref.update({
        answer: null,
        status: 'open',
        answeredAt: null,
        responseMs: null,
        askerUnread: false,
        updatedAt: Timestamp.now(),
      });
    } else {
      if (!isAsker && !isSeller) throw new QuestionError(403, 'Você não pode apagar esta pergunta.');
      await ref.delete();
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    fail(res, error, 'Não foi possível concluir agora. Tente de novo em instantes.');
  }
});
