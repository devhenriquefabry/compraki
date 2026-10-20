import { createHmac, timingSafeEqual } from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

/**
 * Cliente do Melhor Envio usado por mais de um módulo (cotação no checkout,
 * etiqueta da loja, aba do admin e o fechamento do pedido em `orders.ts`).
 * A configuração e os tokens ficam em `settings/melhor_envio`, que o cliente
 * nunca lê (firestore.rules).
 */

export async function getMelhorEnvioConfig() {
  const snap = await getFirestore().doc('settings/melhor_envio').get();
  return snap.exists ? snap.data() as any : null;
}

/**
 * Endereço da API do Melhor Envio. `MELHOR_ENVIO_API_URL` só existe para teste
 * (emulador apontando para um Melhor Envio falso local, via functions/.env.local);
 * em produção vem do `isSandbox` da configuração.
 */
export function melhorEnvioBaseUrl(isSandbox: boolean): string {
  const override = (process.env.MELHOR_ENVIO_API_URL || '').trim().replace(/\/$/, '');
  if (override) return override;
  return isSandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://www.melhorenvio.com.br';
}

/**
 * Confere o `X-ME-Signature` do webhook: HMAC-SHA256 do corpo cru com o secret
 * do aplicativo. A doc mostra base64; hex também é aceito por segurança.
 */
export function melhorEnvioSignatureMatches(rawBody: Buffer | undefined, signature: string | undefined, secret: string): boolean {
  const provided = Buffer.from(String(signature || '').trim());
  if (!rawBody || !provided.length || !secret) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest();
  return [digest.toString('base64'), digest.toString('hex')].some(expected => {
    const e = Buffer.from(expected);
    return e.length === provided.length && timingSafeEqual(e, provided);
  });
}

async function refreshMelhorEnvioToken() {
  const config = await getMelhorEnvioConfig();
  if (!config || !config.refreshToken) throw new Error('Refresh token not found');

  const clientId = process.env.MELHOR_ENVIO_CLIENT_ID;
  const clientSecret = process.env.MELHOR_ENVIO_CLIENT_SECRET;
  const baseUrl = melhorEnvioBaseUrl(config.isSandbox === true);

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

export async function requestMelhorEnvio(path: string, options: { method?: string; body?: any } = {}) {
  let config = await getMelhorEnvioConfig();
  if (!config) throw new Error('Melhor Envio not configured');

  const baseUrl = melhorEnvioBaseUrl(config.isSandbox === true);
  
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
