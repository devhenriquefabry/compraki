import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { timingSafeEqual } from 'node:crypto';

import { defaultRuntime } from '../shared/http';

/**
 * Recebe as notificações de pagamento do Asaas.
 *
 * POR QUE ISSO EXISTE
 * Não havia confirmação de pagamento nenhuma no servidor. Quem marcava pedido
 * como pago era o botão "SIMULAR PAGAMENTO" da tela de PIX, no navegador do
 * próprio comprador — ou seja, produto de graça para quem apertasse. Com o
 * botão desligado em produção (Fase 0) e sem este webhook, pedido de PIX e de
 * boleto ficaria preso em PENDING para sempre.
 *
 * Confirmação de pagamento é decisão do servidor. O cliente não participa.
 */

/** Coleção de idempotência: um documento por evento já processado. */
const PROCESSED_EVENTS = 'asaasWebhookEvents';

/** Tolerância na comparação de valor, em reais. Cobre arredondamento. */
const VALUE_TOLERANCE = 0.01;

type OrderStatus =
  | 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'DELIVERED'
  | 'IN_ESCROW' | 'CANCELLED' | 'REFUNDED';

/**
 * Eventos que mexem no pedido. O que não está aqui é reconhecido com 200 e
 * ignorado — devolver erro só faria o Asaas reenviar para sempre.
 */
const EVENT_TO_STATUS: Record<string, OrderStatus> = {
  PAYMENT_RECEIVED: 'RECEIVED',
  PAYMENT_CONFIRMED: 'RECEIVED',
  PAYMENT_REFUNDED: 'REFUNDED',
  PAYMENT_DELETED: 'CANCELLED'
};

/**
 * De onde cada status pode vir.
 *
 * Sem isto, um `PAYMENT_CONFIRMED` reenviado depois da entrega derrubaria o
 * pedido de DELIVERED de volta para RECEIVED.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  RECEIVED: ['PENDING'],
  REFUNDED: ['RECEIVED', 'CONFIRMED', 'DELIVERED', 'IN_ESCROW'],
  CANCELLED: ['PENDING'],
  PENDING: [],
  CONFIRMED: [],
  DELIVERED: [],
  IN_ESCROW: []
};

interface AsaasWebhookPayment {
  id?: string;
  status?: string;
  value?: number;
  externalReference?: string;
}

interface AsaasWebhookBody {
  id?: string;
  event?: string;
  payment?: AsaasWebhookPayment;
}

/** Comparação em tempo constante — não vaza o prefixo correto pelo tempo. */
function tokenMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/** Chave de idempotência: o id do evento quando existe, senão um derivado. */
function eventKey(body: AsaasWebhookBody): string {
  if (body.id) return body.id.replace(/[^A-Za-z0-9_-]/g, '');

  return `${body.event}_${body.payment?.id}_${body.payment?.status}`
    .replace(/[^A-Za-z0-9_-]/g, '');
}

export const asaasWebhook = onRequest(defaultRuntime, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Este handler escreve em `orders`. Sem verificar a origem, qualquer POST
  // marcaria pedido como pago — que é exatamente o buraco que ele fecha.
  const expectedToken = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
  if (!expectedToken) {
    logger.error('ASAAS_WEBHOOK_TOKEN não configurado — webhook recusado');
    res.status(503).json({ error: 'Webhook not configured' });
    return;
  }

  // Cabeçalho que o Asaas envia com o token configurado no painel dele.
  const providedToken = (req.header('asaas-access-token') || '').trim();
  if (!tokenMatches(expectedToken, providedToken)) {
    logger.warn('Webhook do Asaas com token inválido', { ip: req.ip });
    res.status(401).json({ error: 'Invalid webhook token' });
    return;
  }

  const body = (req.body || {}) as AsaasWebhookBody;
  const event = body.event || '';
  const payment = body.payment || {};

  if (!payment.id) {
    logger.warn('Webhook do Asaas sem payment.id', { event });
    res.status(400).json({ error: 'Missing payment id' });
    return;
  }

  logger.info('Webhook do Asaas recebido', {
    event,
    paymentId: payment.id,
    paymentStatus: payment.status
  });

  const db = getFirestore();
  const eventRef = db.collection(PROCESSED_EVENTS).doc(eventKey(body));

  try {
    // O Asaas reenvia até receber 200. Sem trava, um reenvio de
    // PAYMENT_REFUNDED depois de um novo pagamento bagunçaria o pedido.
    const firstDelivery = await db.runTransaction(async tx => {
      const seen = await tx.get(eventRef);
      if (seen.exists) return false;

      tx.set(eventRef, {
        event,
        paymentId: payment.id,
        paymentStatus: payment.status ?? null,
        receivedAt: FieldValue.serverTimestamp()
      });
      return true;
    });

    if (!firstDelivery) {
      logger.info('Evento do Asaas já processado; ignorando', { event, paymentId: payment.id });
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    const targetStatus = EVENT_TO_STATUS[event];
    if (!targetStatus) {
      res.status(200).json({ ok: true, ignored: event });
      return;
    }

    const ordersSnap = await db.collection('orders')
      .where('asaasPaymentId', '==', payment.id)
      .limit(1)
      .get();

    if (ordersSnap.empty) {
      // Cobrança sem pedido correspondente. Não é erro de entrega — responder
      // 200 para o Asaas parar de reenviar, e registrar para investigação.
      logger.warn('Webhook do Asaas sem pedido correspondente', {
        event,
        paymentId: payment.id
      });
      res.status(200).json({ ok: true, orderFound: false });
      return;
    }

    const orderDoc = ordersSnap.docs[0];
    const order = orderDoc.data() as { status?: OrderStatus; total?: number };
    const currentStatus = order.status || 'PENDING';

    if (!ALLOWED_TRANSITIONS[targetStatus].includes(currentStatus)) {
      logger.info('Transição de status ignorada', {
        orderId: orderDoc.id,
        currentStatus,
        targetStatus,
        event
      });
      res.status(200).json({ ok: true, skipped: currentStatus });
      return;
    }

    // O valor cobrado ainda vem do navegador (`createAsaasPayment`), então
    // pagar R$ 0,01 num pedido de R$ 500 é possível. Aqui a conta é conferida:
    // divergiu, o pedido NÃO vira pago e fica sinalizado para o admin.
    // PENDÊNCIA (Fase 1): calcular o total no servidor, a partir de products/.
    if (targetStatus === 'RECEIVED') {
      const expectedValue = Number(order.total ?? 0);
      const paidValue = Number(payment.value ?? 0);

      if (!(expectedValue > 0) || Math.abs(paidValue - expectedValue) > VALUE_TOLERANCE) {
        logger.error('Valor pago diverge do total do pedido', {
          orderId: orderDoc.id,
          paymentId: payment.id,
          expectedValue,
          paidValue
        });

        await orderDoc.ref.update({
          paymentAlert: {
            reason: 'VALUE_MISMATCH',
            expectedValue,
            paidValue,
            detectedAt: FieldValue.serverTimestamp()
          },
          updatedAt: FieldValue.serverTimestamp()
        });

        res.status(200).json({ ok: true, mismatch: true });
        return;
      }
    }

    await orderDoc.ref.update({
      status: targetStatus,
      paymentConfirmedBy: 'asaas-webhook',
      paymentConfirmedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    logger.info('Pedido atualizado pelo webhook do Asaas', {
      orderId: orderDoc.id,
      from: currentStatus,
      to: targetStatus,
      event
    });

    res.status(200).json({ ok: true, orderId: orderDoc.id, status: targetStatus });
  } catch (error) {
    // 500 faz o Asaas reenviar — que é o comportamento certo para falha nossa.
    // A trava de idempotência já foi gravada, então o reenvio cairia como
    // duplicado; por isso ela é removida antes de devolver o erro.
    logger.error('Falha ao processar webhook do Asaas', { event, paymentId: payment.id, error });
    await eventRef.delete().catch(() => undefined);
    res.status(500).json({ error: 'Falha ao processar webhook.' });
  }
});
