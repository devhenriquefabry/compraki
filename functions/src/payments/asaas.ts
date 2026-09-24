import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';

import {
  AuthenticatedRequest,
  defaultRuntime,
  handleCors,
  methodNotAllowed,
  requireAdmin,
  requireAuthenticated
} from '../shared/http';

/**
 * Integração com o Asaas — lado servidor.
 *
 * POR QUE ISSO EXISTE
 * A chave de produção do Asaas estava literal em
 * `src/app/services/asaas.service.ts`, ou seja, dentro do bundle JavaScript
 * publicado e no histórico do Git. Qualquer pessoa com o app aberto podia
 * extraí-la e emitir cobranças, ler a base de clientes e movimentar a conta.
 *
 * Agora a chave só existe aqui, em `ASAAS_API_KEY`, e o cliente fala apenas
 * com estas funções — que verificam o ID token antes de qualquer coisa.
 *
 * PENDÊNCIA (Fase 1): dados de cartão ainda chegam em claro do navegador.
 * O certo é tokenizar no front com o SDK do Asaas e mandar só o token, o que
 * tira o app do escopo pesado do PCI-DSS. Ver `createAsaasPayment`.
 */

const ASAAS_TIMEOUT_MS = 20000;

interface AsaasCustomerPayload {
  name?: string;
  cpfCnpj?: string;
  email?: string;
  phone?: string;
}

interface CreditCard {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

interface CreditCardHolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

interface CreatePaymentPayload {
  customerId?: string;
  billingType?: 'BOLETO' | 'CREDIT_CARD' | 'PIX';
  value?: number;
  dueDate?: string;
  description?: string;
  creditCard?: CreditCard;
  creditCardHolderInfo?: CreditCardHolderInfo;
}

function getAsaasConfig(): { baseUrl: string; apiKey: string } {
  const apiKey = (process.env.ASAAS_API_KEY || '').trim();
  const baseUrl = (process.env.ASAAS_API_URL || 'https://api.asaas.com/v3').replace(/\/+$/, '');

  if (!apiKey) {
    throw new Error('ASAAS_API_KEY não configurada nas Functions.');
  }

  return { baseUrl, apiKey };
}

async function requestAsaas(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string> } = {}
): Promise<unknown> {
  const { baseUrl, apiKey } = getAsaasConfig();

  const url = new URL(`${baseUrl}${path}`);
  Object.entries(options.query || {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASAAS_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        access_token: apiKey
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const description = data?.errors?.[0]?.description || `Asaas respondeu ${response.status}`;
      // Nunca logar o corpo: pode conter dados de cartão e do titular.
      logger.error('Erro na chamada ao Asaas', { path, status: response.status, description });
      throw new Error(description);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/** Erro seguro para devolver ao cliente, sem vazar detalhe de integração. */
function respondError(res: Parameters<typeof handleCors>[1], error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;

  if (message.includes('ASAAS_API_KEY')) {
    res.status(503).json({ error: 'Pagamentos indisponíveis no momento.' });
    return;
  }

  res.status(400).json({ error: message });
}

/**
 * Cria (ou reaproveita) o cliente no Asaas correspondente ao usuário logado.
 *
 * O `customerId` fica guardado em `users/{uid}.asaasCustomerId` pelo Admin SDK
 * — o cliente não escolhe para qual customer a cobrança vai, o que impediria
 * emitir cobrança em nome de outra pessoa.
 */
export const createAsaasCustomer = onRequest(defaultRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  const { name, cpfCnpj, email, phone } = (req.body || {}) as AsaasCustomerPayload;

  if (!name || !cpfCnpj) {
    res.status(400).json({ error: 'Nome e CPF/CNPJ são obrigatórios.' });
    return;
  }

  const digits = String(cpfCnpj).replace(/\D/g, '');
  if (digits.length !== 11 && digits.length !== 14) {
    res.status(400).json({ error: 'CPF/CNPJ inválido.' });
    return;
  }

  try {
    const db = getFirestore();
    const userRef = db.doc(`users/${user.uid}`);
    const userSnap = await userRef.get();
    const existingId = userSnap.data()?.['asaasCustomerId'];

    if (existingId) {
      res.status(200).json({ id: existingId, reused: true });
      return;
    }

    // Reaproveita o cadastro se o CPF já existir no Asaas.
    const search = await requestAsaas('/customers', { query: { cpfCnpj: digits } }) as {
      data?: Array<{ id: string }>;
    };

    const found = search?.data?.[0];
    const customer = found
      ? found
      : await requestAsaas('/customers', {
          method: 'POST',
          body: { name, cpfCnpj: digits, email: email || user.email, phone }
        }) as { id: string };

    await userRef.set({ asaasCustomerId: customer.id }, { merge: true });

    logger.info('Cliente Asaas vinculado ao usuário', { uid: user.uid });
    res.status(200).json({ id: customer.id, reused: Boolean(found) });
  } catch (error) {
    respondError(res, error, 'Erro ao criar cliente.');
  }
});

/**
 * Cria uma cobrança para o usuário logado.
 *
 * O `customer` vem SEMPRE de `users/{uid}.asaasCustomerId`, nunca do corpo da
 * requisição — caso contrário daria para emitir cobrança em nome de terceiros.
 */
export const createAsaasPayment = onRequest(defaultRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  const body = (req.body || {}) as CreatePaymentPayload;
  const { billingType, value, dueDate, description, creditCard, creditCardHolderInfo } = body;

  // PIX e boleto saem pelo Cora (`./cora.ts`); o Asaas ficou só com cartão.
  // Cobrança PIX/boleto nova aqui cairia na conta errada.
  if (billingType !== 'CREDIT_CARD') {
    res.status(400).json({ error: 'Forma de pagamento inválida.' });
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    res.status(400).json({ error: 'Valor inválido.' });
    return;
  }

  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    res.status(400).json({ error: 'Data de vencimento inválida (use YYYY-MM-DD).' });
    return;
  }

  try {
    const db = getFirestore();
    const userSnap = await db.doc(`users/${user.uid}`).get();
    const customerId = userSnap.data()?.['asaasCustomerId'];

    if (!customerId) {
      res.status(400).json({
        error: 'Cadastro de pagamento não encontrado. Confirme seus dados antes de pagar.'
      });
      return;
    }

    const payload: Record<string, unknown> = {
      customer: customerId,
      billingType,
      value,
      dueDate,
      description: description || 'Compra no app',
      externalReference: user.uid
    };

    if (!creditCard || !creditCardHolderInfo) {
      res.status(400).json({ error: 'Dados do cartão incompletos.' });
      return;
    }
    // TODO (Fase 1): trocar por `creditCardToken` gerado no front pelo SDK
    // do Asaas, para que número e CCV nunca passem por aqui.
    payload['creditCard'] = creditCard;
    payload['creditCardHolderInfo'] = creditCardHolderInfo;
    payload['remoteIp'] = req.ip;

    const payment = await requestAsaas('/payments', { method: 'POST', body: payload }) as {
      id: string;
      status: string;
      invoiceUrl?: string;
      bankSlipUrl?: string;
    };

    logger.info('Cobrança criada', { uid: user.uid, paymentId: payment.id, billingType });

    res.status(200).json({
      id: payment.id,
      status: payment.status,
      invoiceUrl: payment.invoiceUrl,
      bankSlipUrl: payment.bankSlipUrl
    });
  } catch (error) {
    respondError(res, error, 'Erro ao processar pagamento.');
  }
});

/**
 * Consulta uma cobrança. Só devolve o que pertence a quem está perguntando
 * (`externalReference` == uid), ou qualquer uma para admin.
 */
export const getAsaasPayment = onRequest(defaultRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  const paymentId = String(req.query['paymentId'] || (req.body || {}).paymentId || '').trim();
  if (!paymentId) {
    res.status(400).json({ error: 'paymentId é obrigatório.' });
    return;
  }

  try {
    const payment = await requestAsaas(`/payments/${encodeURIComponent(paymentId)}`) as {
      externalReference?: string;
      status?: string;
      value?: number;
      billingType?: string;
      invoiceUrl?: string;
    };

    if (payment.externalReference !== user.uid && user.isTokenAdmin !== true) {
      // 404 em vez de 403: não confirma a existência do id para quem não é dono.
      res.status(404).json({ error: 'Cobrança não encontrada.' });
      return;
    }

    res.status(200).json({
      status: payment.status,
      value: payment.value,
      billingType: payment.billingType,
      invoiceUrl: payment.invoiceUrl
    });
  } catch (error) {
    respondError(res, error, 'Erro ao consultar cobrança.');
  }
});

/**
 * Estorno. Restrito a admin: devolver dinheiro é operação de retaguarda e
 * nunca deve partir do app do comprador.
 */
export const refundAsaasPayment = onRequest(defaultRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const admin: AuthenticatedRequest | null = await requireAdmin(req, res);
  if (!admin) return;

  const { paymentId, value, description } = (req.body || {}) as {
    paymentId?: string;
    value?: number;
    description?: string;
  };

  if (!paymentId) {
    res.status(400).json({ error: 'paymentId é obrigatório.' });
    return;
  }

  try {
    const payload: Record<string, unknown> = {};
    if (typeof value === 'number' && value > 0) payload['value'] = value;
    if (description) payload['description'] = description;

    const refund = await requestAsaas(`/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: 'POST',
      body: Object.keys(payload).length > 0 ? payload : undefined
    });

    logger.info('Estorno solicitado', { paymentId, by: admin.uid });
    res.status(200).json(refund);
  } catch (error) {
    respondError(res, error, 'Erro ao processar estorno.');
  }
});
