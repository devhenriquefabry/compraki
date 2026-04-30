import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

initializeApp();

const region = 'us-central1';

interface AuthenticatedRequest {
  uid: string;
  email?: string;
  isTokenAdmin?: boolean;
}

interface EvolutionInstanceRequest {
  instanceName?: string;
  webhookUrl?: string;
}

interface EvolutionTestMessageRequest {
  instanceName?: string;
  phoneNumber?: string;
  message?: string;
}

type WhatsappTriggerEvent =
  | 'account_created'
  | 'product_uploaded'
  | 'new_conversation'
  | 'product_sold'
  | 'new_login';

interface WhatsappTriggerConfig {
  eventType: WhatsappTriggerEvent;
  label: string;
  enabled: boolean;
  instanceName: string;
  phoneNumber: string;
  message: string;
  updatedAt?: unknown;
  updatedBy?: string;
}

interface WhatsappTriggerRequest {
  eventType?: WhatsappTriggerEvent;
  enabled?: boolean;
  instanceName?: string;
  phoneNumber?: string;
  message?: string;
}

interface WhatsappTriggerDispatchRequest {
  eventType?: WhatsappTriggerEvent;
  data?: Record<string, unknown>;
}

interface EvolutionRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
}

interface HttpResponse {
  set(field: string, value: string): HttpResponse;
  status(code: number): HttpResponse;
  json(body: unknown): void;
  send(body: string): void;
}

interface StoredWhatsappInstance {
  name: string;
  status: string;
  webhookUrl?: string | null;
  createdBy?: string;
  createdByEmail?: string;
  evolutionData?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface NormalizedEvolutionInstance {
  name: string;
  status: string;
  raw: unknown;
}

const defaultCorsHeaders = {
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-evolution-webhook-secret',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '3600'
};

const whatsappTriggerDefaults: Array<Pick<WhatsappTriggerConfig, 'eventType' | 'label' | 'message'>> = [
  {
    eventType: 'account_created',
    label: 'Criação de conta',
    message: 'Nova conta criada na Compraki: {{nome}} ({{email}}). Telefone: {{telefone}}.'
  },
  {
    eventType: 'product_uploaded',
    label: 'Upload de produto',
    message: 'Novo produto publicado na Compraki: {{produto}} por {{nome}}. Valor: {{valor}}.'
  },
  {
    eventType: 'new_conversation',
    label: 'Nova conversa',
    message: 'Nova conversa iniciada na Compraki. Cliente: {{nome}}. Produto: {{produto}}. Chat: {{chat}}.'
  },
  {
    eventType: 'product_sold',
    label: 'Venda de produto',
    message: 'Nova venda na Compraki! Pedido {{pedido}}, cliente {{nome}}, total {{valor}}.'
  },
  {
    eventType: 'new_login',
    label: 'Novo login',
    message: 'Novo login na Compraki: {{nome}} ({{email}}).'
  }
];

export const createWhatsappInstance = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const { instanceName, webhookUrl } = req.body as EvolutionInstanceRequest;
  if (!instanceName) {
    res.status(400).json({ error: 'instanceName is required' });
    return;
  }

  const payload = {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    webhook: webhookUrl ? {
      url: webhookUrl,
      byEvents: true,
      base64: true
    } : undefined
  };

  const result = await requestEvolution('/instance/create', {
    method: 'POST',
    body: payload
  });

  await saveWhatsappInstance(instanceName, {
    name: instanceName,
    status: getNormalizedInstanceStatus(result) || 'created',
    webhookUrl: webhookUrl || null,
    createdBy: user.uid,
    createdByEmail: user.email,
    evolutionData: result,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  res.status(200).json(result);
});

export const getWhatsappQrCode = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const instanceName = getRequiredQuery(req, res, 'instanceName');
  if (!instanceName) return;

  const result = await requestEvolution(`/instance/connect/${encodeURIComponent(instanceName)}`);
  res.status(200).json(result);
});

export const listWhatsappInstances = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const result = await requestEvolution('/instance/fetchInstances');
    const evolutionInstances = normalizeEvolutionInstances(result);
    await syncWhatsappInstancesFromEvolution(evolutionInstances);

    const storedInstances = await getStoredWhatsappInstances();
    res.status(200).json({
      instances: mergeWhatsappInstances(storedInstances, evolutionInstances),
      evolution: result
    });
  } catch (error) {
    const storedInstances = await getStoredWhatsappInstances();
    if (storedInstances.length > 0) {
      logger.warn('Evolution API unavailable; returning stored WhatsApp instances', error);
      res.status(200).json({
        instances: storedInstances,
        source: 'firestore'
      });
      return;
    }

    throw error;
  }
});

export const disconnectWhatsappInstance = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'DELETE') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const instanceName = getInstanceName(req, res);
  if (!instanceName) return;

  const result = await requestEvolution(`/instance/logout/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE'
  });

  await saveWhatsappInstance(instanceName, {
    status: 'disconnected',
    evolutionData: result,
    updatedAt: FieldValue.serverTimestamp()
  });

  res.status(200).json(result);
});

export const deleteWhatsappInstance = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'DELETE') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const instanceName = getInstanceName(req, res);
  if (!instanceName) return;

  const result = await requestEvolution(`/instance/delete/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE'
  });

  await deleteStoredWhatsappInstance(instanceName);

  res.status(200).json(result);
});

export const sendWhatsappTestMessage = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const { instanceName, phoneNumber, message } = req.body as EvolutionTestMessageRequest;
  if (!instanceName || !phoneNumber || !message) {
    res.status(400).json({ error: 'instanceName, phoneNumber and message are required' });
    return;
  }

  try {
    const result = await requestEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: {
        number: phoneNumber.replace(/\D/g, ''),
        text: message
      }
    });

    res.status(200).json(result);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao enviar mensagem de teste.';
    if (messageText.includes('EVOLUTION_API_URL and EVOLUTION_API_KEY must be configured')) {
      logger.error('Evolution API not configured', { instanceName });
      res.status(503).json({
        error: 'Evolution API não configurada nas Functions (defina EVOLUTION_API_URL e EVOLUTION_API_KEY em functions/.env e faça deploy).'
      });
      return;
    }
    if (messageText.includes('Evolution API request failed')) {
      logger.error('Evolution sendText failed', { instanceName, messageText });
      res.status(502).json({ error: messageText });
      return;
    }
    logger.error('sendWhatsappTestMessage unexpected error', error);
    res.status(500).json({ error: messageText });
  }
});

export const getWhatsappTriggers = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const triggers = await getWhatsappTriggerConfigs();
  res.status(200).json({ triggers });
});

export const saveWhatsappTrigger = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const payload = req.body as WhatsappTriggerRequest;
  if (!payload.eventType || !isWhatsappTriggerEvent(payload.eventType)) {
    res.status(400).json({ error: 'eventType is required' });
    return;
  }

  const defaults = getWhatsappTriggerDefault(payload.eventType);
  const trigger: WhatsappTriggerConfig = {
    eventType: payload.eventType,
    label: defaults.label,
    enabled: payload.enabled === true,
    instanceName: payload.instanceName?.trim() || '',
    phoneNumber: payload.phoneNumber?.trim() || '',
    message: payload.message?.trim() || defaults.message,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid
  };

  await getFirestore().collection('whatsappTriggers').doc(payload.eventType).set(trigger, { merge: true });
  res.status(200).json({ trigger });
});

export const dispatchWhatsappTrigger = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  const payload = req.body as WhatsappTriggerDispatchRequest;
  if (!payload.eventType || !isWhatsappTriggerEvent(payload.eventType)) {
    res.status(400).json({ error: 'eventType is required' });
    return;
  }

  const trigger = await getWhatsappTriggerConfig(payload.eventType);
  const logBase = {
    eventType: payload.eventType,
    userId: user.uid,
    userEmail: user.email || null,
    data: payload.data || {},
    createdAt: FieldValue.serverTimestamp()
  };

  if (!trigger.enabled) {
    await getFirestore().collection('whatsappTriggerLogs').add({
      ...logBase,
      status: 'skipped',
      reason: 'disabled'
    });
    res.status(200).json({ sent: false, reason: 'disabled' });
    return;
  }

  if (!trigger.instanceName || !trigger.phoneNumber || !trigger.message) {
    await getFirestore().collection('whatsappTriggerLogs').add({
      ...logBase,
      status: 'skipped',
      reason: 'incomplete_config'
    });
    res.status(200).json({ sent: false, reason: 'incomplete_config' });
    return;
  }

  const message = renderWhatsappTriggerMessage(trigger.message, {
    evento: trigger.label,
    ...(payload.data || {})
  });

  const result = await requestEvolution(`/message/sendText/${encodeURIComponent(trigger.instanceName)}`, {
    method: 'POST',
    body: {
      number: trigger.phoneNumber.replace(/\D/g, ''),
      text: message
    }
  });

  await getFirestore().collection('whatsappTriggerLogs').add({
    ...logBase,
    status: 'sent',
    instanceName: trigger.instanceName,
    phoneNumber: trigger.phoneNumber,
    message,
    result
  });

  res.status(200).json({ sent: true, result });
});

export const evolutionWebhook = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const expectedSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (expectedSecret && req.header('x-evolution-webhook-secret') !== expectedSecret) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return;
  }

  const db = getFirestore();
  const payload = req.body as Record<string, unknown>;
  const instanceName = getString(payload.instance) || getString(payload.instanceName) || 'unknown';
  const eventName = getString(payload.event) || getString(payload.type) || 'unknown';

  await db.collection('whatsappWebhookEvents').add({
    instanceName,
    eventName,
    payload,
    receivedAt: new Date()
  });

  await saveWhatsappInstance(instanceName, {
    name: instanceName,
    status: getNormalizedInstanceStatus(payload) || eventName,
    evolutionData: payload,
    updatedAt: FieldValue.serverTimestamp()
  });

  logger.info('Evolution webhook received', { instanceName, eventName });
  res.status(200).json({ ok: true });
});

async function requireAdmin(req: Request, res: HttpResponse): Promise<AuthenticatedRequest | null> {
  const decodedUser = await requireAuthenticated(req, res);
  if (!decodedUser) return null;

  try {
    const userSnap = await getFirestore().doc(`users/${decodedUser.uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const isAdmin = decodedUser.isTokenAdmin === true
      || userData?.['isAdmin'] === true
      || userData?.['super_admin'] === true
      || userData?.['role'] === 'admin'
      || isAdminEmail(decodedUser.email);

    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return null;
    }

    return decodedUser;
  } catch (error) {
    logger.warn('Failed to verify admin access', error);
    res.status(401).json({ error: 'Invalid Firebase ID token' });
    return null;
  }
}

async function requireAuthenticated(req: Request, res: HttpResponse): Promise<AuthenticatedRequest | null> {
  const authorization = req.header('authorization') || '';
  const match = authorization.match(/^Bearer (.+)$/i);

  if (!match) {
    res.status(401).json({ error: 'Missing Firebase ID token' });
    return null;
  }

  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    return {
      uid: decoded.uid,
      email: decoded.email,
      isTokenAdmin: decoded['admin'] === true
    };
  } catch (error) {
    logger.warn('Failed to verify Firebase ID token', error);
    res.status(401).json({ error: 'Invalid Firebase ID token' });
    return null;
  }
}

async function requestEvolution(path: string, options: EvolutionRequestOptions = {}): Promise<unknown> {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error('EVOLUTION_API_URL and EVOLUTION_API_KEY must be configured');
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) as unknown : {};

  if (!response.ok) {
    logger.error('Evolution API request failed', { path, status: response.status, data });
    throw new Error(`Evolution API request failed with status ${response.status}`);
  }

  return data;
}

function handleCors(req: Request, res: HttpResponse): boolean {
  const requestOrigin = req.header('origin') || '';
  const allowedOrigin = getAllowedCorsOrigin(requestOrigin);

  if (allowedOrigin) {
    res.set('Access-Control-Allow-Origin', allowedOrigin);
  }

  res.set('Vary', 'Origin');
  Object.entries(defaultCorsHeaders).forEach(([key, value]) => res.set(key, value));

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }

  return false;
}

function getAllowedCorsOrigin(requestOrigin: string): string {
  const configuredOrigins = [
    ...(process.env.ALLOWED_ORIGINS || '').split(','),
    ...(process.env.ALLOWED_ORIGIN || '').split(',')
  ]
    .map(origin => origin.trim())
    .filter(Boolean);

  const allowedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : [
        'http://localhost:8100',
        'http://127.0.0.1:8100',
        'capacitor://localhost',
        'ionic://localhost'
      ];

  if (allowedOrigins.includes('*')) return '*';
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin;

  return allowedOrigins[0] || '*';
}

function methodNotAllowed(res: HttpResponse): void {
  res.status(405).json({ error: 'Method not allowed' });
}

function getRequiredQuery(req: Request, res: HttpResponse, key: string): string | null {
  const value = req.query[key];
  if (typeof value === 'string' && value.trim()) return value.trim();

  res.status(400).json({ error: `${key} is required` });
  return null;
}

function getInstanceName(req: Request, res: HttpResponse): string | null {
  const body = req.body as EvolutionInstanceRequest;
  if (body.instanceName) return body.instanceName;
  return getRequiredQuery(req, res, 'instanceName');
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function saveWhatsappInstance(instanceName: string, data: Partial<StoredWhatsappInstance>): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection('whatsappInstances').doc(getWhatsappInstanceDocId(instanceName));

  await docRef.set({
    ...data,
    name: data.name || instanceName,
    updatedAt: data.updatedAt || FieldValue.serverTimestamp()
  }, { merge: true });
}

async function deleteStoredWhatsappInstance(instanceName: string): Promise<void> {
  const db = getFirestore();
  await db.collection('whatsappInstances').doc(getWhatsappInstanceDocId(instanceName)).delete();
}

async function getStoredWhatsappInstances(): Promise<StoredWhatsappInstance[]> {
  const snapshot = await getFirestore().collection('whatsappInstances').get();

  return snapshot.docs
    .map(doc => doc.data() as StoredWhatsappInstance)
    .filter(instance => Boolean(instance.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function syncWhatsappInstancesFromEvolution(instances: NormalizedEvolutionInstance[]): Promise<void> {
  await Promise.all(instances.map(instance => saveWhatsappInstance(instance.name, {
    name: instance.name,
    status: instance.status,
    evolutionData: instance.raw,
    updatedAt: FieldValue.serverTimestamp()
  })));
}

function mergeWhatsappInstances(
  storedInstances: StoredWhatsappInstance[],
  evolutionInstances: NormalizedEvolutionInstance[]
): StoredWhatsappInstance[] {
  const byName = new Map<string, StoredWhatsappInstance>();

  storedInstances.forEach(instance => {
    byName.set(instance.name, instance);
  });

  evolutionInstances.forEach(instance => {
    const stored = byName.get(instance.name);
    byName.set(instance.name, {
      ...stored,
      name: instance.name,
      status: instance.status,
      evolutionData: instance.raw
    });
  });

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeEvolutionInstances(response: unknown): NormalizedEvolutionInstance[] {
  const value = response as { instances?: unknown; data?: unknown };
  const list = Array.isArray(response)
    ? response
    : Array.isArray(value.instances)
      ? value.instances
      : Array.isArray(value.data)
        ? value.data
        : [];

  return list.map((item, index) => {
    const record = item as Record<string, unknown>;
    const name = getString(record['name'])
      || getString(record['instanceName'])
      || getString(record['instance'])
      || `Instância ${index + 1}`;

    return {
      name,
      status: getNormalizedInstanceStatus(item) || 'desconhecido',
      raw: item
    };
  });
}

function getNormalizedInstanceStatus(value: unknown): string | null {
  const record = value as Record<string, unknown>;
  return getString(record['connectionStatus'])
    || getString(record['status'])
    || getString(record['state'])
    || getString((record['instance'] as Record<string, unknown> | undefined)?.['state'])
    || getString((record['instance'] as Record<string, unknown> | undefined)?.['status']);
}

function getWhatsappInstanceDocId(instanceName: string): string {
  return encodeURIComponent(instanceName.trim());
}

async function getWhatsappTriggerConfigs(): Promise<WhatsappTriggerConfig[]> {
  const snapshot = await getFirestore().collection('whatsappTriggers').get();
  const savedByEvent = new Map<string, Partial<WhatsappTriggerConfig>>();

  snapshot.docs.forEach(doc => {
    savedByEvent.set(doc.id, doc.data() as Partial<WhatsappTriggerConfig>);
  });

  return whatsappTriggerDefaults.map(defaultConfig => ({
    eventType: defaultConfig.eventType,
    label: defaultConfig.label,
    enabled: false,
    instanceName: '',
    phoneNumber: '',
    message: defaultConfig.message,
    ...savedByEvent.get(defaultConfig.eventType)
  }));
}

async function getWhatsappTriggerConfig(eventType: WhatsappTriggerEvent): Promise<WhatsappTriggerConfig> {
  const snapshot = await getFirestore().collection('whatsappTriggers').doc(eventType).get();
  const defaults = getWhatsappTriggerDefault(eventType);

  return {
    eventType,
    label: defaults.label,
    enabled: false,
    instanceName: '',
    phoneNumber: '',
    message: defaults.message,
    ...(snapshot.exists ? snapshot.data() as Partial<WhatsappTriggerConfig> : {})
  };
}

function getWhatsappTriggerDefault(eventType: WhatsappTriggerEvent): Pick<WhatsappTriggerConfig, 'eventType' | 'label' | 'message'> {
  return whatsappTriggerDefaults.find(trigger => trigger.eventType === eventType) || whatsappTriggerDefaults[0];
}

function isWhatsappTriggerEvent(value: unknown): value is WhatsappTriggerEvent {
  return whatsappTriggerDefaults.some(trigger => trigger.eventType === value);
}

function renderWhatsappTriggerMessage(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) return '';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'sim' : 'não';
    return String(value);
  });
}

function isAdminEmail(email?: string): boolean {
  if (!email) return false;

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  return adminEmails.includes(email.toLowerCase());
}
