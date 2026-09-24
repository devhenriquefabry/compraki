import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { timingSafeEqual } from 'node:crypto';

import { applyCoraInvoiceToOrder, coraRuntime } from './cora';

/**
 * Recebe as notificações do Cora.
 *
 * O Cora manda tudo em cabeçalho e o corpo vem vazio:
 *   webhook-event-type:  invoice.paid | invoice.canceled | ...
 *   webhook-resource-id: id da fatura (inv_...)
 *   webhook-event-id:    id do evento
 *
 * Não há assinatura. Por isso:
 *  1. a URL cadastrada leva `?token=CORA_WEBHOOK_TOKEN`, que filtra ruído;
 *  2. o conteúdo da notificação nunca é usado como verdade — o status é relido
 *     na API do Cora (com mTLS) por `applyCoraInvoiceToOrder`. Um POST forjado
 *     no máximo faz o servidor conferir uma fatura que não mudou.
 *
 * Cadastro dos endpoints: `node scripts/cora.mjs webhooks`.
 */

function tokenMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export const coraWebhook = onRequest(coraRuntime, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expectedToken = (process.env.CORA_WEBHOOK_TOKEN || '').trim();
  if (!expectedToken) {
    logger.error('CORA_WEBHOOK_TOKEN não configurado — webhook recusado');
    res.status(503).json({ error: 'Webhook not configured' });
    return;
  }

  if (!tokenMatches(expectedToken, String(req.query['token'] || '').trim())) {
    logger.warn('Webhook do Cora com token inválido', { ip: req.ip });
    res.status(401).json({ error: 'Invalid webhook token' });
    return;
  }

  const eventType = req.header('webhook-event-type') || '';
  const invoiceId = (req.header('webhook-resource-id') || '').trim();
  const eventId = req.header('webhook-event-id') || '';

  logger.info('Webhook do Cora recebido', { eventType, invoiceId, eventId });

  if (!eventType.startsWith('invoice.') || !invoiceId) {
    // Evento que não mexe em pedido. 200 para o Cora não reenviar.
    res.status(200).json({ success: true, ignored: eventType });
    return;
  }

  try {
    const result = await applyCoraInvoiceToOrder(invoiceId, 'webhook');

    // Aviso de pago com a fatura ainda liquidando (no stage ela fica OPEN com
    // `total_paid` preenchido por alguns segundos): devolver erro faz o Cora
    // reenviar, e no reenvio ela já estará PAID.
    if (eventType === 'invoice.paid' && result.invoiceStatus !== 'PAID' && result.invoiceStatus !== 'CANCELLED') {
      res.status(503).json({ success: false, retry: true });
      return;
    }

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    // 500 faz o Cora reenviar — que é o comportamento certo para falha nossa.
    logger.error('Falha ao processar webhook do Cora', { eventType, invoiceId, error });
    res.status(500).json({ success: false });
  }
});
