import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { DocumentReference, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';

import { defaultRuntime, handleCors, isBootstrapAdminEmail, methodNotAllowed } from './shared/http';

/**
 * Excluir conta (LGPD, art. 18, VI) — tela "Excluir conta" em Minha conta.
 *
 * `{ dryRun: true }` só confere: devolve o que impede a exclusão e o que vai
 * ser apagado. Sem `dryRun`, apaga de verdade.
 *
 * Regras:
 *  - Conta de administrador NÃO se exclui por aqui (pedido do dono: um admin
 *    apagando a própria conta poderia levar junto o acesso à gestão de todos).
 *  - Só com login recente (até 10 min): quem pede é a própria pessoa.
 *  - Nada some com pedido andando: compra paga não entregue ou no prazo de
 *    desistência, devolução aberta, Pix/boleto que ainda pode ser pago, venda
 *    com repasse pendente. Primeiro termina, depois exclui.
 *
 * O que acontece:
 *  - apaga: login (Auth), `users/{uid}` e subcoleções, `sellers/{uid}`,
 *    anúncios (com as avaliações deles), avaliações que a pessoa fez,
 *    favoritos de outros que apontavam para os anúncios dela, vínculos de
 *    seguir/seguidores, foto de perfil e banner da loja, presença,
 *    código de recuperação de senha;
 *  - anonimiza: nome e foto nas conversas ("Conta excluída") e nas denúncias
 *    que ela fez — as mensagens ficam, porque também são da outra pessoa;
 *  - guarda: pedidos, notas fiscais e notas mensais da Vineon, pelo prazo
 *    das leis fiscais e do CDC (5 anos), como diz a Política de Privacidade.
 *
 * Fica um registro em `accountDeletions/{uid}` (só contagens, sem dado
 * pessoal) para provar que o pedido foi atendido. O Auth é o último passo:
 * se algo falhar antes, a pessoa ainda consegue entrar e tentar de novo.
 */

const RECENT_LOGIN_SECONDS = 10 * 60;
const RETURN_WINDOW_DAYS = 7;
const PAYMENT_WINDOW_DAYS = 3;
const PAID = ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'];
const DELETED_NAME = 'Conta excluída';

interface Blocker {
  kind: 'purchase' | 'sale';
  orderId: string;
  reason: string;
}

interface Summary {
  products: number;
  addresses: number;
  savedProducts: number;
  chats: number;
  tickets: number;
  reviews: number;
  ordersKept: number;
  salesKept: number;
}

type OrderData = FirebaseFirestore.DocumentData;

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

/** Mesma regra do app (core/order-stage.ts): vale a data mais tardia de entrega. */
function receivedAt(order: OrderData): Date | null {
  const dates = [toDate(order['deliveredAt']), toDate(order['deliveryConfirmedAt'])].filter((d): d is Date => !!d);
  if (dates.length) return new Date(Math.max(...dates.map(d => d.getTime())));
  if (order['status'] === 'DELIVERED' || order['shipmentStatus'] === 'DELIVERED') return toDate(order['updatedAt']);
  return null;
}

function returnDeadline(order: OrderData): Date | null {
  const received = receivedAt(order);
  if (!received) return null;
  const end = new Date(received);
  end.setDate(end.getDate() + RETURN_WINDOW_DAYS);
  end.setHours(23, 59, 59, 999);
  return end;
}

const refundOpen = (order: OrderData) => ['REQUESTED', 'APPROVED'].includes(order['refundInfo']?.['status']);

/** Pix/boleto vence em 3 dias: antes disso a cobrança ainda pode ser paga. */
function stillPayable(order: OrderData, now: Date): boolean {
  if (order['status'] !== 'PENDING') return false;
  const created = toDate(order['createdAt']);
  if (!created) return true;
  return now.getTime() - created.getTime() < (PAYMENT_WINDOW_DAYS + 1) * 86_400_000;
}

function purchaseBlocker(order: OrderData, now: Date): string | null {
  if (refundOpen(order)) return 'Devolução em andamento';
  if (stillPayable(order, now)) return 'Pagamento ainda em aberto';
  if (!PAID.includes(order['status'])) return null;
  const deadline = returnDeadline(order);
  if (!deadline) return 'Pedido ainda não entregue';
  if (deadline.getTime() > now.getTime()) return 'Ainda no prazo de 7 dias para desistir';
  return null;
}

function saleBlocker(order: OrderData, now: Date): string | null {
  if (refundOpen(order)) return 'Devolução em andamento';
  if (stillPayable(order, now)) return 'Pagamento do comprador ainda em aberto';
  if (!PAID.includes(order['status'])) return null;
  const escrow = order['escrowInfo']?.['status'];
  if (escrow === 'HOLDING' || (!escrow && !receivedAt(order))) return 'Venda com repasse pendente';
  return null;
}

/** Apaga em lotes de até 400 escritas. */
async function deleteRefs(refs: DocumentReference[]): Promise<void> {
  const db = getFirestore();
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

/** Caminho no bucket a partir da URL de download do Firebase Storage. */
function storagePathFromUrl(url: string): string | null {
  const match = /\/o\/([^?]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

export const deleteMyAccount = onRequest({ ...defaultRuntime, maxInstances: 2, timeoutSeconds: 300 }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const match = (req.header('authorization') || '').match(/^Bearer (.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Entre na sua conta para continuar.' });
    return;
  }

  const auth = getAuth();
  const db = getFirestore();
  let decoded: Awaited<ReturnType<typeof auth.verifyIdToken>>;
  try {
    decoded = await auth.verifyIdToken(match[1], true);
  } catch {
    res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
    return;
  }
  const uid = decoded.uid;
  const dryRun = (req.body || {}).dryRun === true;

  // 1. Admin nunca. Confere claim, e-mail de bootstrap e os campos antigos do cadastro.
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const profile = userSnap.data() ?? {};
  if (decoded['admin'] === true || isBootstrapAdminEmail(decoded.email) || profile['isAdmin'] === true || profile['super_admin'] === true) {
    res.status(403).json({ error: 'Contas de administrador não podem ser excluídas pelo app.', code: 'admin' });
    return;
  }

  // 2. O que impede e o que vai ser apagado.
  const now = new Date();
  const [purchases, sales, products, addresses, saved, chats, tickets] = await Promise.all([
    db.collection('orders').where('userId', '==', uid).get(),
    db.collection('orders').where('sellerIds', 'array-contains', uid).get(),
    db.collection('products').where('sellerId', '==', uid).get(),
    userRef.collection('addresses').get(),
    userRef.collection('savedProducts').get(),
    db.collection('chats').where('participantIds', 'array-contains', uid).get(),
    db.collection('supportTickets').where('userId', '==', uid).get(),
  ]);

  const blockers: Blocker[] = [];
  for (const doc of purchases.docs) {
    const reason = purchaseBlocker(doc.data(), now);
    if (reason) blockers.push({ kind: 'purchase', orderId: doc.id, reason });
  }
  for (const doc of sales.docs) {
    const reason = saleBlocker(doc.data(), now);
    if (reason) blockers.push({ kind: 'sale', orderId: doc.id, reason });
  }

  // Avaliações feitas pela pessoa: o id do documento é o uid dela, e só se
  // avalia o que se comprou — então basta olhar os produtos das compras.
  const reviewedProductIds = new Set<string>();
  for (const doc of purchases.docs) {
    for (const item of (doc.get('items') as any[]) || []) {
      const productId = item?.productId ?? item?.productData?.id;
      if (productId) reviewedProductIds.add(String(productId));
    }
  }
  const reviewRefs = (await Promise.all(
    [...reviewedProductIds].map(async productId => {
      const ref = db.doc(`products/${productId}/reviews/${uid}`);
      return (await ref.get()).exists ? ref : null;
    }),
  )).filter((ref): ref is DocumentReference => !!ref);

  const summary: Summary = {
    products: products.size,
    addresses: addresses.size,
    savedProducts: saved.size,
    chats: chats.size,
    tickets: tickets.size,
    reviews: reviewRefs.length,
    ordersKept: purchases.size,
    salesKept: sales.size,
  };

  if (dryRun || blockers.length) {
    res.status(blockers.length && !dryRun ? 409 : 200).json({ ok: !blockers.length, blockers, summary });
    return;
  }

  // 3. Só com login recente.
  if (now.getTime() / 1000 - decoded.auth_time > RECENT_LOGIN_SECONDS) {
    res.status(401).json({ error: 'Por segurança, confirme sua identidade de novo.', code: 'requires-recent-login' });
    return;
  }

  try {
    // Anúncios: apaga o produto (e as avaliações dele) e os favoritos de outras
    // pessoas que apontavam para ele. Fotos de anúncio que já vendeu ficam:
    // o pedido do comprador mostra essa foto e o pedido é guardado por lei.
    const storagePaths = new Set<string>();
    for (const product of products.docs) {
      const savedByOthers = await db.collectionGroup('savedProducts').where('productId', '==', product.id).get();
      await deleteRefs(savedByOthers.docs.map(d => d.ref));
      if (!(Number(product.get('soldCount')) > 0)) {
        JSON.stringify(product.data(), (_key, value) => {
          if (typeof value === 'string' && value.includes('/o/products%2F')) {
            const path = storagePathFromUrl(value);
            if (path) storagePaths.add(path);
          }
          return value;
        });
      }
      await db.recursiveDelete(product.ref);
    }

    await deleteRefs(reviewRefs);

    // Seguir e seguidores: os dois lados do vínculo.
    const [followers, following] = await Promise.all([
      userRef.collection('followers').get(),
      userRef.collection('followingSellers').get(),
    ]);
    await deleteRefs([
      ...followers.docs.map(d => db.doc(`users/${d.id}/followingSellers/${uid}`)),
      ...following.docs.map(d => db.doc(`users/${d.id}/followers/${uid}`)),
    ]);

    // Conversas: tira nome e foto; as mensagens continuam com a outra pessoa.
    for (const chat of chats.docs) {
      const participants = ((chat.get('participants') as any[]) || []).map(p =>
        p?.uid === uid ? { uid, name: DELETED_NAME } : p,
      );
      await chat.ref.update({ participants, status: 'closed', closedAt: FieldValue.serverTimestamp() });
    }

    // Atendimentos (Fale com a Vineon): o texto fica guardado (é o registro de uma reclamação),
    // mas sem o nome, o e-mail e os anexos (fotos e PDFs que a pessoa mandou).
    for (const ticket of tickets.docs) {
      await ticket.ref.update({ userName: DELETED_NAME, userEmail: null });
      const replies = await ticket.ref.collection('replies').get();
      await Promise.all(replies.docs.map(reply => reply.ref.update({
        attachments: [],
        ...(reply.get('senderRole') === 'user' ? { senderName: DELETED_NAME } : {}),
      })));
    }

    // Denúncias feitas pela pessoa: o registro fica para a moderação, sem o nome.
    const [contentReports, chatReports] = await Promise.all([
      db.collection('contentReports').where('reporterId', '==', uid).get(),
      db.collection('reports').where('senderId', '==', uid).get(),
    ]);
    await Promise.all([
      ...contentReports.docs.map(d => d.ref.update({ reporterName: DELETED_NAME })),
      ...chatReports.docs.map(d => d.ref.update({ senderName: DELETED_NAME })),
    ]);

    // Cadastro, perfil público e tudo o que fica dentro de users/{uid}.
    await db.recursiveDelete(userRef);
    await db.doc(`sellers/${uid}`).delete();
    if (decoded.email) await db.doc(`passwordResets/${decoded.email.trim().toLowerCase()}`).delete().catch(() => undefined);

    // Arquivos: foto de perfil, banner da loja e fotos de anúncio sem venda.
    const bucket = getStorage().bucket();
    await Promise.all([
      bucket.deleteFiles({ prefix: `profile-photos/${uid}/` }),
      bucket.deleteFiles({ prefix: `showcase-banners/${uid}/` }),
      bucket.deleteFiles({ prefix: `support/${uid}/` }),
      bucket.deleteFiles({ prefix: `review-photos/${uid}/` }),
      ...[...storagePaths].map(path => bucket.file(path).delete({ ignoreNotFound: true })),
    ]).catch(error => logger.warn('Exclusão de conta: arquivo não apagado', { uid, error }));

    // Presença (Realtime Database).
    await getDatabase().ref(`status/${uid}`).remove().catch(error => logger.warn('Exclusão de conta: presença', { uid, error }));

    await db.doc(`accountDeletions/${uid}`).set({
      deletedAt: FieldValue.serverTimestamp(),
      ...summary,
      productImagesDeleted: storagePaths.size,
    });

    // Por último o login: se algo acima falhou, a pessoa ainda entra e tenta de novo.
    await auth.deleteUser(uid);
    // De novo, por garantia: um gatilho atrasado de `users/` pode ter recriado o espelho.
    await db.doc(`sellers/${uid}`).delete().catch(() => undefined);

    logger.info('Conta excluída a pedido do titular', { uid, ...summary });
    res.status(200).json({ ok: true, summary });
  } catch (error) {
    logger.error('Falha ao excluir conta', { uid, error });
    res.status(500).json({ error: 'Não foi possível concluir a exclusão. Tente de novo em alguns minutos.' });
  }
});
