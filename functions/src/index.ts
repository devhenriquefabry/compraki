import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

initializeApp();

const region = 'us-central1';

interface AuthenticatedRequest {
  uid: string;
  email?: string;
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

const defaultCorsHeaders = {
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-evolution-webhook-secret',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '3600'
};

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

  const result = await requestEvolution('/instance/fetchInstances');
  res.status(200).json(result);
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

  const result = await requestEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {
      number: phoneNumber.replace(/\D/g, ''),
      text: message
    }
  });

  res.status(200).json(result);
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

  logger.info('Evolution webhook received', { instanceName, eventName });
  res.status(200).json({ ok: true });
});

async function requireAdmin(req: Request, res: HttpResponse): Promise<AuthenticatedRequest | null> {
  const authorization = req.header('authorization') || '';
  const match = authorization.match(/^Bearer (.+)$/i);

  if (!match) {
    res.status(401).json({ error: 'Missing Firebase ID token' });
    return null;
  }

  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    const userSnap = await getFirestore().doc(`users/${decoded.uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const isAdmin = decoded['admin'] === true
      || userData?.['isAdmin'] === true
      || userData?.['super_admin'] === true
      || userData?.['role'] === 'admin';

    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return null;
    }

    return {
      uid: decoded.uid,
      email: decoded.email
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
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.set('Access-Control-Allow-Origin', allowedOrigin);
  Object.entries(defaultCorsHeaders).forEach(([key, value]) => res.set(key, value));

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }

  return false;
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
