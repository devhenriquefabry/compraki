import { Agent, request } from 'node:https';
import { randomUUID } from 'node:crypto';
import { logger } from 'firebase-functions';

/**
 * Cliente HTTP do Cora — modalidade "Integração Direta".
 *
 * COMO O CORA AUTENTICA
 * Não existe chave de API simples. Toda chamada, inclusive a que pega o token,
 * vai por mTLS: o certificado e a chave privada que o Cora emite para a conta
 * (app ou Cora Web > Conta > Integrações via APIs) são apresentados no TLS, e o
 * `client_id` troca isso por um access token de 24 h. Stage e produção têm
 * credenciais DIFERENTES — certificado de um não abre o outro.
 *
 * O certificado e a chave vêm do `functions/.env` em base64 (uma linha só, que
 * é o que o `.env` aguenta). `node scripts/cora.mjs import-cert` gera as linhas.
 */

export type CoraEnv = 'stage' | 'production';

const BASE_URLS: Record<CoraEnv, string> = {
  stage: 'https://matls-clients.api.stage.cora.com.br',
  production: 'https://matls-clients.api.cora.com.br'
};

const CORA_TIMEOUT_MS = 20000;

/** Renova o token um pouco antes de vencer, para não estourar no meio da chamada. */
const TOKEN_SAFETY_MS = 5 * 60 * 1000;

interface CoraConfig {
  env: CoraEnv;
  baseUrl: string;
  clientId: string;
  agent: Agent;
}

let cachedConfig: CoraConfig | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

/** Aceita PEM direto ou PEM em base64 (o formato do `.env`). */
function decodePem(raw: string): string {
  const value = raw.trim();
  if (value.includes('-----BEGIN')) return value.replace(/\\n/g, '\n');

  return Buffer.from(value, 'base64').toString('utf8');
}

export function getCoraEnv(): CoraEnv {
  return (process.env.CORA_ENV || '').trim().toLowerCase() === 'production'
    ? 'production'
    : 'stage';
}

export function isCoraSandbox(): boolean {
  return getCoraEnv() === 'stage';
}

function getCoraConfig(): CoraConfig {
  if (cachedConfig) return cachedConfig;

  const env = getCoraEnv();
  const clientId = (process.env.CORA_CLIENT_ID || '').trim();
  const certificate = (process.env.CORA_CERTIFICATE || '').trim();
  const privateKey = (process.env.CORA_PRIVATE_KEY || '').trim();

  if (!clientId || !certificate || !privateKey) {
    throw new Error('CORA_CLIENT_ID, CORA_CERTIFICATE e CORA_PRIVATE_KEY não configurados nas Functions.');
  }

  const baseUrl = ((process.env.CORA_API_URL || '').trim() || BASE_URLS[env]).replace(/\/+$/, '');

  cachedConfig = {
    env,
    baseUrl,
    clientId,
    agent: new Agent({
      cert: decodePem(certificate),
      key: decodePem(privateKey),
      keepAlive: true
    })
  };

  return cachedConfig;
}

interface RawResponse {
  status: number;
  body: string;
}

function send(
  config: CoraConfig,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${config.baseUrl}${path}`);
    const req = request(url, {
      method,
      agent: config.agent,
      headers: {
        Accept: 'application/json',
        ...headers,
        ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body).toString() } : {})
      },
      timeout: CORA_TIMEOUT_MS
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });

    req.on('timeout', () => req.destroy(new Error('Tempo esgotado falando com o Cora.')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function parse(body: string): any {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
}

/** Mensagem legível do erro do Cora, sem ecoar o corpo inteiro. */
function describeError(data: any, status: number): string {
  const first = Array.isArray(data?.errors) ? data.errors[0] : null;

  return first?.message || first?.description || data?.message || data?.error_description
    || data?.error || `Cora respondeu ${status}`;
}

async function getAccessToken(config: CoraConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId
  }).toString();

  const res = await send(config, 'POST', '/token', {
    'Content-Type': 'application/x-www-form-urlencoded'
  }, form);
  const data = parse(res.body);

  if (res.status < 200 || res.status >= 300 || !data.access_token) {
    logger.error('Falha ao autenticar no Cora', { status: res.status, env: config.env });
    throw new Error(`Autenticação no Cora falhou: ${describeError(data, res.status)}`);
  }

  const lifetimeMs = Number(data.expires_in || 3600) * 1000;
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(lifetimeMs - TOKEN_SAFETY_MS, 60 * 1000)
  };

  return cachedToken.value;
}

/**
 * Chamada autenticada à API do Cora. Métodos de escrita levam
 * `Idempotency-Key`, que o Cora exige.
 */
export async function requestCora<T = any>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  if (isFakeCora()) return fakeCora(method, path, body) as Promise<T>;

  const config = getCoraConfig();

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(config);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await send(config, method, path, headers, body !== undefined ? JSON.stringify(body) : undefined);
    const data = parse(res.body);

    // Token revogado antes da hora: descarta e tenta uma vez mais.
    if (res.status === 401 && attempt === 0) {
      cachedToken = null;
      continue;
    }

    if (res.status < 200 || res.status >= 300) {
      // Nunca logar o corpo: tem CPF e endereço do comprador.
      logger.error('Erro na chamada ao Cora', { path, status: res.status, error: describeError(data, res.status) });
      throw new Error(describeError(data, res.status));
    }

    return data as T;
  }

  throw new Error('Autenticação no Cora falhou.');
}

// ------------------------------------------------------------------- faturas

export type CoraInvoiceStatus =
  | 'DRAFT' | 'OPEN' | 'IN_PAYMENT' | 'PAID' | 'LATE' | 'CANCELLED' | string;

export interface CoraInvoice {
  id: string;
  status: CoraInvoiceStatus;
  total_amount?: number;
  total_paid?: number;
  pix?: { emv?: string };
  payment_options?: {
    bank_slip?: { url?: string; digitable?: string; barcode?: string };
  };
}

export function getCoraInvoice(invoiceId: string): Promise<CoraInvoice> {
  return requestCora<CoraInvoice>('GET', `/v2/invoices/${encodeURIComponent(invoiceId)}`);
}

/** Cancela uma fatura em aberto (pedido cancelado antes de pagar). */
export function cancelCoraInvoice(invoiceId: string): Promise<unknown> {
  return requestCora('DELETE', `/v2/invoices/${encodeURIComponent(invoiceId)}`);
}

// ------------------------------------------------- Cora falso (só emulador)

/**
 * Cora de mentira para os testes no emulador: guarda as faturas no próprio
 * Firestore do emulador (`_fakeCoraInvoices`). Três travas juntas, para nunca
 * valer fora da máquina de teste: rodando no emulador, projeto `demo-*` e
 * `CORA_FAKE=1` (functions/.env.demo-vineon).
 */
function isFakeCora(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true'
    && /^demo-/.test(process.env.GCLOUD_PROJECT || '')
    && process.env.CORA_FAKE === '1';
}

async function fakeCora(method: string, path: string, body: any): Promise<unknown> {
  const { getFirestore } = await import('firebase-admin/firestore');
  const col = getFirestore().collection('_fakeCoraInvoices');
  const idFrom = (p: string) => decodeURIComponent(p.split('/').pop() || '');

  if (method === 'POST' && path === '/v2/invoices') {
    const amount = Number(body?.services?.[0]?.amount) || 0;
    if (amount < 500) throw new Error('services[0].amount must be >= 500');
    const id = `inv_fake_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const invoice: CoraInvoice = {
      id,
      status: 'OPEN',
      total_amount: amount,
      total_paid: 0,
      pix: { emv: `00020101021226860014br.gov.bcb.pix2564fake.cora/${id}5204000053039865802BR6304FAKE` },
      payment_options: { bank_slip: { url: `https://example.invalid/${id}.pdf`, digitable: '00190000090000000000000000000000000000000000000' } }
    };
    await col.doc(id).set({ ...invoice, request: body });
    return invoice;
  }
  if (method === 'GET' && path.startsWith('/v2/invoices/')) {
    const snap = await col.doc(idFrom(path)).get();
    if (!snap.exists) throw new Error('Invoice not found');
    const { request: _r, ...invoice } = snap.data() as any;
    return invoice;
  }
  if (method === 'POST' && path === '/v2/invoices/pay') {
    const ref = col.doc(String(body?.id || ''));
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Invoice not found');
    if (snap.get('status') === 'CANCELLED') throw new Error('Invoice cancelled');
    await ref.update({ status: 'PAID', total_paid: snap.get('total_amount') });
    return { ok: true };
  }
  if (method === 'DELETE' && path.startsWith('/v2/invoices/')) {
    const ref = col.doc(idFrom(path));
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Invoice not found');
    if (snap.get('status') === 'PAID') throw new Error('Invoice already paid');
    await ref.update({ status: 'CANCELLED' });
    return { ok: true };
  }
  throw new Error(`Cora falso: rota não simulada (${method} ${path})`);
}
