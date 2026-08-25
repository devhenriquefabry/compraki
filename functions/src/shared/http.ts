import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';
import { type Request } from 'firebase-functions/v2/https';

/**
 * Helpers de HTTP, CORS e autorização compartilhados pelas Cloud Functions.
 *
 * NOTA DE DÍVIDA TÉCNICA: `functions/src/index.ts` ainda mantém cópias locais
 * destas funções. A unificação faz parte da Fase 3 (quebrar o index.ts em
 * módulos por domínio) — foi deixada de fora da contenção de segurança porque
 * mexer nas 3.016 linhas do arquivo agora acrescentaria risco sem acrescentar
 * segurança. Ao alterar regra de autorização, alterar NOS DOIS lugares.
 */

export interface HttpResponse {
  set(field: string, value: string): HttpResponse;
  status(code: number): HttpResponse;
  json(body: unknown): void;
  send(body: string): void;
}

export interface AuthenticatedRequest {
  uid: string;
  email?: string;
  isTokenAdmin?: boolean;
}

/** Região única de deploy. */
export const region = 'us-central1';

/**
 * Teto de instâncias simultâneas.
 *
 * Sem isto, uma rajada (proposital ou não) escala sem limite e o custo sobe
 * junto. É a trava de dano financeiro mais barata que existe no Functions v2.
 */
export const defaultRuntime = {
  region,
  // CORS é tratado por `handleCors`, com allowlist de origem. O tratamento
  // embutido do Functions liberaria mais do que queremos.
  cors: false,
  maxInstances: 10,
  timeoutSeconds: 60
} as const;

const defaultCorsHeaders = {
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-evolution-webhook-secret, x-bot-worker-token',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '3600'
};

export function getAllowedCorsOrigin(requestOrigin: string): string {
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

/** Devolve `true` quando a requisição era um preflight e já foi respondida. */
export function handleCors(req: Request, res: HttpResponse): boolean {
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

export function methodNotAllowed(res: HttpResponse): void {
  res.status(405).json({ error: 'Method not allowed' });
}

/** E-mails de bootstrap — só valem para conceder o primeiro claim. */
export function isBootstrapAdminEmail(email?: string): boolean {
  if (!email) return false;

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  return adminEmails.includes(email.toLowerCase());
}

export async function requireAuthenticated(
  req: Request,
  res: HttpResponse
): Promise<AuthenticatedRequest | null> {
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

/**
 * Autoriza admin pelo custom claim `admin`.
 *
 * NÃO consulta `users/{uid}`. Esse documento é gravável pelo próprio dono e
 * por isso nunca vale como autorização — foi exatamente esse caminho que
 * permitia auto-promoção antes da correção. A lista `ADMIN_EMAILS` continua
 * valendo só para o bootstrap do primeiro administrador.
 */
export async function requireAdmin(
  req: Request,
  res: HttpResponse
): Promise<AuthenticatedRequest | null> {
  const user = await requireAuthenticated(req, res);
  if (!user) return null;

  if (user.isTokenAdmin === true || isBootstrapAdminEmail(user.email)) {
    return user;
  }

  logger.warn('Admin access denied', { uid: user.uid, email: user.email });
  res.status(403).json({ error: 'Admin access required' });
  return null;
}
