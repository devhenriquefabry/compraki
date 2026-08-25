import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import * as nodemailer from 'nodemailer';

initializeApp();

// Módulos por domínio. O objetivo da Fase 3 é que TODAS as funções vivam em
// arquivos assim e este index.ts fique só com as reexportações.
export {
  setAdminClaim,
  getMyAdminStatus,
  bootstrapAdminClaims,
  cleanupLegacyAdminFlags
} from './admin-claims';

export { syncSellerProfile, backfillSellerProfiles } from './seller-profile';

export { onProductSaved, onProductUnsaved, recomputeSavedCounts } from './counters';

export { aggregateDailyMetrics, refreshMetricsNow } from './metrics';

export {
  createAsaasCustomer,
  createAsaasPayment,
  getAsaasPayment,
  refundAsaasPayment
} from './payments/asaas';

export { asaasWebhook } from './payments/asaas-webhook';

const WHATSAPP_MEDIA_CACHE_COLLECTION = 'whatsappMediaCache';
const WHATSAPP_MEDIA_CACHE_STATS_DOC = 'whatsappMediaCacheStats/global';
const WHATSAPP_MEDIA_STORAGE_PREFIX = 'whatsapp-media';

const region = 'us-central1';

/**
 * Teto de instâncias por função.
 *
 * Sem isto, uma rajada de requisições escala sem limite e o custo acompanha.
 * É a trava de dano financeiro mais barata do Functions v2 — vale inclusive
 * para os endpoints públicos (webhooks, recuperação de senha).
 */
const MAX_INSTANCES = 10;

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
    message: [
      'Novo cadastro na Compraki',
      'Nome: {{nome}}',
      'Email: {{email}}',
      'Telefone: {{telefone}}',
      'CPF: {{cpf}}',
      'CEP: {{cep}}',
      'Rua/Avenida: {{rua}}',
      'Numero: {{numero}}',
      'Complemento: {{complemento}}',
      'Bairro: {{bairro}}',
      'Cidade: {{cidade}}',
      'UF: {{uf}}',
      'Senha: nao enviada por seguranca',
      'UID: {{uid}}',
      'Perfil: {{perfil}}',
      'Admin: {{admin}}',
      'Vendedor: {{vendedor}}',
      'Criado em: {{criadoEm}}',
      'Origem: {{origem}}'
    ].join('\n')
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

export const createWhatsappInstance = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

  let result: unknown;
  let alreadyExists = false;

  try {
    await clearDeletedWhatsappInstance(instanceName);

    try {
      result = await requestEvolution('/instance/create', {
        method: 'POST',
        body: payload
      });
    } catch (error) {
      const existingState = await getEvolutionInstanceState(instanceName).catch(stateError => {
        logger.warn('Failed to check existing Evolution instance after create error', {
          instanceName,
          error: stateError
        });
        return null;
      });

      if (!existingState) {
        throw error;
      }

      alreadyExists = true;
      result = existingState.raw;
    }

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

    res.status(200).json({
      alreadyExists,
      instanceName,
      evolution: result
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao criar instancia de WhatsApp.';
    const status = getWhatsappServiceErrorStatus(messageText);
    logger.error('createWhatsappInstance failed', { instanceName, status, error });
    res.status(status).json({ error: getWhatsappServiceErrorMessage(messageText) });
  }
});

export const getWhatsappQrCode = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const instanceName = getRequiredQuery(req, res, 'instanceName');
  if (!instanceName) return;

  const result = await requestEvolution(`/instance/connect/${encodeURIComponent(instanceName)}`);
  res.status(200).json(result);
});

export const listWhatsappInstances = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const result = await requestEvolution('/instance/fetchInstances');
    const evolutionInstances = normalizeEvolutionInstances(result);
    const deletedNames = await getDeletedWhatsappInstanceNames();
    const visibleInstances = filterDeletedEvolutionInstances(
      filterConfiguredEvolutionInstances(evolutionInstances),
      deletedNames
    );
    const defaultEvolutionInstances = visibleInstances.length > 0
      ? []
      : await getDefaultEvolutionInstances(deletedNames);
    const instances = visibleInstances.length > 0 ? visibleInstances : defaultEvolutionInstances;
    await syncWhatsappInstancesFromEvolution(instances);

    res.status(200).json({
      instances,
      evolution: result
    });
  } catch (error) {
    const deletedNames = await getDeletedWhatsappInstanceNames();
    const defaultEvolutionInstances = await getDefaultEvolutionInstances(deletedNames);
    if (defaultEvolutionInstances.length > 0) {
      await syncWhatsappInstancesFromEvolution(defaultEvolutionInstances);
      const storedInstances = filterDeletedStoredWhatsappInstances(
        filterConfiguredStoredWhatsappInstances(await getStoredWhatsappInstances()),
        deletedNames
      );
      logger.warn('Evolution fetchInstances failed; returning configured default WhatsApp instances', error);
      res.status(200).json({
        instances: mergeWhatsappInstances(storedInstances, defaultEvolutionInstances),
        source: 'configured-default'
      });
      return;
    }

    const storedInstances = filterDeletedStoredWhatsappInstances(
      filterConfiguredStoredWhatsappInstances(await getStoredWhatsappInstances()),
      deletedNames
    );
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

export const disconnectWhatsappInstance = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const deleteWhatsappInstance = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'DELETE') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  const instanceName = getInstanceName(req, res);
  if (!instanceName) return;

  try {
    await requestEvolution(`/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: 'DELETE'
    }).catch(error => {
      logger.warn('Evolution logout before delete failed; continuing delete', { instanceName, error });
    });

    const result = await requestEvolution(`/instance/delete/${encodeURIComponent(instanceName)}`, {
      method: 'DELETE'
    });

    await markWhatsappInstanceDeleted(instanceName, user);
    await deleteStoredWhatsappInstance(instanceName);

    res.status(200).json(result);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao remover instancia de WhatsApp.';
    const status = getWhatsappServiceErrorStatus(messageText);
    logger.error('deleteWhatsappInstance failed', { instanceName, status, error });
    res.status(status).json({ error: getWhatsappServiceErrorMessage(messageText) });
  }
});

export const sendWhatsappTestMessage = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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
    const normalizedPhoneNumber = normalizeWhatsappPhoneNumber(phoneNumber);
    const result = await requestEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: {
        number: normalizedPhoneNumber,
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
      res.status(502).json({ error: getWhatsappServiceErrorMessage(messageText) });
      return;
    }
    logger.error('sendWhatsappTestMessage unexpected error', error);
    res.status(500).json({ error: messageText });
  }
});

export const sendWhatsappMediaMessage = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const listWhatsappEvolutionChats = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const listWhatsappEvolutionMessages = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const resolveWhatsappEvolutionMedia = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const getWhatsappInstanceLockStatus = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const requestWhatsappInstanceAccessCode = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const confirmWhatsappInstanceAccessCode = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const getWhatsappTriggers = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const triggers = await getWhatsappTriggerConfigs();
    res.status(200).json({ triggers });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao carregar gatilhos de WhatsApp.';
    logger.error('getWhatsappTriggers failed', error);
    res.status(500).json({ error: messageText });
  }
});

export const saveWhatsappTrigger = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

  try {
    await getFirestore().collection('whatsappTriggers').doc(payload.eventType).set(trigger, { merge: true });
    res.status(200).json({ trigger });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao salvar gatilho de WhatsApp.';
    logger.error('saveWhatsappTrigger failed', { eventType: payload.eventType, error });
    res.status(500).json({ error: messageText });
  }
});

export const dispatchWhatsappTrigger = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  const payload = req.body as WhatsappTriggerDispatchRequest;
  if (!payload.eventType || !isWhatsappTriggerEvent(payload.eventType)) {
    res.status(400).json({ error: 'eventType is required' });
    return;
  }

  let trigger: WhatsappTriggerConfig | null = null;
  const logBase = {
    eventType: payload.eventType,
    userId: user.uid,
    userEmail: user.email || null,
    data: payload.data || {},
    createdAt: FieldValue.serverTimestamp()
  };

  try {
    trigger = await getWhatsappTriggerConfig(payload.eventType);

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
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Falha ao disparar gatilho de WhatsApp.';
    const status = getWhatsappServiceErrorStatus(messageText);
    logger.error('dispatchWhatsappTrigger failed', {
      eventType: payload.eventType,
      instanceName: trigger?.instanceName || null,
      status,
      error
    });

    await getFirestore().collection('whatsappTriggerLogs').add({
      ...logBase,
      status: 'failed',
      instanceName: trigger?.instanceName || null,
      phoneNumber: trigger?.phoneNumber || null,
      error: messageText
    }).catch(logError => logger.warn('Failed to write whatsapp trigger error log', logError));

    res.status(status).json({ error: getWhatsappServiceErrorMessage(messageText) });
  }
});

export const createBotJob = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const listBotJobs = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const cancelBotJob = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const retryBotJob = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const claimBotJob = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const updateBotJobState = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const appendBotJobLog = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const listBotJobLogs = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const getBotOpsSummary = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

export const evolutionWebhook = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

  const normalizedStatus = getNormalizedInstanceStatus(payload);
  const instanceUpdate: Partial<StoredWhatsappInstance> = {
    name: instanceName,
    evolutionData: payload,
    updatedAt: FieldValue.serverTimestamp()
  };

  if (normalizedStatus) {
    instanceUpdate.status = normalizedStatus;
  }

  await saveWhatsappInstance(instanceName, instanceUpdate);

  logger.info('Evolution webhook received', { instanceName, eventName });
  res.status(200).json({ ok: true });
});

/**
 * Autoriza admin pelo custom claim `admin` do ID token.
 *
 * NÃO consulta mais `users/{uid}`. Aquele documento é gravável pelo próprio
 * dono, então lê-lo aqui transformava "criar conta" em "virar admin". A lista
 * `ADMIN_EMAILS` continua valendo apenas como bootstrap do primeiro
 * administrador, antes de existir qualquer claim.
 *
 * Para conceder ou revogar acesso, use a função `setAdminClaim`
 * (functions/src/admin-claims.ts).
 */
async function requireAdmin(req: Request, res: HttpResponse): Promise<AuthenticatedRequest | null> {
  const decodedUser = await requireAuthenticated(req, res);
  if (!decodedUser) return null;

  if (decodedUser.isTokenAdmin === true || isAdminEmail(decodedUser.email)) {
    return decodedUser;
  }

  logger.warn('Admin access denied', { uid: decodedUser.uid, email: decodedUser.email });
  res.status(403).json({ error: 'Admin access required' });
  return null;
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
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch (_error) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    logger.error('Evolution API request failed', { path, status: response.status, data });
    const detail = extractEvolutionErrorDetail(data);
    throw new Error(
      `Evolution API request failed with status ${response.status}${detail ? `: ${detail}` : ''}`
    );
  }

  return data;
}

function getWhatsappServiceErrorStatus(messageText: string): number {
  if (messageText.includes('EVOLUTION_API_URL and EVOLUTION_API_KEY must be configured')) return 503;
  if (messageText.includes('Evolution API request failed')) return 502;
  return 500;
}

function getWhatsappServiceErrorMessage(messageText: string): string {
  if (messageText.includes('EVOLUTION_API_URL and EVOLUTION_API_KEY must be configured')) {
    return 'Evolution API não configurada nas Functions (defina EVOLUTION_API_URL e EVOLUTION_API_KEY em functions/.env e faça deploy).';
  }
  return messageText;
}

function extractEvolutionErrorDetail(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  const candidates = [
    record['message'],
    record['error'],
    record['details'],
    record['raw']
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
  }

  return '';
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

async function markWhatsappInstanceDeleted(instanceName: string, user?: AuthenticatedRequest): Promise<void> {
  const db = getFirestore();
  await db.collection('whatsappDeletedInstances').doc(getWhatsappInstanceDocId(instanceName)).set({
    name: instanceName,
    deletedBy: user?.uid || null,
    deletedByEmail: user?.email || null,
    deletedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

async function clearDeletedWhatsappInstance(instanceName: string): Promise<void> {
  const db = getFirestore();
  await db.collection('whatsappDeletedInstances').doc(getWhatsappInstanceDocId(instanceName)).delete();
}

async function getDeletedWhatsappInstanceNames(): Promise<Set<string>> {
  const snapshot = await getFirestore().collection('whatsappDeletedInstances').get();
  return new Set(
    snapshot.docs
      .map(doc => getString(doc.data()['name']) || doc.id)
      .filter(Boolean)
      .map(name => name.toLowerCase())
  );
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

function getEvolutionDefaultInstanceNames(): string[] {
  return (process.env.EVOLUTION_DEFAULT_INSTANCE || process.env.EVOLUTION_DEFAULT_INSTANCES || '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);
}

function filterConfiguredEvolutionInstances(instances: NormalizedEvolutionInstance[]): NormalizedEvolutionInstance[] {
  const configuredNames = getEvolutionDefaultInstanceNames();
  if (configuredNames.length === 0) return instances;

  const allowed = new Set(configuredNames.map(name => name.toLowerCase()));
  return instances.filter(instance => allowed.has(instance.name.toLowerCase()));
}

function filterConfiguredStoredWhatsappInstances(instances: StoredWhatsappInstance[]): StoredWhatsappInstance[] {
  const configuredNames = getEvolutionDefaultInstanceNames();
  if (configuredNames.length === 0) return instances;

  const allowed = new Set(configuredNames.map(name => name.toLowerCase()));
  return instances.filter(instance => allowed.has(instance.name.toLowerCase()));
}

function filterDeletedEvolutionInstances(
  instances: NormalizedEvolutionInstance[],
  deletedNames: Set<string>
): NormalizedEvolutionInstance[] {
  if (deletedNames.size === 0) return instances;
  return instances.filter(instance => !deletedNames.has(instance.name.toLowerCase()));
}

function filterDeletedStoredWhatsappInstances(
  instances: StoredWhatsappInstance[],
  deletedNames: Set<string>
): StoredWhatsappInstance[] {
  if (deletedNames.size === 0) return instances;
  return instances.filter(instance => !deletedNames.has(instance.name.toLowerCase()));
}

async function getDefaultEvolutionInstances(
  deletedNames: Set<string> = new Set()
): Promise<NormalizedEvolutionInstance[]> {
  const instanceNames = getEvolutionDefaultInstanceNames();
  const instances: NormalizedEvolutionInstance[] = [];

  for (const instanceName of instanceNames) {
    if (deletedNames.has(instanceName.toLowerCase())) {
      continue;
    }

    const instance = await getEvolutionInstanceState(instanceName);
    if (instance) {
      instances.push(instance);
    } else {
      logger.warn('Failed to read configured default WhatsApp instance state', {
        instanceName
      });
    }
  }

  return instances;
}

async function getEvolutionInstanceState(instanceName: string): Promise<NormalizedEvolutionInstance | null> {
  try {
    const raw = await requestEvolution(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
    return {
      name: instanceName,
      status: getNormalizedInstanceStatus(raw) || 'desconhecido',
      raw
    };
  } catch {
    return null;
  }
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

/**
 * Código numérico com gerador criptográfico.
 * `Math.random()` é previsível e não serve para credencial de uso único.
 */
function generateNumericCode(length: number): string {
  let value = '';
  for (let i = 0; i < length; i++) {
    value += randomInt(0, 10).toString();
  }
  return value;
}

// ---------------------------------------------------------------------------
// Recuperação de senha — parâmetros de segurança
// ---------------------------------------------------------------------------

/** 8 dígitos: 100x mais espaço de busca que os 6 anteriores. */
const RESET_CODE_LENGTH = 8;
const RESET_CODE_TTL_MS = 15 * 60 * 1000;
/** Tentativas erradas antes de invalidar o código. */
const RESET_MAX_ATTEMPTS = 5;
/** Intervalo mínimo entre dois envios para o mesmo e-mail. */
const RESET_RESEND_COOLDOWN_MS = 60 * 1000;
/** Envios por e-mail dentro da janela. */
const RESET_MAX_SENDS_PER_WINDOW = 5;
const RESET_SEND_WINDOW_MS = 60 * 60 * 1000;

interface StoredPasswordReset {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts?: number;
  sendCount?: number;
  windowStartedAt?: number;
  lastSentAt?: number;
}

function normalizeResetEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Guarda apenas o hash do código. Vazamento do documento (backup, export,
 * acesso indevido ao console) deixa de entregar o código em claro.
 */
function hashResetCode(email: string, code: string): string {
  return createHash('sha256')
    .update(`${normalizeResetEmail(email)}:${code.trim()}`)
    .digest('hex');
}

/** Comparação em tempo constante — não vaza o prefixo correto pelo tempo. */
function resetCodeMatches(stored: string | undefined, email: string, provided: string): boolean {
  if (!stored) return false;

  const expected = Buffer.from(stored, 'utf8');
  const actual = Buffer.from(hashResetCode(email, provided), 'utf8');
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}

type ResetCheck =
  | { ok: true; data: StoredPasswordReset }
  | { ok: false; status: number; error: string };

/**
 * Valida o código e contabiliza a tentativa.
 *
 * Cada erro incrementa `attempts`; ao chegar em RESET_MAX_ATTEMPTS o documento
 * é apagado e o código morre. Sem isso, 15 minutos de tentativas paralelas
 * varrem o espaço inteiro e trocam a senha de qualquer conta.
 */
async function checkResetCode(email: string, code: string): Promise<ResetCheck> {
  const db = getFirestore();
  const normalized = normalizeResetEmail(email);
  const ref = db.collection('passwordResets').doc(normalized);
  const snap = await ref.get();

  if (!snap.exists) {
    return { ok: false, status: 400, error: 'Código não encontrado ou expirado.' };
  }

  const data = snap.data() as StoredPasswordReset;
  const attempts = data.attempts ?? 0;

  if (attempts >= RESET_MAX_ATTEMPTS) {
    await ref.delete().catch(() => undefined);
    return {
      ok: false,
      status: 429,
      error: 'Número de tentativas excedido. Solicite um novo código.'
    };
  }

  if (Date.now() > (data.expiresAt || 0)) {
    await ref.delete().catch(() => undefined);
    return { ok: false, status: 400, error: 'Código expirado. Solicite um novo.' };
  }

  if (!resetCodeMatches(data.codeHash, normalized, code)) {
    const remaining = RESET_MAX_ATTEMPTS - (attempts + 1);
    await ref.update({ attempts: FieldValue.increment(1) }).catch(() => undefined);

    // Log sem o código: registrar tentativa falha, nunca o valor tentado.
    logger.warn('Tentativa de código de reset inválida', { email: normalized, attempts: attempts + 1 });

    return {
      ok: false,
      status: 400,
      error: remaining > 0
        ? `Código inválido. Restam ${remaining} tentativa(s).`
        : 'Código inválido. Solicite um novo código.'
    };
  }

  return { ok: true, data };
}

type ResetRateLimit = { allowed: true; sendCount: number; windowStartedAt: number }
  | { allowed: false; error: string };

/**
 * Limita envios por e-mail: um a cada minuto, no máximo 5 por hora.
 *
 * NOTA: o limite é por e-mail, guardado no próprio documento de reset. Um
 * limite por IP exige armazenamento à parte e entra na Fase 1, junto com o
 * App Check.
 */
async function checkResetRateLimit(email: string): Promise<ResetRateLimit> {
  const normalized = normalizeResetEmail(email);
  const snap = await getFirestore().collection('passwordResets').doc(normalized).get();

  const now = Date.now();
  if (!snap.exists) {
    return { allowed: true, sendCount: 0, windowStartedAt: now };
  }

  const data = snap.data() as StoredPasswordReset;

  if (data.lastSentAt && now - data.lastSentAt < RESET_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESET_RESEND_COOLDOWN_MS - (now - data.lastSentAt)) / 1000);
    return { allowed: false, error: `Aguarde ${wait} segundos para pedir outro código.` };
  }

  const windowStartedAt = data.windowStartedAt ?? now;
  const windowExpired = now - windowStartedAt > RESET_SEND_WINDOW_MS;

  if (windowExpired) {
    return { allowed: true, sendCount: 0, windowStartedAt: now };
  }

  const sendCount = data.sendCount ?? 0;
  if (sendCount >= RESET_MAX_SENDS_PER_WINDOW) {
    return {
      allowed: false,
      error: 'Muitas solicitações para este e-mail. Tente novamente em uma hora.'
    };
  }

  return { allowed: true, sendCount, windowStartedAt };
}

function maskPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function normalizeWhatsappPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

async function getWhatsappTriggerConfigs(): Promise<WhatsappTriggerConfig[]> {
  const snapshot = await getFirestore().collection('whatsappTriggers').get();
  const savedByEvent = new Map<string, Partial<WhatsappTriggerConfig>>();

  snapshot.docs.forEach(doc => {
    savedByEvent.set(doc.id, doc.data() as Partial<WhatsappTriggerConfig>);
  });

  return whatsappTriggerDefaults.map(defaultConfig => {
    const envDefaults = getWhatsappTriggerEnvDefaults(defaultConfig.eventType);
    const saved = savedByEvent.get(defaultConfig.eventType) || {};
    const useSavedDestination = shouldUseSavedWhatsappTriggerDestination(defaultConfig.eventType, saved, envDefaults);
    const forceSignupEnvDefaults = shouldForceSignupWhatsappEnvDefaults(defaultConfig.eventType, envDefaults);

    return {
      eventType: defaultConfig.eventType,
      label: defaultConfig.label,
      ...saved,
      enabled: forceSignupEnvDefaults ? true : getWhatsappTriggerEnabled(defaultConfig.eventType, saved, envDefaults, useSavedDestination),
      instanceName: forceSignupEnvDefaults ? envDefaults.instanceName : useSavedDestination ? saved.instanceName || '' : envDefaults.instanceName,
      phoneNumber: forceSignupEnvDefaults ? envDefaults.phoneNumber : useSavedDestination ? saved.phoneNumber || '' : envDefaults.phoneNumber,
      message: forceSignupEnvDefaults ? defaultConfig.message : saved.message || defaultConfig.message
    };
  });
}

async function getWhatsappTriggerConfig(eventType: WhatsappTriggerEvent): Promise<WhatsappTriggerConfig> {
  const snapshot = await getFirestore().collection('whatsappTriggers').doc(eventType).get();
  const defaults = getWhatsappTriggerDefault(eventType);
  const envDefaults = getWhatsappTriggerEnvDefaults(eventType);
  const saved = snapshot.exists ? snapshot.data() as Partial<WhatsappTriggerConfig> : {};
  const useSavedDestination = shouldUseSavedWhatsappTriggerDestination(eventType, saved, envDefaults);
  const forceSignupEnvDefaults = shouldForceSignupWhatsappEnvDefaults(eventType, envDefaults);

  return {
    eventType,
    label: defaults.label,
    ...saved,
    enabled: forceSignupEnvDefaults ? true : getWhatsappTriggerEnabled(eventType, saved, envDefaults, useSavedDestination),
    instanceName: forceSignupEnvDefaults ? envDefaults.instanceName : useSavedDestination ? saved.instanceName || '' : envDefaults.instanceName,
    phoneNumber: forceSignupEnvDefaults ? envDefaults.phoneNumber : useSavedDestination ? saved.phoneNumber || '' : envDefaults.phoneNumber,
    message: forceSignupEnvDefaults ? defaults.message : saved.message || defaults.message
  };
}

function shouldForceSignupWhatsappEnvDefaults(
  eventType: WhatsappTriggerEvent,
  envDefaults: Pick<WhatsappTriggerConfig, 'enabled' | 'instanceName' | 'phoneNumber'>
): boolean {
  return eventType === 'account_created' && envDefaults.enabled;
}

function getWhatsappTriggerEnabled(
  eventType: WhatsappTriggerEvent,
  saved: Partial<WhatsappTriggerConfig>,
  envDefaults: Pick<WhatsappTriggerConfig, 'enabled' | 'instanceName' | 'phoneNumber'>,
  useSavedDestination: boolean
): boolean {
  if (eventType === 'account_created' && envDefaults.enabled) {
    return true;
  }

  return useSavedDestination && typeof saved.enabled === 'boolean' ? saved.enabled : envDefaults.enabled;
}

function shouldUseSavedWhatsappTriggerDestination(
  eventType: WhatsappTriggerEvent,
  saved: Partial<WhatsappTriggerConfig>,
  envDefaults: Pick<WhatsappTriggerConfig, 'enabled' | 'instanceName' | 'phoneNumber'>
): boolean {
  if (!saved.instanceName || !saved.phoneNumber) return false;
  if (eventType !== 'account_created') return true;
  if (!envDefaults.instanceName) return true;
  return saved.instanceName.toLowerCase() === envDefaults.instanceName.toLowerCase();
}

function getWhatsappTriggerEnvDefaults(eventType: WhatsappTriggerEvent): Pick<WhatsappTriggerConfig, 'enabled' | 'instanceName' | 'phoneNumber'> {
  if (eventType !== 'account_created') {
    return { enabled: false, instanceName: '', phoneNumber: '' };
  }

  const instanceName = getEvolutionDefaultInstanceNames()[0] || '';
  const phoneNumber = (process.env.WHATSAPP_SIGNUP_NOTIFY_PHONE || process.env.WHATSAPP_ADMIN_PHONE || '').trim();

  return {
    enabled: Boolean(instanceName && phoneNumber),
    instanceName,
    phoneNumber
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

/**
 * MELHOR ENVIO INTEGRATION
 */

async function getMelhorEnvioConfig() {
  const snap = await getFirestore().doc('settings/melhor_envio').get();
  return snap.exists ? snap.data() as any : null;
}

async function refreshMelhorEnvioToken() {
  const config = await getMelhorEnvioConfig();
  if (!config || !config.refreshToken) throw new Error('Refresh token not found');

  const clientId = process.env.MELHOR_ENVIO_CLIENT_ID;
  const clientSecret = process.env.MELHOR_ENVIO_CLIENT_SECRET;
  const baseUrl = config.isSandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://www.melhorenvio.com.br';

  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: config.refreshToken
    })
  });

  const data = await response.json();
  if (!response.ok) {
    logger.error('Failed to refresh Melhor Envio token', data);
    throw new Error('Failed to refresh token');
  }

  await getFirestore().doc('settings/melhor_envio').set({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return data.access_token;
}

async function requestMelhorEnvio(path: string, options: { method?: string; body?: any } = {}) {
  let config = await getMelhorEnvioConfig();
  if (!config) throw new Error('Melhor Envio not configured');

  const baseUrl = config.isSandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://www.melhorenvio.com.br';
  
  let response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 401) {
    // Tenta dar refresh no token se der erro de autorização
    logger.info('Melhor Envio token expired, refreshing...');
    const newToken = await refreshMelhorEnvioToken();
    response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  }

  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    logger.warn('Melhor Envio response is not JSON', { text });
    data = { message: text };
  }

  if (!response.ok) {
    logger.error('Melhor Envio API request failed', { path, status: response.status, data });
    let errorMessage = data.message || data.error || `Erro na API Melhor Envio (Status ${response.status})`;
    
    // Se houver detalhes de validação (errors), adiciona à mensagem
    if (data.errors) {
      const details = Object.entries(data.errors)
        .map(([field, msgs]: [string, any]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
        .join('; ');
      errorMessage += ` (${details})`;
    } else if (typeof data === 'object' && Object.keys(data).length > 0 && !data.message) {
      // Se não tem message mas tem outros campos, loga tudo como string
      errorMessage += ` (Detalhes: ${JSON.stringify(data)})`;
    }
    
    throw new Error(errorMessage);
  }

  return data;
}

export const meAuthorizer = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  const code = req.query['code'] as string;
  if (!code) {
    res.status(400).send('Code is missing');
    return;
  }

  try {
    const db = getFirestore();
    const config = await getMelhorEnvioConfig();
    const isSandbox = config?.isSandbox ?? true;
    const baseUrl = isSandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://www.melhorenvio.com.br';
    
    const clientId = process.env.MELHOR_ENVIO_CLIENT_ID;
    const clientSecret = process.env.MELHOR_ENVIO_CLIENT_SECRET;
    const redirectUrl = process.env.MELHOR_ENVIO_REDIRECT_URL;

    const response = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUrl,
        code: code
      })
    });

    const data = await response.json();
    if (!response.ok) {
      logger.error('Melhor Envio token exchange failed', data);
      res.status(500).send('Failed to exchange code for token');
      return;
    }

    await db.doc('settings/melhor_envio').set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Redireciona de volta para o app
    res.redirect('https://compraki-mcu.web.app/tabs/tab2');
  } catch (error) {
    logger.error('Melhor Envio Auth Callback Error', error);
    res.status(500).send('Internal Server Error');
  }
});

export const calculateMelhorEnvioShipping = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  // Cada chamada consome cota da conta Melhor Envio. Sem autenticação, é uma
  // torneira aberta que qualquer um pode girar.
  const user = await requireAuthenticated(req, res);
  if (!user) return;

  try {
    const { zipTo, products } = req.body;
    if (!zipTo || !products || products.length === 0) {
      res.status(400).json({ error: 'CEP de destino ou produtos não informados.' });
      return;
    }

    const config = await getMelhorEnvioConfig();
    if (!config || !config.address || !config.address.zipCode) {
      logger.error('Melhor Envio configuration is incomplete', { config });
      res.status(503).json({ error: 'Configuração do Melhor Envio incompleta (CEP de origem não encontrado).' });
      return;
    }

    // Sanitiza produtos garantindo dimensões mínimas aceitas pelo Melhor Envio
    const sanitizedProducts = products.map((p: any) => ({
      id: String(p.id || 'prod').substring(0, 50),
      width: Math.max(Number(p.width) || 0, 11),
      height: Math.max(Number(p.height) || 0, 2),
      length: Math.max(Number(p.length) || 0, 16),
      weight: Math.max(Number(p.weight) || 0, 0.1),
      insurance_value: Number(p.insurance_value || p.price || 10),
      quantity: Number(p.quantity) || 1
    }));

    const payload = {
      from: { postal_code: String(config.address.zipCode).replace(/\D/g, '') },
      to: { postal_code: String(zipTo).replace(/\D/g, '') },
      products: sanitizedProducts
    };

    logger.info('Calculating shipping with payload:', payload);

    const data = await requestMelhorEnvio('/api/v2/me/shipment/calculate', {
      method: 'POST',
      body: payload
    });

    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const createMelhorEnvioShipment = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  try {
    const payload = req.body;
    const data = await requestMelhorEnvio('/api/v2/me/cart', {
      method: 'POST',
      body: payload
    });

    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const checkoutMelhorEnvioShipment = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  try {
    const { shipmentIds } = req.body;
    const data = await requestMelhorEnvio('/api/v2/me/shipment/checkout', {
      method: 'POST',
      body: { orders: shipmentIds }
    });

    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const generateMelhorEnvioLabel = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const { shipmentIds } = req.body;
    const data = await requestMelhorEnvio('/api/v2/me/shipment/generate', {
      method: 'POST',
      body: { orders: shipmentIds }
    });

    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const printMelhorEnvioLabel = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const { shipmentIds } = req.body;
    const data = await requestMelhorEnvio('/api/v2/me/shipment/print', {
      method: 'POST',
      body: { orders: shipmentIds }
    });

    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const trackMelhorEnvioShipment = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  // Rastreio expõe dado de entrega (endereço, destinatário, status). Não pode
  // ficar consultável por qualquer um que adivinhe um código.
  const user = await requireAuthenticated(req, res);
  if (!user) return;

  try {
    const { shipmentIds } = req.body;
    const data = await requestMelhorEnvio('/api/v2/me/shipment/tracking', {
      method: 'POST',
      body: { orders: shipmentIds }
    });

    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const melhorEnvioWebhook = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  // Webhooks do Melhor Envio normalmente são POST
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // Este handler escreve direto em `orders`. Sem verificar a origem, qualquer
  // um marca pedido como entregue. Mesmo padrão já usado no evolutionWebhook.
  const expectedSecret = (process.env.MELHOR_ENVIO_WEBHOOK_SECRET || '').trim();
  if (!expectedSecret) {
    logger.error('MELHOR_ENVIO_WEBHOOK_SECRET não configurado — webhook recusado');
    res.status(503).json({ error: 'Webhook not configured' });
    return;
  }

  const providedSecret = (
    req.header('x-melhor-envio-webhook-secret') ||
    req.header('x-webhook-secret') ||
    ''
  ).trim();

  if (providedSecret !== expectedSecret) {
    logger.warn('Melhor Envio webhook com segredo inválido', { ip: req.ip });
    res.status(401).json({ error: 'Invalid webhook secret' });
    return;
  }

  const payload = req.body;
  // Payload pode conter dados do destinatário — registrar só o identificador.
  logger.info('Melhor Envio Webhook received', {
    shipmentId: payload?.id || payload?.shipment_id,
    status: payload?.status
  });

  try {
    const db = getFirestore();
    
    // Se o payload contiver o ID do envio e o novo status
    const shipmentId = payload.id || payload.shipment_id;
    const status = payload.status;

    if (shipmentId) {
      // Procura o pedido que tem esse shipmentId (salvo normalmente em shippingInfo ou meta)
      const ordersSnap = await db.collection('orders')
        .where('shippingInfo.shipmentId', '==', shipmentId)
        .limit(1)
        .get();

      if (!ordersSnap.empty) {
        const orderDoc = ordersSnap.docs[0];
        await orderDoc.ref.update({
          'shippingInfo.status': status,
          'shippingInfo.updatedAt': FieldValue.serverTimestamp(),
          'shippingInfo.lastWebhookPayload': payload
        });
        logger.info(`Order ${orderDoc.id} updated via Melhor Envio Webhook`);
      }
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Error processing Melhor Envio Webhook', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export const getMelhorEnvioMe = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const data = await requestMelhorEnvio('/api/v2/me');
    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const listMelhorEnvioShipments = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const data = await requestMelhorEnvio('/api/v2/me/shipment/list');
    res.status(200).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

interface ResetPasswordRequest {
  email?: string;
  method?: 'email' | 'whatsapp';
}

interface CompleteResetRequest {
  email?: string;
  code?: string;
  newPassword?: string;
}

export const requestPasswordResetCode = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
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

    // 1.5. Rate limit por e-mail (1/min, 5/hora)
    const rateLimit = await checkResetRateLimit(email);
    if (!rateLimit.allowed) {
      res.status(429).json({ error: rateLimit.error });
      return;
    }

    // 2. Gerar código e salvar SOMENTE o hash
    const code = generateNumericCode(RESET_CODE_LENGTH);
    const expiresAt = Date.now() + RESET_CODE_TTL_MS;

    await db.collection('passwordResets').doc(normalizeResetEmail(email)).set({
      email: normalizeResetEmail(email),
      codeHash: hashResetCode(email, code),
      expiresAt,
      attempts: 0,
      sendCount: rateLimit.sendCount + 1,
      windowStartedAt: rateLimit.windowStartedAt,
      lastSentAt: Date.now(),
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

    // O código NUNCA volta na resposta HTTP. Devolvê-lo quando o envio falha
    // (como acontecia aqui) permite tomar qualquer conta: basta pedir o reset
    // e ler o corpo da resposta.
    if (!whatsappSent && !emailSent) {
      logger.error('Nenhum canal disponível para enviar o código de reset', { email });
      res.status(503).json({
        error: 'Não foi possível enviar o código agora. Tente novamente em alguns minutos.'
      });
      return;
    }

    res.status(200).json({
      success: true,
      whatsapp: whatsappSent,
      email: emailSent
    });

  } catch (error) {
    logger.error('Error in requestPasswordResetCode', error);
    res.status(500).json({ error: 'Erro interno ao processar solicitação.' });
  }
});

export const validateResetCode = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const { email, code } = req.body as { email?: string; code?: string };
  if (!email || !code) {
    res.status(400).json({ error: 'Email e código são obrigatórios' });
    return;
  }

  try {
    const check = await checkResetCode(email, code);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }

    res.status(200).json({ success: true, message: 'Código válido.' });
  } catch (error) {
    logger.error('Error in validateResetCode', error);
    res.status(500).json({ error: 'Erro ao validar código.' });
  }
});

export const completePasswordReset = onRequest({ region, cors: false, maxInstances: MAX_INSTANCES }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const { email, code, newPassword } = req.body as CompleteResetRequest;
  if (!email || !code || !newPassword) {
    res.status(400).json({ error: 'Email, código e nova senha são obrigatórios' });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' });
    return;
  }

  try {
    const auth = getAuth();
    const db = getFirestore();

    const check = await checkResetCode(email, code);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }

    const userRecord = await auth.getUserByEmail(email);
    await auth.updateUser(userRecord.uid, { password: newPassword });

    // Código de uso único: some assim que serve.
    await db.collection('passwordResets').doc(normalizeResetEmail(email)).delete();

    // Encerra as sessões abertas. Se um invasor estava dentro da conta, a
    // troca de senha sozinha não o expulsaria.
    await auth.revokeRefreshTokens(userRecord.uid);

    logger.info('Password successfully updated for user', { uid: userRecord.uid });
    res.status(200).json({ success: true, message: 'Senha atualizada com sucesso!' });
  } catch (error) {
    logger.error('Error in completePasswordReset', error);
    res.status(500).json({ error: 'Erro ao atualizar a senha.' });
  }
});
