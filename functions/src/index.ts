import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { createHash } from 'node:crypto';
import * as nodemailer from 'nodemailer';

initializeApp();

const WHATSAPP_MEDIA_CACHE_COLLECTION = 'whatsappMediaCache';
const WHATSAPP_MEDIA_CACHE_STATS_DOC = 'whatsappMediaCacheStats/global';
const WHATSAPP_MEDIA_STORAGE_PREFIX = 'whatsapp-media';

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

interface EvolutionMediaMessageRequest {
  instanceName?: string;
  phoneNumber?: string;
  mediaBase64?: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
}

interface EvolutionChatMessagesRequest {
  instanceName?: string;
  remoteJid?: string;
  limit?: number;
  page?: number;
}

interface EvolutionResolveMediaRequest {
  instanceName?: string;
  message?: Record<string, unknown>;
}

interface WhatsappInstanceAccessCodeRequest {
  instanceName?: string;
  intent?: 'lock' | 'unlock';
}

interface WhatsappInstanceAccessCodeConfirmRequest {
  instanceName?: string;
  code?: string;
  intent?: 'lock' | 'unlock';
}

interface StoredWhatsappInstanceLock {
  instanceName: string;
  locked: boolean;
  pendingCode?: string | null;
  pendingCodeExpiresAt?: number | null;
  lastCodeSentAt?: number | null;
  failedAttempts?: number;
  updatedBy?: string;
  updatedAt?: unknown;
}

type BotJobStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled';

interface BotJobPayload {
  keyword?: string;
  count?: number | null;
  headless?: boolean;
  mode?: 'batch' | 'alternate';
  [key: string]: unknown;
}

interface CreateBotJobRequest {
  botType?: string;
  botLabel?: string;
  script?: string;
  priority?: number;
  payload?: BotJobPayload;
}

interface UpdateBotJobStateRequest {
  jobId?: string;
  status?: BotJobStatus;
  result?: Record<string, unknown>;
  errorMessage?: string;
}

interface AppendBotJobLogRequest {
  jobId?: string;
  message?: string;
  level?: 'info' | 'warn' | 'error';
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

export const sendWhatsappMediaMessage = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const payload = req.body as EvolutionMediaMessageRequest;
  const instanceName = payload.instanceName?.trim();
  const phoneNumber = payload.phoneNumber?.replace(/\D/g, '');
  const mimetype = payload.mimetype?.trim();
  const mediaBase64Raw = payload.mediaBase64?.trim() || '';
  const mediaType = payload.mediaType || 'document';
  const fileName = (payload.fileName || 'arquivo').trim();
  const caption = (payload.caption || '').trim();
  const mediaBase64 = mediaBase64Raw.replace(/^data:[^;]+;base64,/, '');

  if (!instanceName || !phoneNumber || !mimetype || !mediaBase64) {
    res.status(400).json({ error: 'instanceName, phoneNumber, mimetype and mediaBase64 are required' });
    return;
  }

  const candidatePayloads: Array<Record<string, unknown>> = [
    {
      number: phoneNumber,
      mediatype: mediaType,
      media: mediaBase64,
      mimetype,
      fileName,
      caption
    },
    {
      number: phoneNumber,
      mediaType,
      media: mediaBase64,
      mimeType: mimetype,
      fileName,
      caption
    },
    {
      number: phoneNumber,
      base64: mediaBase64,
      mimetype,
      fileName,
      caption
    }
  ];

  const candidatePaths = [
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    `/message/sendFile/${encodeURIComponent(instanceName)}`
  ];

  const attempts: Array<{ path: string; variant: number; ok: boolean; error?: string }> = [];
  let lastError = 'Falha ao enviar mídia';

  for (const path of candidatePaths) {
    for (let i = 0; i < candidatePayloads.length; i++) {
      try {
        const result = await requestEvolution(path, {
          method: 'POST',
          body: candidatePayloads[i]
        });
        attempts.push({ path, variant: i + 1, ok: true });
        res.status(200).json({ ok: true, result, attempts });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Falha ao enviar mídia';
        attempts.push({ path, variant: i + 1, ok: false, error: lastError });
      }
    }
  }

  logger.error('sendWhatsappMediaMessage failed', { instanceName, attempts });
  res.status(502).json({ error: lastError, attempts });
});

export const listWhatsappEvolutionChats = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const { instanceName } = req.body as { instanceName?: string };
  const inst = instanceName?.trim();
  if (!inst) {
    res.status(400).json({ error: 'instanceName is required' });
    return;
  }

  try {
    const result = await requestEvolution(`/chat/findChats/${encodeURIComponent(inst)}`, {
      method: 'POST',
      body: {}
    });
    res.status(200).json(result);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao listar conversas.';
    if (messageText.includes('EVOLUTION_API_URL and EVOLUTION_API_KEY must be configured')) {
      res.status(503).json({
        error: 'Evolution API não configurada nas Functions (defina EVOLUTION_API_URL e EVOLUTION_API_KEY em functions/.env e faça deploy).'
      });
      return;
    }
    if (messageText.includes('Evolution API request failed')) {
      res.status(502).json({ error: messageText });
      return;
    }
    logger.error('listWhatsappEvolutionChats failed', error);
    res.status(500).json({ error: messageText });
  }
});

export const listWhatsappEvolutionMessages = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const body = req.body as EvolutionChatMessagesRequest;
  const inst = body.instanceName?.trim();
  let jid = body.remoteJid?.trim();
  const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 200) : 80;
  const page = typeof body.page === 'number' && body.page > 0 ? Math.floor(body.page) : 1;

  if (!inst || !jid) {
    res.status(400).json({ error: 'instanceName and remoteJid are required' });
    return;
  }

  if (!jid.includes('@')) {
    const normalizedDigits = jid.replace(/\D/g, '');
    const isGroupLike = jid.includes('-');
    jid = `${normalizedDigits || jid}@${isGroupLike ? 'g.us' : 's.whatsapp.net'}`;
  }

  const jidCandidates = Array.from(new Set([
    jid,
    normalizeRemoteJid(jid)
  ].filter(Boolean)));

  try {
    let bestResult: unknown = null;
    let bestCount = -1;

    for (const candidate of jidCandidates) {
      const queryBodies = buildEvolutionMessageQueries(candidate, limit, page);
      for (const bodyCandidate of queryBodies) {
        let result: unknown = null;
        try {
          result = await requestEvolution(`/chat/findMessages/${encodeURIComponent(inst)}`, {
            method: 'POST',
            body: bodyCandidate
          });
        } catch (innerError) {
          logger.warn('findMessages attempt failed', { inst, candidate, bodyCandidate, innerError });
          continue;
        }

        const count = getEvolutionMessageCount(result);
        if (count > bestCount) {
          bestCount = count;
          bestResult = result;
        }
        if (count > 1) break;
      }

      if (bestCount > 1) {
        break;
      }
    }

    res.status(200).json(bestResult || { messages: [] });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao carregar mensagens.';
    if (messageText.includes('EVOLUTION_API_URL and EVOLUTION_API_KEY must be configured')) {
      res.status(503).json({
        error: 'Evolution API não configurada nas Functions (defina EVOLUTION_API_URL e EVOLUTION_API_KEY em functions/.env e faça deploy).'
      });
      return;
    }
    if (messageText.includes('Evolution API request failed')) {
      res.status(502).json({ error: messageText });
      return;
    }
    logger.error('listWhatsappEvolutionMessages failed', error);
    res.status(500).json({ error: messageText });
  }
});

export const resolveWhatsappEvolutionMedia = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const payload = req.body as EvolutionResolveMediaRequest;
    const inst = payload.instanceName?.trim();
    const message = payload.message;
    const fallbackMimeType = extractMimeTypeFromMessagePayload(message);

    if (!inst || !message || typeof message !== 'object') {
      res.status(400).json({ error: 'instanceName and message are required' });
      return;
    }

    const mediaId = computeWhatsappMediaId(inst, message);

    // Camada 2: Firestore lookup (compartilhado entre admins/dispositivos).
    if (mediaId) {
      try {
        const cached = await readWhatsappMediaCache(mediaId);
        if (cached?.url) {
          logger.info('whatsappMediaCache hit', {
            mediaId,
            source: 'firestore',
            instanceName: inst,
            mimetype: cached.mimetype
          });
          void incrementWhatsappMediaCacheStats({ hits: 1 });
          res.status(200).json({
            mediaId,
            url: cached.url,
            mimetype: cached.mimetype || fallbackMimeType || 'application/octet-stream',
            fromCache: true,
            cacheLayer: 'firestore'
          });
          return;
        }
      } catch (error) {
        logger.warn('whatsappMediaCache lookup failed', {
          mediaId,
          instanceName: inst,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const candidateRequests: Array<{ path: string; body: Record<string, unknown> }> = [
      { path: `/chat/getBase64FromMediaMessage/${encodeURIComponent(inst)}`, body: { message } },
      { path: `/chat/getBase64FromMediaMessage/${encodeURIComponent(inst)}`, body: message },
      { path: `/chat/getBase64FromMediaMessage/${encodeURIComponent(inst)}`, body: { ...message } }
    ];

    let resolved: { base64: string; mimetype: string } | null = null;
    let lastError = '';
    const attempts: Array<{ path: string; error?: string; resolved: boolean }> = [];

    for (const candidate of candidateRequests) {
      try {
        const result = await requestEvolution(candidate.path, {
          method: 'POST',
          body: candidate.body
        });
        const media = extractBase64Media(result);
        if (media) {
          if (media.mimetype === 'application/octet-stream' && fallbackMimeType) {
            media.mimetype = fallbackMimeType;
          }
          resolved = media;
          attempts.push({ path: candidate.path, resolved: true });
          break;
        }
        attempts.push({
          path: candidate.path,
          error: 'Resposta sem base64 de mídia',
          resolved: false
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'failed';
        attempts.push({
          path: candidate.path,
          error: lastError,
          resolved: false
        });
      }
    }

    if (!resolved) {
      const direct = extractDirectMediaUrlFromMessagePayload(message);
      if (direct?.url) {
        logger.warn('resolveWhatsappEvolutionMedia fallback to direct url', {
          instanceName: inst,
          mediaId,
          attempts
        });
        res.status(200).json({
          mediaId: mediaId || null,
          url: direct.url,
          mimetype: direct.mimetype || fallbackMimeType || 'application/octet-stream',
          fromCache: false,
          cacheLayer: 'origin-url',
          attempts
        });
        return;
      }
      res.status(502).json({
        error: lastError || 'Não foi possível resolver a mídia no provedor Evolution',
        attempts
      });
      return;
    }

    // Camada 1: upload para Storage (compartilhado) com cabeçalho immutable de 1 ano.
    let storageUrl: string | null = null;
    let storageSize = 0;
    if (mediaId) {
      try {
        const uploaded = await uploadWhatsappMediaToStorage({
          mediaId,
          instanceName: inst,
          mimetype: resolved.mimetype,
          base64: resolved.base64
        });
        storageUrl = uploaded.url;
        storageSize = uploaded.sizeBytes;

        await writeWhatsappMediaCache(mediaId, {
          url: uploaded.url,
          mimetype: resolved.mimetype,
          sizeBytes: uploaded.sizeBytes,
          instanceName: inst,
          storagePath: uploaded.storagePath
        });
        logger.info('whatsappMediaCache miss -> stored', {
          mediaId,
          source: 'evolution',
          instanceName: inst,
          mimetype: resolved.mimetype,
          sizeBytes: uploaded.sizeBytes
        });
        void incrementWhatsappMediaCacheStats({ misses: 1, bytesStored: uploaded.sizeBytes });
      } catch (error) {
        logger.warn('whatsappMediaCache upload failed', {
          mediaId,
          instanceName: inst,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Resposta retrocompatível: clientes novos usam `url`; antigos continuam lendo `dataUrl`.
    const dataUrl = `data:${resolved.mimetype};base64,${resolved.base64}`;
    res.status(200).json({
      mediaId: mediaId || null,
      url: storageUrl || dataUrl,
      mimetype: resolved.mimetype,
      fromCache: false,
      cacheLayer: storageUrl ? 'storage' : 'inline',
      sizeBytes: storageSize || null,
      dataUrl
    });
  } catch (error) {
    logger.error('resolveWhatsappEvolutionMedia internal error', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Falha interna ao resolver mídia.'
    });
  }
});

export const getWhatsappInstanceLockStatus = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const instanceName = getRequiredQuery(req, res, 'instanceName');
  if (!instanceName) return;

  const lock = await getWhatsappInstanceLock(instanceName);
  res.status(200).json({
    instanceName,
    locked: lock?.locked === true
  });
});

export const requestWhatsappInstanceAccessCode = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const payload = req.body as WhatsappInstanceAccessCodeRequest;
  const instanceName = payload.instanceName?.trim();
  const intent = payload.intent === 'lock' ? 'lock' : 'unlock';
  if (!instanceName) {
    res.status(400).json({ error: 'instanceName is required' });
    return;
  }

  const destinationNumber = await resolveInstanceOwnNumber(instanceName);
  if (!destinationNumber) {
    res.status(400).json({ error: 'Não foi possível identificar o número da própria instância.' });
    return;
  }

  const code = generateNumericCode(6);
  const expiresAt = Date.now() + (5 * 60 * 1000);
  await saveWhatsappInstanceLock(instanceName, {
    instanceName,
    pendingCode: code,
    pendingCodeExpiresAt: expiresAt,
    lastCodeSentAt: Date.now(),
    failedAttempts: 0,
    updatedBy: user.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  const actionLabel = intent === 'lock' ? 'bloquear' : 'desbloquear';
  await requestEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {
      number: destinationNumber,
      text: `Código de confirmação Compraki (${actionLabel} conversas): ${code}. Válido por 5 minutos.`
    }
  });

  res.status(200).json({
    instanceName,
    expiresAt,
    maskedNumber: maskPhoneNumber(destinationNumber)
  });
});

export const confirmWhatsappInstanceAccessCode = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const payload = req.body as WhatsappInstanceAccessCodeConfirmRequest;
  const instanceName = payload.instanceName?.trim();
  const code = payload.code?.trim();
  const intent = payload.intent === 'lock' ? 'lock' : 'unlock';
  if (!instanceName || !code) {
    res.status(400).json({ error: 'instanceName and code are required' });
    return;
  }

  const lock = await getWhatsappInstanceLock(instanceName);
  if (!lock?.pendingCode || !lock.pendingCodeExpiresAt) {
    res.status(400).json({ error: 'Nenhum código pendente para esta instância.' });
    return;
  }

  if (Date.now() > lock.pendingCodeExpiresAt) {
    await saveWhatsappInstanceLock(instanceName, {
      pendingCode: null,
      pendingCodeExpiresAt: null
    });
    res.status(400).json({ error: 'Código expirado. Solicite um novo código.' });
    return;
  }

  if (lock.pendingCode !== code) {
    const nextFailures = (lock.failedAttempts || 0) + 1;
    await saveWhatsappInstanceLock(instanceName, {
      failedAttempts: nextFailures
    });
    res.status(400).json({ error: 'Código inválido.' });
    return;
  }

  const nextLocked = intent === 'lock';
  await saveWhatsappInstanceLock(instanceName, {
    instanceName,
    locked: nextLocked,
    pendingCode: null,
    pendingCodeExpiresAt: null,
    failedAttempts: 0,
    updatedBy: user.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  res.status(200).json({
    instanceName,
    locked: nextLocked
  });
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

export const createBotJob = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const payload = req.body as CreateBotJobRequest;
  const botType = payload.botType?.trim();
  const botLabel = payload.botLabel?.trim() || 'Bot';
  const script = payload.script?.trim() || '';
  const priority = Number.isFinite(payload.priority) ? Number(payload.priority) : 0;
  const config = payload.payload || {};

  if (!botType) {
    res.status(400).json({ error: 'botType is required' });
    return;
  }

  const queueLimitByType = Number(process.env.BOT_MAX_QUEUE_PER_TYPE || '60');
  const db = getFirestore();
  const queuedByTypeSnap = await db.collection('botJobs')
    .where('botType', '==', botType)
    .where('status', '==', 'queued')
    .get();

  if (queuedByTypeSnap.size >= queueLimitByType) {
    res.status(429).json({ error: `Limite de fila atingido para ${botType} (${queueLimitByType})` });
    return;
  }

  const docRef = db.collection('botJobs').doc();
  const nowIso = new Date().toISOString();

  await docRef.set({
    id: docRef.id,
    botType,
    botLabel,
    script,
    priority,
    payload: config,
    status: 'queued',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    createdBy: user.uid,
    createdByEmail: user.email || null,
    worker: null,
    result: null,
    errorMessage: null
  });

  await db.collection('botJobLogs').add({
    jobId: docRef.id,
    level: 'info',
    message: 'Job criado e enfileirado.',
    at: FieldValue.serverTimestamp(),
    atIso: nowIso,
    actor: user.uid
  });

  res.status(200).json({ jobId: docRef.id, status: 'queued' });
});

export const listBotJobs = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const status = (req.query['status'] as string | undefined)?.trim();
  const limitRaw = Number(req.query['limit'] || 40);
  const limit = Math.min(Math.max(limitRaw, 1), 100);

  let query = getFirestore().collection('botJobs').limit(limit);
  if (status) {
    query = query.where('status', '==', status);
  }

  const snap = await query.get();
  const jobs = snap.docs
    .map(doc => doc.data() as Record<string, unknown>)
    .sort((a, b) => String(b['createdAtIso'] || '').localeCompare(String(a['createdAtIso'] || '')));

  res.status(200).json({ jobs });
});

export const cancelBotJob = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const jobId = getString((req.body as { jobId?: string }).jobId);
  if (!jobId) {
    res.status(400).json({ error: 'jobId is required' });
    return;
  }

  const db = getFirestore();
  const docRef = db.collection('botJobs').doc(jobId);
  const doc = await docRef.get();
  if (!doc.exists) {
    res.status(404).json({ error: 'Job não encontrado' });
    return;
  }

  const nowIso = new Date().toISOString();
  await docRef.set({
    status: 'cancelled',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: nowIso,
    errorMessage: null
  }, { merge: true });

  await db.collection('botJobLogs').add({
    jobId,
    level: 'warn',
    message: `Job cancelado por ${user.email || user.uid}.`,
    at: FieldValue.serverTimestamp(),
    atIso: nowIso,
    actor: user.uid
  });

  res.status(200).json({ ok: true, status: 'cancelled' });
});

export const retryBotJob = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const jobId = getString((req.body as { jobId?: string }).jobId);
  if (!jobId) {
    res.status(400).json({ error: 'jobId is required' });
    return;
  }

  const db = getFirestore();
  const docRef = db.collection('botJobs').doc(jobId);
  const doc = await docRef.get();
  if (!doc.exists) {
    res.status(404).json({ error: 'Job não encontrado' });
    return;
  }

  const nowIso = new Date().toISOString();
  await docRef.set({
    status: 'queued',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: nowIso,
    worker: null,
    errorMessage: null,
    result: null
  }, { merge: true });

  await db.collection('botJobLogs').add({
    jobId,
    level: 'info',
    message: `Job reenfileirado por ${user.email || user.uid}.`,
    at: FieldValue.serverTimestamp(),
    atIso: nowIso,
    actor: user.uid
  });

  res.status(200).json({ ok: true, status: 'queued' });
});

export const claimBotJob = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!requireWorkerToken(req, res)) return;

  const workerId = getString((req.body as { workerId?: string }).workerId) || 'cloud-run-worker';
  const db = getFirestore();
  const queuedSnap = await db.collection('botJobs')
    .where('status', '==', 'queued')
    .limit(40)
    .get();

  if (queuedSnap.empty) {
    res.status(200).json({ job: null });
    return;
  }

  const queuedItems: Array<Record<string, unknown> & { id: string }> = queuedSnap.docs
    .map(doc => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));

  const picked = queuedItems
    .sort((a, b) => {
      const pa = Number(a['priority'] || 0);
      const pb = Number(b['priority'] || 0);
      if (pa !== pb) return pb - pa;
      return String(a['createdAtIso'] || '').localeCompare(String(b['createdAtIso'] || ''));
    })[0];

  const nowIso = new Date().toISOString();
  await db.collection('botJobs').doc(String(picked['id'])).set({
    status: 'running',
    worker: workerId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: nowIso
  }, { merge: true });

  await db.collection('botJobLogs').add({
    jobId: picked['id'],
    level: 'info',
    message: `Job assumido pelo worker ${workerId}.`,
    at: FieldValue.serverTimestamp(),
    atIso: nowIso,
    actor: workerId
  });

  res.status(200).json({ job: picked });
});

export const updateBotJobState = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!requireWorkerToken(req, res)) return;

  const payload = req.body as UpdateBotJobStateRequest;
  const jobId = payload.jobId?.trim();
  const status = payload.status;
  const allowedStatus: BotJobStatus[] = ['running', 'success', 'failed', 'cancelled'];

  if (!jobId || !status || !allowedStatus.includes(status)) {
    res.status(400).json({ error: 'jobId and valid status are required' });
    return;
  }

  const nowIso = new Date().toISOString();
  await getFirestore().collection('botJobs').doc(jobId).set({
    status,
    result: payload.result || null,
    errorMessage: payload.errorMessage || null,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: nowIso
  }, { merge: true });

  await getFirestore().collection('botJobLogs').add({
    jobId,
    level: status === 'failed' ? 'error' : 'info',
    message: `Worker atualizou status para ${status}.`,
    at: FieldValue.serverTimestamp(),
    atIso: nowIso,
    actor: 'worker'
  });

  res.status(200).json({ ok: true });
});

export const appendBotJobLog = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!requireWorkerToken(req, res)) return;

  const payload = req.body as AppendBotJobLogRequest;
  const jobId = payload.jobId?.trim();
  const message = payload.message?.trim();
  const level = payload.level || 'info';

  if (!jobId || !message) {
    res.status(400).json({ error: 'jobId and message are required' });
    return;
  }

  await getFirestore().collection('botJobLogs').add({
    jobId,
    level,
    message,
    at: FieldValue.serverTimestamp(),
    atIso: new Date().toISOString(),
    actor: 'worker'
  });

  res.status(200).json({ ok: true });
});

export const listBotJobLogs = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const jobId = getRequiredQuery(req, res, 'jobId');
  if (!jobId) return;

  const logsSnap = await getFirestore().collection('botJobLogs')
    .where('jobId', '==', jobId)
    .limit(200)
    .get();

  const logs = logsSnap.docs
    .map(doc => doc.data() as Record<string, unknown>)
    .sort((a, b) => String(a['atIso'] || '').localeCompare(String(b['atIso'] || '')));

  res.status(200).json({ logs });
});

export const getBotOpsSummary = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const jobsSnap = await getFirestore().collection('botJobs').limit(300).get();
  const jobs = jobsSnap.docs.map(doc => doc.data() as Record<string, unknown>);

  const summary = {
    queued: jobs.filter(j => j['status'] === 'queued').length,
    running: jobs.filter(j => j['status'] === 'running').length,
    success: jobs.filter(j => j['status'] === 'success').length,
    failed: jobs.filter(j => j['status'] === 'failed').length,
    cancelled: jobs.filter(j => j['status'] === 'cancelled').length,
    total: jobs.length
  };

  res.status(200).json({ summary });
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

function requireWorkerToken(req: Request, res: HttpResponse): boolean {
  const configuredToken = (process.env.BOT_WORKER_TOKEN || '').trim();
  if (!configuredToken) {
    res.status(503).json({ error: 'BOT_WORKER_TOKEN not configured' });
    return false;
  }

  const provided = (req.header('x-bot-worker-token') || '').trim();
  if (!provided || provided !== configuredToken) {
    res.status(401).json({ error: 'Invalid worker token' });
    return false;
  }

  return true;
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

function normalizeRemoteJid(jid: string): string {
  const trimmed = jid.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const normalizedLocal = local.split(':')[0] || local;
  return `${normalizedLocal}@${domain}`;
}

function buildEvolutionMessageQueries(remoteJid: string, limit: number, page: number): Array<Record<string, unknown>> {
  const offset = Math.max(0, (page - 1) * limit);
  return [
    {
      where: { key: { remoteJid } },
      limit,
      page,
      offset
    },
    {
      where: { key: { remoteJid } },
      take: limit,
      page
    },
    {
      where: { remoteJid },
      limit,
      page,
      offset
    },
    {
      where: { remoteJid },
      take: limit,
      page
    },
    {
      remoteJid,
      limit,
      page,
      offset
    }
  ];
}

function getEvolutionMessageCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  const r = result as Record<string, unknown>;
  if (!r || typeof r !== 'object') return 0;
  if (Array.isArray(r['messages'])) return (r['messages'] as unknown[]).length;
  if (Array.isArray(r['data'])) return (r['data'] as unknown[]).length;
  if (Array.isArray(r['records'])) return (r['records'] as unknown[]).length;
  if (r['response'] && typeof r['response'] === 'object') {
    const response = r['response'] as Record<string, unknown>;
    if (Array.isArray(response['messages'])) return (response['messages'] as unknown[]).length;
    if (Array.isArray(response['data'])) return (response['data'] as unknown[]).length;
    if (Array.isArray(response['records'])) return (response['records'] as unknown[]).length;
  }
  return 0;
}

function extractBase64Media(result: unknown): { base64: string; mimetype: string } | null {
  const record = result as Record<string, unknown>;
  if (!record || typeof record !== 'object') return null;

  const directBase64 = getString(record['base64']) || getString(record['data']);
  const directMimetype = getString(record['mimetype']) || 'application/octet-stream';
  if (directBase64 && !directBase64.startsWith('data:')) {
    return { base64: directBase64, mimetype: directMimetype };
  }

  if (directBase64 && directBase64.startsWith('data:')) {
    const match = directBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimetype: match[1], base64: match[2] };
    }
  }

  const dataObj = record['data'] && typeof record['data'] === 'object'
    ? (record['data'] as Record<string, unknown>)
    : null;
  if (dataObj) {
    const base64 = getString(dataObj['base64']) || getString(dataObj['data']);
    const mimetype = getString(dataObj['mimetype']) || directMimetype;
    if (base64) return { base64, mimetype };
  }

  return null;
}

function extractMimeTypeFromMessagePayload(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const rec = message as Record<string, unknown>;

  const direct = getString(rec['mimetype']) || getString(rec['mimeType']);
  if (direct) return direct;

  const msg = rec['message'] && typeof rec['message'] === 'object'
    ? (rec['message'] as Record<string, unknown>)
    : rec;

  const mediaCandidates = [
    msg['audioMessage'],
    msg['pttMessage'],
    msg['videoMessage'],
    msg['imageMessage'],
    msg['documentMessage']
  ];

  for (const candidate of mediaCandidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const media = candidate as Record<string, unknown>;
    const mime = getString(media['mimetype']) || getString(media['mimeType']);
    if (mime) return mime;
  }

  return null;
}

function extractDirectMediaUrlFromMessagePayload(message: unknown): { url: string; mimetype?: string } | null {
  if (!message || typeof message !== 'object') return null;
  const root = message as Record<string, unknown>;
  const msg = root['message'] && typeof root['message'] === 'object'
    ? (root['message'] as Record<string, unknown>)
    : root;

  const mediaCandidates = [
    msg['imageMessage'],
    msg['videoMessage'],
    msg['audioMessage'],
    msg['pttMessage'],
    msg['documentMessage']
  ];

  for (const candidate of mediaCandidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const media = candidate as Record<string, unknown>;
    const url = getString(media['url']) || getString(media['directPath']);
    if (!url) continue;
    const mimetype = getString(media['mimetype']) || getString(media['mimeType']) || undefined;
    return { url, mimetype };
  }

  return null;
}

interface WhatsappMediaCacheRecord {
  url: string;
  mimetype: string;
  sizeBytes: number;
  instanceName: string;
  storagePath: string;
  createdAt?: unknown;
}

function computeWhatsappMediaId(instanceName: string, message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const rec = message as Record<string, unknown>;
  const key = rec['key'] && typeof rec['key'] === 'object'
    ? (rec['key'] as Record<string, unknown>)
    : null;

  const id = getString(key?.['id']) || getString(rec['id']);
  const remoteJid = getString(key?.['remoteJid']) || getString(rec['remoteJid']);
  if (!id) return null;

  const fromMe = key?.['fromMe'] === true || rec['fromMe'] === true ? '1' : '0';
  const seed = `${instanceName.trim().toLowerCase()}|${remoteJid || ''}|${id}|${fromMe}`;
  return createHash('sha1').update(seed).digest('hex');
}

function inferExtensionFromMimetype(mimetype: string): string {
  const mime = mimetype.toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') && mime.includes('audio')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('aac')) return 'aac';
  if (mime.includes('pdf')) return 'pdf';
  return 'bin';
}

async function readWhatsappMediaCache(mediaId: string): Promise<WhatsappMediaCacheRecord | null> {
  const snap = await getFirestore()
    .collection(WHATSAPP_MEDIA_CACHE_COLLECTION)
    .doc(mediaId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as Partial<WhatsappMediaCacheRecord> | undefined;
  if (!data || !data.url) return null;
  return {
    url: String(data.url),
    mimetype: String(data.mimetype || 'application/octet-stream'),
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : 0,
    instanceName: String(data.instanceName || ''),
    storagePath: String(data.storagePath || ''),
    createdAt: data.createdAt
  };
}

async function writeWhatsappMediaCache(
  mediaId: string,
  data: Omit<WhatsappMediaCacheRecord, 'createdAt'>
): Promise<void> {
  await getFirestore()
    .collection(WHATSAPP_MEDIA_CACHE_COLLECTION)
    .doc(mediaId)
    .set({
      ...data,
      createdAt: FieldValue.serverTimestamp()
    }, { merge: true });
}

async function uploadWhatsappMediaToStorage(params: {
  mediaId: string;
  instanceName: string;
  mimetype: string;
  base64: string;
}): Promise<{ url: string; sizeBytes: number; storagePath: string }> {
  const { mediaId, instanceName, mimetype, base64 } = params;
  const buffer = Buffer.from(base64, 'base64');
  const safeInstance = instanceName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const ext = inferExtensionFromMimetype(mimetype);
  const storagePath = `${WHATSAPP_MEDIA_STORAGE_PREFIX}/${safeInstance}/${mediaId}.${ext}`;

  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    contentType: mimetype || 'application/octet-stream',
    resumable: false,
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: mimetype || 'application/octet-stream'
    }
  });

  try {
    await file.makePublic();
  } catch (error) {
    logger.warn('whatsappMediaCache makePublic failed (continuing with uniform-access URL)', {
      storagePath,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const url = `https://storage.googleapis.com/${bucket.name}/${encodeURI(storagePath)}`;
  return { url, sizeBytes: buffer.byteLength, storagePath };
}

async function incrementWhatsappMediaCacheStats(delta: {
  hits?: number;
  misses?: number;
  bytesStored?: number;
}): Promise<void> {
  try {
    const db = getFirestore();
    const ref = db.doc(WHATSAPP_MEDIA_CACHE_STATS_DOC);
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp()
    };
    if (typeof delta.hits === 'number' && delta.hits) {
      update['hits'] = FieldValue.increment(delta.hits);
    }
    if (typeof delta.misses === 'number' && delta.misses) {
      update['misses'] = FieldValue.increment(delta.misses);
    }
    if (typeof delta.bytesStored === 'number' && delta.bytesStored) {
      update['bytesStored'] = FieldValue.increment(delta.bytesStored);
    }
    await ref.set(update, { merge: true });
  } catch (error) {
    logger.warn('whatsappMediaCacheStats increment failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
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

function getWhatsappInstanceLockDocId(instanceName: string): string {
  return encodeURIComponent(instanceName.trim());
}

async function getWhatsappInstanceLock(instanceName: string): Promise<StoredWhatsappInstanceLock | null> {
  const snap = await getFirestore().collection('whatsappInstanceLocks').doc(getWhatsappInstanceLockDocId(instanceName)).get();
  if (!snap.exists) return null;
  return snap.data() as StoredWhatsappInstanceLock;
}

async function saveWhatsappInstanceLock(instanceName: string, data: Partial<StoredWhatsappInstanceLock>): Promise<void> {
  await getFirestore().collection('whatsappInstanceLocks').doc(getWhatsappInstanceLockDocId(instanceName)).set({
    ...data,
    instanceName,
    updatedAt: data.updatedAt || FieldValue.serverTimestamp()
  }, { merge: true });
}

async function resolveInstanceOwnNumber(instanceName: string): Promise<string | null> {
  const result = await requestEvolution('/instance/fetchInstances');
  const list = Array.isArray(result)
    ? result
    : Array.isArray((result as Record<string, unknown>)?.['instances'])
      ? (result as Record<string, unknown>)['instances'] as unknown[]
      : Array.isArray((result as Record<string, unknown>)?.['data'])
        ? (result as Record<string, unknown>)['data'] as unknown[]
        : [];

  const byName = list.find(item => {
    if (!item || typeof item !== 'object') return false;
    const rec = item as Record<string, unknown>;
    const candidateName = getString(rec['name'])
      || getString(rec['instanceName'])
      || getString(rec['instance']);
    return candidateName === instanceName;
  });

  if (!byName || typeof byName !== 'object') return null;
  return extractPhoneFromInstanceRecord(byName as Record<string, unknown>);
}

function extractPhoneFromInstanceRecord(record: Record<string, unknown>): string | null {
  const candidates: unknown[] = [
    record['owner'],
    record['ownerJid'],
    record['number'],
    record['wuid'],
    record['phone'],
    record['profileName'],
    (record['instance'] as Record<string, unknown> | undefined)?.['owner'],
    (record['instance'] as Record<string, unknown> | undefined)?.['ownerJid'],
    (record['instance'] as Record<string, unknown> | undefined)?.['number'],
    (record['instance'] as Record<string, unknown> | undefined)?.['wuid'],
    (record['instance'] as Record<string, unknown> | undefined)?.['phone'],
    (record['instance'] as Record<string, unknown> | undefined)?.['me'],
    (record['instance'] as Record<string, unknown> | undefined)?.['meId'],
    (record['instance'] as Record<string, unknown> | undefined)?.['meJid']
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    if (typeof raw === 'string') {
      const digits = raw.replace(/\D/g, '');
      if (digits.length >= 10) return digits;
      continue;
    }
    if (typeof raw === 'object') {
      const rec = raw as Record<string, unknown>;
      const id = getString(rec['id']) || getString(rec['jid']) || getString(rec['_serialized']) || getString(rec['user']);
      if (id) {
        const digits = id.replace(/\D/g, '');
        if (digits.length >= 10) return digits;
      }
    }
  }

  return null;
}

function generateNumericCode(length: number): string {
  let value = '';
  for (let i = 0; i < length; i++) {
    value += Math.floor(Math.random() * 10).toString();
  }
  return value;
}

function maskPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
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

/**
 * RESET DE SENHA PERSONALIZADO
 */

interface ResetPasswordRequest {
  email?: string;
  method?: 'email' | 'whatsapp';
}

interface CompleteResetRequest {
  email?: string;
  code?: string;
  newPassword?: string;
}

export const requestPasswordResetCode = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const { email, method } = req.body as ResetPasswordRequest;
  if (!email) {
    res.status(400).json({ error: 'Email é obrigatório' });
    return;
  }

  try {
    const auth = getAuth();
    const db = getFirestore();

    // 1. Verificar se o usuário existe
    const userRecord = await auth.getUserByEmail(email).catch(() => null);
    if (!userRecord) {
      // Por segurança, não informamos que o e-mail não existe
      res.status(200).json({ success: true, message: 'Se o e-mail existir, um código foi enviado.' });
      return;
    }

    // 2. Gerar código e salvar no Firestore
    const code = generateNumericCode(6);
    const expiresAt = Date.now() + (15 * 60 * 1000); // 15 minutos

    await db.collection('passwordResets').doc(email.toLowerCase().trim()).set({
      email,
      code,
      expiresAt,
      createdAt: FieldValue.serverTimestamp()
    });

    // 3. Tentar pegar o telefone do usuário no Firestore
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    const userData = userDoc.data();
    const phoneNumber = userData?.['phoneNumber'] || userData?.['phone'] || userData?.['telefone'];

    let whatsappSent = false;
    let emailSent = false;
    let whatsappFailReason = '';

    // --- DISPARO WHATSAPP ---
    if (method === 'whatsapp' || !method) {
      if (phoneNumber) {
        try {
          // O campo `status` guarda o último evento do webhook, não o status de conexão.
          // O status real de conexão está em evolutionData.connectionStatus.
          const instancesSnap = await db.collection('whatsappInstances').get();
          const activeInstance = instancesSnap.docs.find(d => {
            const data = d.data();
            return data['evolutionData']?.['connectionStatus'] === 'open';
          });

          if (activeInstance) {
            // O ID do documento é encodeURIComponent(name), mas precisamos do name real.
            const instanceData = activeInstance.data();
            const instanceName = String(instanceData['name'] || '') || decodeURIComponent(activeInstance.id);
            const digitsOnly = String(phoneNumber).replace(/\D/g, '');
            const normalizedPhone = digitsOnly.startsWith('55') ? digitsOnly : `55${digitsOnly}`;

            await requestEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
              method: 'POST',
              body: {
                number: normalizedPhone,
                text: `Compraki: Seu código de recuperação de senha é *${code}*. Válido por 15 minutos.`
              }
            });
            whatsappSent = true;
            logger.info('Reset code sent via WhatsApp', { email, phoneNumber, instanceName });
          } else {
            whatsappFailReason = 'no_active_instance';
            logger.warn('No active WhatsApp instance found for password reset', { email });
          }
        } catch (err) {
          whatsappFailReason = 'send_error';
          logger.error('Error sending reset code via WhatsApp', err);
        }
      } else {
        whatsappFailReason = 'no_phone';
        logger.warn('User has no phoneNumber registered for WhatsApp password reset', {
          email,
          uid: userRecord.uid,
          userDocFields: Object.keys(userData || {})
        });
      }
    }

    // --- DISPARO E-MAIL ---
    if (method === 'email' || !method) {
      const smtpConfig = {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      };

      if (smtpConfig.auth.user && smtpConfig.auth.pass) {
        try {
          logger.info('Iniciando envio de e-mail...', { to: email });
          const transporter = nodemailer.createTransport(smtpConfig);
          await transporter.sendMail({
            from: `"Compraki" <${smtpConfig.auth.user}>`,
            to: email,
            subject: 'Seu código de recuperação de senha - Compraki',
            text: `Seu código de recuperação é: ${code}`,
            html: `
              <div style="font-family: sans-serif; padding: 20px; color: #182E3C;">
                <h2 style="color: #2ECC71;">Recuperação de Senha</h2>
                <p>Olá,</p>
                <p>Recebemos uma solicitação de redefinição de senha para sua conta na <b>Compraki</b>.</p>
                <p style="font-size: 1.2rem; margin: 20px 0;">Seu código de segurança é: <b style="letter-spacing: 2px; color: #2ECC71; font-size: 1.5rem;">${code}</b></p>
                <p>Este código é válido por 15 minutos.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 0.8rem; color: #999;">Se você não solicitou esta alteração, ignore este e-mail.</p>
              </div>
            `
          });
          emailSent = true;
          logger.info('Reset code sent via Email', { email });
        } catch (err) {
          logger.error('Error sending reset code via Email', {
            message: (err as Error).message,
            code: (err as NodeJS.ErrnoException).code
          });
        }
      }
    }

    if (method === 'whatsapp' && !whatsappSent) {
      const reasonMsg = whatsappFailReason === 'no_phone'
        ? 'Seu número de telefone não está cadastrado na conta. Tente por e-mail.'
        : whatsappFailReason === 'no_active_instance'
          ? 'O serviço de WhatsApp está indisponível no momento. Tente por e-mail.'
          : 'Não foi possível enviar via WhatsApp. Tente por e-mail.';
      res.status(400).json({ error: reasonMsg });
      return;
    }
    if (method === 'email' && !emailSent) {
      res.status(400).json({ error: 'Não foi possível enviar via e-mail no momento. Tente via WhatsApp.' });
      return;
    }

    res.status(200).json({
      success: true,
      whatsapp: whatsappSent,
      email: emailSent,
      // Debug only: remove for production
      code: (!whatsappSent && !emailSent) ? code : undefined
    });

  } catch (error) {
    logger.error('Error in requestPasswordResetCode', error);
    res.status(500).json({ error: 'Erro interno ao processar solicitação.' });
  }
});

export const validateResetCode = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const { email, code } = req.body as { email?: string; code?: string };
  if (!email || !code) {
    res.status(400).json({ error: 'Email e código são obrigatórios' });
    return;
  }

  try {
    const db = getFirestore();
    const resetDoc = await db.collection('passwordResets').doc(email.toLowerCase().trim()).get();

    if (!resetDoc.exists) {
      res.status(400).json({ error: 'Código não encontrado ou expirado.' });
      return;
    }

    const resetData = resetDoc.data();
    const storedCode = String(resetData?.['code'] || '').trim();
    const receivedCode = String(code || '').trim();
    const now = Date.now();
    const expiresAt = resetData?.['expiresAt'] || 0;

    logger.info('Validating reset code', {
      email: email.toLowerCase().trim(),
      now,
      expiresAt,
      isExpired: now > expiresAt,
      isMatch: storedCode === receivedCode
    });

    if (storedCode !== receivedCode || now > expiresAt) {
      res.status(400).json({ error: 'Código inválido ou expirado.' });
      return;
    }

    res.status(200).json({ success: true, message: 'Código válido.' });
  } catch (error) {
    logger.error('Error in validateResetCode', error);
    res.status(500).json({ error: 'Erro ao validar código.' });
  }
});

export const completePasswordReset = onRequest({ region, cors: false }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const { email, code, newPassword } = req.body as CompleteResetRequest;
  if (!email || !code || !newPassword) {
    res.status(400).json({ error: 'Email, código e nova senha são obrigatórios' });
    return;
  }

  try {
    const auth = getAuth();
    const db = getFirestore();

    const resetDoc = await db.collection('passwordResets').doc(email.toLowerCase().trim()).get();
    if (!resetDoc.exists) {
      res.status(400).json({ error: 'Código não encontrado ou expirado.' });
      return;
    }

    const resetData = resetDoc.data();
    const storedCode = String(resetData?.['code'] || '').trim();
    const receivedCode = String(code || '').trim();
    const now = Date.now();
    const expiresAt = resetData?.['expiresAt'] || 0;

    logger.info('Completing password reset', {
      email: email.toLowerCase().trim(),
      now,
      expiresAt,
      isExpired: now > expiresAt,
      isMatch: storedCode === receivedCode
    });

    if (storedCode !== receivedCode || now > expiresAt) {
      res.status(400).json({ error: 'Código inválido ou expirado.' });
      return;
    }

    const userRecord = await auth.getUserByEmail(email);
    await auth.updateUser(userRecord.uid, { password: newPassword });
    await db.collection('passwordResets').doc(email.toLowerCase().trim()).delete();

    logger.info('Password successfully updated for user', { email });
    res.status(200).json({ success: true, message: 'Senha atualizada com sucesso!' });
  } catch (error) {
    logger.error('Error in completePasswordReset', error);
    res.status(500).json({ error: 'Erro ao atualizar a senha.' });
  }
});
