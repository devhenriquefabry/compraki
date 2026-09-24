import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';

import {
  AuthenticatedRequest,
  defaultRuntime,
  handleCors,
  HttpResponse,
  methodNotAllowed,
  requireAuthenticated
} from '../shared/http';
import { CoraInvoice, getCoraInvoice, isCoraSandbox, requestCora } from './cora-client';

/**
 * PIX e boleto pelo Cora — lado servidor.
 *
 * Cartão continua no Asaas (`./asaas.ts`). O Cora recebe PIX e boleto porque é
 * a conta PJ do lojista: o dinheiro cai direto lá.
 *
 * QUEM CONFIRMA PAGAMENTO
 * Só o servidor, e só depois de perguntar ao Cora. O webhook do Cora não é
 * assinado e chega de corpo vazio (só cabeçalhos com o id da fatura), então ele
 * é tratado como um "vá conferir" — nunca como prova. `applyCoraInvoiceToOrder`
 * relê a fatura na API e é a única coisa que muda o status do pedido, seja
 * chamada pelo webhook, seja pelo botão "já paguei" do comprador.
 */

/** Dono de cada fatura, gravado no momento da emissão. Só o Admin SDK escreve. */
export const CORA_CHARGES = 'coraCharges';

/** Tolerância na comparação de valor, em reais. Cobre arredondamento. */
const VALUE_TOLERANCE = 0.01;

/**
 * Teto de instâncias menor que o padrão: cada função é um serviço Cloud Run e
 * a cota de vCPU da região já está quase toda reservada pelas outras (ver
 * `apphosting.yaml`). PIX e boleto de uma loja não precisam de 10 containers.
 */
export const coraRuntime = { ...defaultRuntime, maxInstances: 3 } as const;

/** O Cora recusa cobrança abaixo de R$ 5,00 (`services[0].amount >= 500`). */
const CORA_MIN_CENTS = 500;

const CORA_NAME_MAX = 60;
const CORA_EMAIL_MAX = 60;

type OrderStatus =
  | 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'DELIVERED'
  | 'IN_ESCROW' | 'CANCELLED' | 'REFUNDED';

interface CreateChargePayload {
  billingType?: 'PIX' | 'BOLETO';
  value?: number;
  dueDate?: string;
  description?: string;
  customer?: { name?: string; cpfCnpj?: string; email?: string };
  address?: {
    street?: string;
    number?: string;
    district?: string;
    city?: string;
    state?: string;
    complement?: string;
    zipCode?: string;
  };
}

function respondError(res: HttpResponse, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;

  if (message.includes('CORA_CLIENT_ID')) {
    res.status(503).json({ error: 'Pagamentos por PIX e boleto indisponíveis no momento.' });
    return;
  }

  res.status(400).json({ error: message });
}

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

/** O que o app precisa para mostrar a cobrança. */
function presentInvoice(invoice: CoraInvoice) {
  const slip = invoice.payment_options?.bank_slip;

  return {
    id: invoice.id,
    status: invoice.status,
    pixCode: invoice.pix?.emv || null,
    bankSlipUrl: slip?.url || null,
    digitableLine: slip?.digitable || null,
    sandbox: isCoraSandbox()
  };
}

/** Confere se quem pergunta é dono da fatura (ou admin). */
async function assertChargeOwner(
  invoiceId: string,
  user: AuthenticatedRequest,
  res: HttpResponse
): Promise<boolean> {
  const charge = await getFirestore().collection(CORA_CHARGES).doc(invoiceId).get();

  if (!charge.exists || (charge.data()?.['uid'] !== user.uid && user.isTokenAdmin !== true)) {
    // 404 em vez de 403: não confirma a existência do id para quem não é dono.
    res.status(404).json({ error: 'Cobrança não encontrada.' });
    return false;
  }

  return true;
}

// ------------------------------------------------------ confirmação (núcleo)

export interface ApplyResult {
  invoiceStatus: string;
  orderId?: string;
  orderStatus?: OrderStatus;
  changed: boolean;
  reason?: string;
}

/**
 * Relê a fatura no Cora e leva o pedido ao status correspondente.
 *
 * Idempotente: reprocessar o mesmo estado não muda nada, e as transições só
 * andam para a frente (PENDING -> RECEIVED ou PENDING -> CANCELLED). Um
 * reenvio do webhook depois da entrega não derruba o pedido de volta.
 */
export async function applyCoraInvoiceToOrder(invoiceId: string, source: string): Promise<ApplyResult> {
  const db = getFirestore();
  const invoice = await getCoraInvoice(invoiceId);

  const chargeRef = db.collection(CORA_CHARGES).doc(invoiceId);
  await chargeRef.set({
    invoiceStatus: invoice.status,
    checkedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  const target: OrderStatus | null =
    invoice.status === 'PAID' ? 'RECEIVED'
      : invoice.status === 'CANCELLED' ? 'CANCELLED'
        : null;

  const ordersSnap = await db.collection('orders')
    .where('coraInvoiceId', '==', invoiceId)
    .limit(1)
    .get();

  if (ordersSnap.empty) {
    logger.warn('Fatura do Cora sem pedido correspondente', { invoiceId, status: invoice.status, source });
    return { invoiceStatus: invoice.status, changed: false, reason: 'ORDER_NOT_FOUND' };
  }

  const orderRef = ordersSnap.docs[0].ref;
  const chargeUid = (await chargeRef.get()).data()?.['uid'];

  return db.runTransaction(async tx => {
    const snap = await tx.get(orderRef);
    const order = snap.data() as { status?: OrderStatus; total?: number; userId?: string };
    const current = order.status || 'PENDING';
    const base: ApplyResult = { invoiceStatus: invoice.status, orderId: orderRef.id, orderStatus: current, changed: false };

    if (!target || current !== 'PENDING') return base;

    // O pedido é escrito pelo navegador. Sem esta checagem, alguém criaria um
    // pedido apontando para a fatura paga de outra pessoa.
    if (chargeUid && order.userId !== chargeUid) {
      logger.error('Pedido aponta para fatura de outro usuário', { orderId: orderRef.id, invoiceId });
      tx.update(orderRef, {
        paymentAlert: { reason: 'OWNER_MISMATCH', detectedAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp()
      });
      return { ...base, reason: 'OWNER_MISMATCH' };
    }

    // O valor cobrado ainda vem do navegador. Aqui a conta é conferida:
    // divergiu, o pedido NÃO vira pago e fica sinalizado para o admin.
    // PENDÊNCIA (Fase 1): calcular o total no servidor, a partir de products/.
    if (target === 'RECEIVED') {
      const expectedValue = Number(order.total ?? 0);
      const paidCents = invoice.total_paid || invoice.total_amount || 0;
      const paidValue = paidCents / 100;

      if (!(expectedValue > 0) || Math.abs(paidValue - expectedValue) > VALUE_TOLERANCE) {
        logger.error('Valor pago no Cora diverge do total do pedido', {
          orderId: orderRef.id, invoiceId, expectedValue, paidValue
        });
        tx.update(orderRef, {
          paymentAlert: {
            reason: 'VALUE_MISMATCH',
            expectedValue,
            paidValue,
            detectedAt: FieldValue.serverTimestamp()
          },
          updatedAt: FieldValue.serverTimestamp()
        });
        return { ...base, reason: 'VALUE_MISMATCH' };
      }
    }

    tx.update(orderRef, {
      status: target,
      ...(target === 'RECEIVED'
        ? { paymentConfirmedBy: `cora-${source}`, paymentConfirmedAt: FieldValue.serverTimestamp() }
        : {}),
      updatedAt: FieldValue.serverTimestamp()
    });

    logger.info('Pedido atualizado pelo Cora', { orderId: orderRef.id, from: current, to: target, source });
    return { ...base, orderStatus: target, changed: true };
  });
}

// ------------------------------------------------------------------ emissão

/**
 * Emite a cobrança (PIX ou boleto com PIX) do usuário logado.
 *
 * O dono da fatura fica em `coraCharges/{invoiceId}` — é por ele que as outras
 * funções decidem quem pode consultar ou simular, e que o webhook confere o
 * pedido.
 */
export const createCoraCharge = onRequest(coraRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  const { billingType, value, dueDate, description, customer, address } =
    (req.body || {}) as CreateChargePayload;

  if (billingType !== 'PIX' && billingType !== 'BOLETO') {
    res.status(400).json({ error: 'Forma de pagamento inválida.' });
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    res.status(400).json({ error: 'Valor inválido.' });
    return;
  }

  if (toCents(value) < CORA_MIN_CENTS) {
    res.status(400).json({ error: 'PIX e boleto aceitam compras a partir de R$ 5,00.' });
    return;
  }

  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    res.status(400).json({ error: 'Data de vencimento inválida (use YYYY-MM-DD).' });
    return;
  }

  const document = onlyDigits(customer?.cpfCnpj);
  const name = (customer?.name || '').trim();
  if (!name || (document.length !== 11 && document.length !== 14)) {
    res.status(400).json({ error: 'Nome e CPF/CNPJ válidos são obrigatórios.' });
    return;
  }

  const email = (customer?.email || user.email || '').trim();
  const zipCode = onlyDigits(address?.zipCode);

  const body: Record<string, unknown> = {
    customer: {
      name: name.slice(0, CORA_NAME_MAX),
      ...(email && email.length <= CORA_EMAIL_MAX ? { email } : {}),
      document: { identity: document, type: document.length === 11 ? 'CPF' : 'CNPJ' },
      ...(address?.street && zipCode.length === 8
        ? {
            address: {
              street: address.street,
              number: address.number || 'S/N',
              district: address.district || 'Centro',
              city: address.city || '',
              state: (address.state || '').toUpperCase().slice(0, 2),
              complement: address.complement || 'N/A',
              zip_code: zipCode
            }
          }
        : {})
    },
    services: [{
      name: 'Pedido Vineon',
      description: (description || 'Compra no site Vineon').slice(0, 100),
      amount: toCents(value)
    }],
    payment_terms: { due_date: dueDate },
    // Sempre boleto + PIX: fatura só com PIX volta `REC-0030 Bank slip not
    // registered in CIP` (visto no stage em 2026-09-24). No PIX o app mostra só
    // o QR; o boleto da mesma fatura fica sem uso.
    payment_forms: ['BANK_SLIP', 'PIX']
  };

  try {
    const invoice = await requestCora<CoraInvoice>('POST', '/v2/invoices', body);

    await getFirestore().collection(CORA_CHARGES).doc(invoice.id).set({
      uid: user.uid,
      billingType,
      amountCents: toCents(value),
      invoiceStatus: invoice.status,
      sandbox: isCoraSandbox(),
      createdAt: FieldValue.serverTimestamp()
    });

    logger.info('Cobrança Cora emitida', { uid: user.uid, invoiceId: invoice.id, billingType, sandbox: isCoraSandbox() });
    res.status(200).json(presentInvoice(invoice));
  } catch (error) {
    respondError(res, error, 'Erro ao gerar cobrança.');
  }
});

/**
 * "Já paguei": consulta o Cora e atualiza o pedido na hora. Serve de rede de
 * segurança quando o webhook atrasa ou não foi cadastrado.
 */
export const syncCoraCharge = onRequest(coraRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  const invoiceId = String(req.query['invoiceId'] || (req.body || {}).invoiceId || '').trim();
  if (!invoiceId) {
    res.status(400).json({ error: 'invoiceId é obrigatório.' });
    return;
  }

  try {
    if (!await assertChargeOwner(invoiceId, user, res)) return;

    const result = await applyCoraInvoiceToOrder(invoiceId, 'sync');
    res.status(200).json(result);
  } catch (error) {
    respondError(res, error, 'Erro ao consultar cobrança.');
  }
});

/** Dados da cobrança para reabrir o pagamento (tela de PIX, "Meus pedidos"). */
export const getCoraCharge = onRequest(coraRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  const invoiceId = String(req.query['invoiceId'] || '').trim();
  if (!invoiceId) {
    res.status(400).json({ error: 'invoiceId é obrigatório.' });
    return;
  }

  try {
    if (!await assertChargeOwner(invoiceId, user, res)) return;

    res.status(200).json(presentInvoice(await getCoraInvoice(invoiceId)));
  } catch (error) {
    respondError(res, error, 'Erro ao consultar cobrança.');
  }
});

/**
 * Paga a fatura de mentira — SÓ no ambiente stage do Cora.
 *
 * Em produção esta função recusa tudo: a trava é o `CORA_ENV`, que vive no
 * servidor, e não o build do app. O Cora dispara o webhook `invoice.paid`
 * como numa compra de verdade, então o fluxo testado é o real.
 */
export const simulateCoraPayment = onRequest(coraRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  if (!isCoraSandbox()) {
    res.status(403).json({ error: 'Simulação disponível apenas no sandbox.' });
    return;
  }

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  const invoiceId = String((req.body || {}).invoiceId || '').trim();
  if (!invoiceId) {
    res.status(400).json({ error: 'invoiceId é obrigatório.' });
    return;
  }

  try {
    if (!await assertChargeOwner(invoiceId, user, res)) return;

    await requestCora('POST', '/v2/invoices/pay', { id: invoiceId });
    logger.info('Pagamento simulado no stage do Cora', { invoiceId, by: user.uid });

    // Pode ainda estar IN_PAYMENT; nesse caso o webhook (ou o "já paguei")
    // conclui daqui a pouco.
    const result = await applyCoraInvoiceToOrder(invoiceId, 'simulation');
    res.status(200).json(result);
  } catch (error) {
    respondError(res, error, 'Erro ao simular pagamento.');
  }
});
