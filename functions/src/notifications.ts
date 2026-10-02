import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import * as webpush from 'web-push';

import { defaultRuntime, handleCors, methodNotAllowed, region, requireAuthenticated } from './shared/http';

/**
 * Central de avisos da Vineon.
 * ----------------------------------------------------------------------------
 * Cada aviso vira um documento em `users/{uid}/notifications/{id}` (a tela
 * "Notificações" lê dali em tempo real) e, se a pessoa ativou o push no app
 * instalado (PWA), também uma notificação no celular via Web Push.
 *
 * - Só estas funções escrevem avisos (as regras não deixam o cliente criar).
 * - O ID é determinístico por evento (`order-<id>-paid`, `chat-<id>`...): a
 *   função pode rodar duas vezes para o mesmo evento e o aviso não duplica.
 * - `expireAt` = +90 dias. Com a política de TTL do Firestore ligada para
 *   `notifications.expireAt`, os antigos somem sozinhos (ver docs/notificacoes.md).
 * - Push sem VAPID configurado: o aviso continua no app, só não vai push.
 *
 * Inscrições de push: `users/{uid}/pushSubscriptions/{hash do endpoint}`,
 * gravadas pelo próprio app. Endpoint que o serviço de push dá como morto
 * (404/410) é apagado aqui.
 */

export type NotificationKind = 'order' | 'sale' | 'message' | 'review' | 'system';

/** Categorias que a pessoa pode silenciar no push (o aviso no app continua). */
type PrefKey = 'orders' | 'sales' | 'messages' | 'reviews';

const PREF_OF: Record<NotificationKind, PrefKey | null> = {
  order: 'orders',
  sale: 'sales',
  message: 'messages',
  review: 'reviews',
  system: null,
};

export interface NotificationInput {
  kind: NotificationKind;
  /** Ícone da lista: wallet, box, truck, check, bag, chat, star, returns, bell. */
  icon: string;
  title: string;
  body: string;
  /** Rota interna do app, ex. `/my-orders?aba=shipping`. */
  link: string;
  image?: string | null;
  /** Para o push: notificações com a mesma tag se substituem no celular. */
  tag?: string;
}

const TTL_DAYS = 90;
const MAX_BODY = 180;

let vapidReady: boolean | null = null;

function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const publicKey = process.env.VAPID_PUBLIC_KEY || '';
  const privateKey = process.env.VAPID_PRIVATE_KEY || '';
  const subject = process.env.VAPID_SUBJECT || 'https://www.vineonsite.com.br';
  if (!publicKey || !privateKey) {
    logger.warn('VAPID não configurado: avisos ficam só no app, sem push.');
    vapidReady = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidReady = true;
  return true;
}

function clip(text: string, max = MAX_BODY): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}

/**
 * Grava o aviso e manda o push.
 *
 * @param id ID do documento. Com `upsert: false` (padrão), um ID que já existe
 *   significa "esse evento já foi avisado" e nada acontece. Com `upsert: true`
 *   o aviso é reescrito e volta a ficar não lido (usado na conversa, que tem
 *   um aviso só, sempre com a última mensagem).
 */
export async function notifyUser(
  uid: string,
  id: string,
  input: NotificationInput,
  options: { upsert?: boolean } = {}
): Promise<void> {
  if (!uid) return;
  const db = getFirestore();
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  // Conversa de WhatsApp e afins têm participante que não é conta da Vineon.
  if (!userSnap.exists) return;

  const now = Timestamp.now();
  const doc = {
    kind: input.kind,
    icon: input.icon,
    title: clip(input.title, 80),
    body: clip(input.body),
    link: input.link,
    image: input.image || null,
    read: false,
    readAt: null,
    createdAt: now,
    expireAt: Timestamp.fromMillis(now.toMillis() + TTL_DAYS * 24 * 60 * 60 * 1000),
  };

  const ref = userRef.collection('notifications').doc(id);
  if (options.upsert) {
    await ref.set(doc);
  } else {
    try {
      await ref.create(doc);
    } catch (error: any) {
      // 6 = ALREADY_EXISTS: evento repetido (retentativa da função).
      if (error?.code === 6) return;
      throw error;
    }
  }

  const prefKey = PREF_OF[input.kind];
  const prefs = (userSnap.get('notificationPrefs') || {}) as Partial<Record<PrefKey, boolean>>;
  if (prefKey && prefs[prefKey] === false) return;

  await sendPush(uid, { ...doc, id, tag: input.tag || id });
}

async function sendPush(
  uid: string,
  payload: { id: string; title: string; body: string; link: string; image: string | null; tag: string; kind: string }
): Promise<void> {
  if (!ensureVapid()) return;
  const db = getFirestore();
  const subs = await db.collection(`users/${uid}/pushSubscriptions`).get();
  if (subs.empty) return;

  const unread = await db
    .collection(`users/${uid}/notifications`)
    .where('read', '==', false)
    .count()
    .get()
    .then(snap => snap.data().count)
    .catch(() => 0);

  const message = JSON.stringify({
    id: payload.id,
    title: payload.title,
    body: payload.body,
    url: payload.link,
    image: payload.image,
    tag: payload.tag,
    kind: payload.kind,
    badge: unread,
  });

  await Promise.all(subs.docs.map(async sub => {
    const data = sub.data();
    try {
      await webpush.sendNotification(
        { endpoint: data['endpoint'], keys: data['keys'] },
        message,
        // 1 dia na fila do serviço de push se o celular estiver desligado.
        { TTL: 24 * 60 * 60, urgency: 'high', topic: topicOf(payload.tag) }
      );
    } catch (error: any) {
      const status = error?.statusCode;
      if (status === 404 || status === 410) {
        await sub.ref.delete().catch(() => undefined);
        logger.info('Inscrição de push expirada removida', { uid, sub: sub.id });
      } else {
        logger.warn('Falha ao enviar push', { uid, sub: sub.id, status, body: error?.body });
      }
    }
  }));
}

/**
 * `Topic` do Web Push: mensagem nova com o mesmo tópico substitui a que ainda
 * está na fila (celular offline). Só aceita [A-Za-z0-9_-], até 32 caracteres.
 */
function topicOf(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'vineon';
}

// ------------------------------------------------------------------- pedidos

/**
 * Mesma derivação de `src/app/core/order-stage.ts` (`orderStage`). Mudou lá,
 * mude aqui: é ela que decide quando o comprador é avisado.
 */
type Stage = 'pay' | 'preparing' | 'shipping' | 'done' | 'refund' | 'cancelled';
const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'];

function stageOf(order: any): Stage | null {
  if (!order) return null;
  if (order.refundInfo?.status || order.status === 'REFUNDED') return 'refund';
  if (order.status === 'CANCELLED') return 'cancelled';
  if (order.status === 'PENDING') return 'pay';
  if (order.status === 'DELIVERED' || order.shipmentStatus === 'DELIVERED') return 'done';
  if (order.shipmentStatus === 'SHIPPED' || order.shipmentStatus === 'PROBLEM') return 'shipping';
  if (PAID_STATUSES.includes(order.status)) return 'preparing';
  return 'pay';
}

function brl(value: number): string {
  return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function itemsOf(order: any): any[] {
  return Array.isArray(order?.items) ? order.items : [];
}

/** "Fone XYZ" ou "Fone XYZ e mais 2 itens". */
function describeItems(items: any[]): string {
  if (!items.length) return 'seu pedido';
  const first = String(items[0]?.productData?.name || 'Produto');
  const rest = items.length - 1;
  return rest > 0 ? `${first} e mais ${rest} ${rest === 1 ? 'item' : 'itens'}` : first;
}

function photoOf(items: any[]): string | null {
  const data = items[0]?.productData;
  const photo = Array.isArray(data?.photoURL) ? data.photoURL[0] : data?.photoURL;
  return typeof photo === 'string' && photo.startsWith('http') ? photo : null;
}

/** Itens da loja no pedido. Pedido antigo sem `sellerId` no item: tudo dela. */
function sellerItemsOf(order: any, sellerId: string): any[] {
  const items = itemsOf(order);
  const mine = items.filter(item => item?.productData?.sellerId === sellerId);
  if (!mine.length && (order.sellerIds || []).length === 1) return items;
  return mine;
}

function sellerAmountOf(items: any[]): number {
  return items.reduce((sum, item) => {
    const { price, priceDiscounted } = item?.productData || {};
    const unit = priceDiscounted ? Math.min(Number(price) || 0, Number(priceDiscounted) || 0) : Number(price) || 0;
    return sum + unit * (Number(item?.quantity) || 0);
  }, 0);
}

const REFUND_TEXT: Record<string, { title: string; body: string }> = {
  APPROVED: { title: 'Devolução aprovada', body: 'Sua devolução de {items} foi aprovada. Siga as instruções no pedido.' },
  REJECTED: { title: 'Devolução recusada', body: 'O pedido de devolução de {items} não foi aprovado. Veja o motivo no pedido.' },
  COMPLETED: { title: 'Estorno concluído', body: 'O valor de {items} foi estornado.' },
};

export const onOrderWrittenNotify = onDocumentWritten(
  { document: 'orders/{orderId}', region, maxInstances: 2 },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    // Só mudança de pedido que já existia: o checkout cria todo pedido como
    // PENDING, e pedido que nasce pago/entregue (importação, seed) não é
    // novidade para ninguém.
    if (!before || !after) return;

    const orderId = event.params.orderId;
    const buyerId = String(after['userId'] || '');
    const items = itemsOf(after);
    const what = describeItems(items);
    const photo = photoOf(items);
    const from = stageOf(before);
    const to = stageOf(after);
    const jobs: Promise<void>[] = [];

    if (to !== from) {
      if (to === 'preparing' && (from === 'pay' || from === 'cancelled')) {
        jobs.push(notifyUser(buyerId, `order-${orderId}-paid`, {
          kind: 'order', icon: 'wallet',
          title: 'Pagamento aprovado',
          body: `Recebemos o pagamento de ${what}. A loja já está preparando o envio.`,
          link: '/my-orders?aba=preparing', image: photo, tag: `order-${orderId}`,
        }));

        for (const sellerId of (after['sellerIds'] || []) as string[]) {
          const mine = sellerItemsOf(after, sellerId);
          jobs.push(notifyUser(sellerId, `sale-${orderId}`, {
            kind: 'sale', icon: 'bag',
            title: `Nova venda: ${brl(sellerAmountOf(mine))}`,
            body: `Você vendeu ${describeItems(mine)}. Embale e envie em até 2 dias úteis.`,
            link: `/sale-details/${orderId}`, image: photoOf(mine), tag: `sale-${orderId}`,
          }));
        }
      }

      if (to === 'shipping') {
        const code = String(after['trackingCode'] || after['shippingInfo']?.trackingCode || '');
        jobs.push(notifyUser(buyerId, `order-${orderId}-shipped`, {
          kind: 'order', icon: 'truck',
          title: 'Seu pedido está a caminho',
          body: code ? `${what} foi enviado. Código de rastreio: ${code}.` : `${what} foi enviado pela loja.`,
          link: '/my-orders?aba=shipping', image: photo, tag: `order-${orderId}`,
        }));
      }

      if (to === 'done') {
        jobs.push(notifyUser(buyerId, `order-${orderId}-delivered`, {
          kind: 'order', icon: 'check',
          title: 'Pedido entregue',
          body: `${what} foi entregue. Conta pra gente o que achou: sua avaliação ajuda outros compradores.`,
          link: '/my-orders?aba=done', image: photo, tag: `order-${orderId}`,
        }));
      }

      if (to === 'cancelled') {
        jobs.push(notifyUser(buyerId, `order-${orderId}-cancelled`, {
          kind: 'order', icon: 'close',
          title: 'Pedido cancelado',
          body: from === 'pay'
            ? `O pagamento de ${what} não foi identificado a tempo e o pedido foi cancelado.`
            : `O pedido de ${what} foi cancelado.`,
          link: '/my-orders?aba=cancelled', image: photo, tag: `order-${orderId}`,
        }));
      }
    }

    // Devolução: anda pelo `refundInfo.status`, não pela etapa.
    const refundBefore = String(before['refundInfo']?.status || '');
    const refundAfter = String(after['refundInfo']?.status || '');
    if (refundAfter && refundAfter !== refundBefore) {
      if (refundAfter === 'REQUESTED') {
        for (const sellerId of (after['sellerIds'] || []) as string[]) {
          jobs.push(notifyUser(sellerId, `sale-${orderId}-refund`, {
            kind: 'sale', icon: 'returns',
            title: 'Pedido de devolução',
            body: `O comprador pediu a devolução de ${describeItems(sellerItemsOf(after, sellerId))}. A Vineon vai analisar.`,
            link: `/sale-details/${orderId}`, image: photo, tag: `sale-${orderId}`,
          }));
        }
      }
      const text = REFUND_TEXT[refundAfter];
      if (text) {
        jobs.push(notifyUser(buyerId, `order-${orderId}-refund-${refundAfter.toLowerCase()}`, {
          kind: 'order', icon: 'returns',
          title: text.title,
          body: text.body.replace('{items}', what),
          link: '/my-orders?aba=refund', image: photo, tag: `order-${orderId}`,
        }));
      }
    }

    const results = await Promise.allSettled(jobs);
    results.forEach(result => {
      if (result.status === 'rejected') logger.error('Aviso de pedido falhou', { orderId, error: String(result.reason) });
    });
  }
);

// ---------------------------------------------------------------- mensagens

/**
 * Mensagem nova numa conversa. A lista guarda UM aviso por conversa
 * (`chat-<id>`), sempre com a última mensagem; no celular a tag faz o mesmo.
 */
export const onChatMessageNotify = onDocumentCreated(
  { document: 'chats/{chatId}/messages/{messageId}', region, maxInstances: 2 },
  async (event) => {
    const message = event.data?.data();
    if (!message) return;
    const chatId = event.params.chatId;
    const senderId = String(message['senderId'] || '');

    const chatSnap = await getFirestore().doc(`chats/${chatId}`).get();
    const chat = chatSnap.data();
    if (!chat) return;

    const participants: any[] = Array.isArray(chat['participants']) ? chat['participants'] : [];
    const ids: string[] = Array.isArray(chat['participantIds'])
      ? chat['participantIds']
      : [chat['buyerId'], chat['sellerId']].filter(Boolean);

    const sender = participants.find(p => p?.uid === senderId);
    const senderName = String(sender?.name || 'Nova mensagem').split(' ')[0];
    const type = String(message['type'] || 'text');
    const text = type === 'image' ? 'Enviou uma foto' : type === 'audio' ? 'Enviou um áudio' : String(message['text'] || '');
    const about = chat['productName'] ? ` · ${chat['productName']}` : '';

    await Promise.allSettled(ids
      .filter(uid => uid && uid !== senderId)
      .map(uid => notifyUser(uid, `chat-${chatId}`, {
        kind: 'message', icon: 'chat',
        title: `${senderName}${about}`,
        body: text,
        link: `/chat-details/${chatId}`,
        image: typeof chat['productPhoto'] === 'string' ? chat['productPhoto'] : null,
        tag: `chat-${chatId}`,
      }, { upsert: true })));
  }
);

// --------------------------------------------------------------- avaliações

export const onProductReviewNotify = onDocumentCreated(
  { document: 'products/{productId}/reviews/{reviewerId}', region, maxInstances: 2 },
  async (event) => {
    const review = event.data?.data();
    if (!review) return;
    const { productId, reviewerId } = event.params;

    const product = (await getFirestore().doc(`products/${productId}`).get()).data();
    const sellerId = String(product?.['sellerId'] || '');
    if (!sellerId || sellerId === reviewerId) return;

    const rating = Math.min(5, Math.max(1, Math.round(Number(review['rating']) || 0)));
    const photo = Array.isArray(product?.['photoURL']) ? product?.['photoURL'][0] : product?.['photoURL'];
    const comment = clip(String(review['comment'] || review['text'] || ''), 120);

    await notifyUser(sellerId, `review-${productId}-${reviewerId}`, {
      kind: 'review', icon: 'star',
      title: `Nova avaliação: ${rating} de 5 estrelas`,
      body: comment ? `${product?.['name'] || 'Seu produto'}: “${comment}”` : `${product?.['name'] || 'Seu produto'} recebeu uma avaliação.`,
      link: `/product-details/${productId}`,
      image: typeof photo === 'string' ? photo : null,
    });
  }
);

// ------------------------------------------------------------------ teste

/**
 * "Enviar notificação de teste" da tela Notificações. Só manda para a própria
 * conta, no máximo uma vez a cada 20 segundos.
 */
export const sendTestNotification = onRequest({ ...defaultRuntime, maxInstances: 1 }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = await requireAuthenticated(req, res);
  if (!auth) return;

  const db = getFirestore();
  const userRef = db.doc(`users/${auth.uid}`);
  const last = (await userRef.get()).get('lastTestNotificationAt') as Timestamp | undefined;
  if (last && Date.now() - last.toMillis() < 20_000) {
    res.status(429).json({ error: 'Aguarde alguns segundos para testar de novo.' });
    return;
  }
  await userRef.set({ lastTestNotificationAt: FieldValue.serverTimestamp() }, { merge: true });

  const subs = await db.collection(`users/${auth.uid}/pushSubscriptions`).count().get();
  await notifyUser(auth.uid, `test-${Date.now()}`, {
    kind: 'system', icon: 'bell',
    title: 'Notificações ativadas',
    body: 'Tudo certo! É assim que os avisos de pedidos, vendas e mensagens vão chegar.',
    link: '/tabs/notifications',
    tag: 'vineon-test',
  });

  res.status(200).json({ ok: true, devices: subs.data().count, push: ensureVapid() });
});
