import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';

import {
  defaultRuntime,
  handleCors,
  isBootstrapAdminEmail,
  methodNotAllowed,
  requireAdmin,
  requireAuthenticated
} from './shared/http';

/**
 * Gestão de privilégio administrativo.
 *
 * Regra única: admin é o custom claim `admin` no ID token. Os campos
 * `isAdmin` / `super_admin` / `role` em `users/{uid}` passam a ser apenas
 * ESPELHO PARA EXIBIÇÃO no painel — nenhuma decisão de autorização os
 * consulta, e as regras do Firestore impedem que o próprio usuário os altere.
 */

const PRIVILEGED_FIELDS = ['isAdmin', 'super_admin', 'role', 'admin'] as const;

interface SetAdminClaimRequest {
  uid?: string;
  email?: string;
  admin?: boolean;
}

/**
 * Concede ou revoga o claim `admin`.
 *
 * Autorização: quem chama já precisa ser admin. Para o PRIMEIRO admin (quando
 * ninguém tem o claim ainda), vale a lista `ADMIN_EMAILS` do .env — é o
 * caminho de bootstrap, e deve ser esvaziado depois que os admins reais
 * estiverem com o claim.
 */
export const setAdminClaim = onRequest(defaultRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const { uid, email, admin } = (req.body || {}) as SetAdminClaimRequest;

  if (typeof admin !== 'boolean') {
    res.status(400).json({ error: 'Campo `admin` (boolean) é obrigatório.' });
    return;
  }

  if (!uid && !email) {
    res.status(400).json({ error: 'Informe `uid` ou `email` do alvo.' });
    return;
  }

  try {
    const auth = getAuth();
    const target = uid
      ? await auth.getUser(uid)
      : await auth.getUserByEmail(String(email));

    // Trava contra o admin remover a si mesmo e deixar o painel sem ninguém.
    if (target.uid === caller.uid && admin === false) {
      res.status(400).json({
        error: 'Você não pode remover o próprio acesso administrativo. Peça a outro admin.'
      });
      return;
    }

    const existingClaims = target.customClaims || {};
    await auth.setCustomUserClaims(target.uid, { ...existingClaims, admin });

    // Invalida os refresh tokens: sem isso, uma revogação só valeria quando o
    // ID token atual expirasse (até 1 hora depois).
    await auth.revokeRefreshTokens(target.uid);

    // Espelho para exibição no painel. Não é fonte de autorização.
    await getFirestore().doc(`users/${target.uid}`).set(
      {
        isAdmin: admin,
        adminUpdatedAt: FieldValue.serverTimestamp(),
        adminUpdatedBy: caller.uid
      },
      { merge: true }
    );

    logger.info('Admin claim atualizado', {
      target: target.uid,
      admin,
      by: caller.uid
    });

    res.status(200).json({
      success: true,
      uid: target.uid,
      email: target.email,
      admin,
      message: admin
        ? 'Acesso administrativo concedido. O usuário precisa recarregar o app.'
        : 'Acesso administrativo revogado. As sessões ativas foram encerradas.'
    });
  } catch (error) {
    logger.error('Falha ao definir admin claim', error);
    res.status(500).json({ error: 'Não foi possível atualizar o privilégio.' });
  }
});

/**
 * Devolve o estado de privilégio de quem está chamando.
 * O app usa para decidir se mostra o menu de administração.
 */
export const getMyAdminStatus = onRequest(defaultRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res);

  const user = await requireAuthenticated(req, res);
  if (!user) return;

  res.status(200).json({
    uid: user.uid,
    admin: user.isTokenAdmin === true,
    bootstrapEligible: isBootstrapAdminEmail(user.email)
  });
});

/**
 * BOOTSTRAP — executar UMA vez, logo após o deploy.
 *
 * Concede o claim `admin` a todos os e-mails de `ADMIN_EMAILS`. Sem isto
 * ninguém tem o claim e o painel fica inacessível.
 *
 * Protegido por `ADMIN_BOOTSTRAP_TOKEN` (header `x-bootstrap-token`), porque
 * neste momento ainda não existe admin para autorizar a chamada. Apague a
 * variável do .env e refaça o deploy assim que terminar.
 */
export const bootstrapAdminClaims = onRequest(defaultRuntime, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const configured = (process.env.ADMIN_BOOTSTRAP_TOKEN || '').trim();
  if (!configured) {
    res.status(503).json({
      error: 'ADMIN_BOOTSTRAP_TOKEN não configurado. Esta função está desativada.'
    });
    return;
  }

  const provided = (req.header('x-bootstrap-token') || '').trim();
  if (provided !== configured) {
    logger.warn('Tentativa de bootstrap com token inválido');
    res.status(401).json({ error: 'Token de bootstrap inválido.' });
    return;
  }

  const emails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  if (emails.length === 0) {
    res.status(400).json({ error: 'ADMIN_EMAILS está vazio.' });
    return;
  }

  const auth = getAuth();
  const db = getFirestore();
  const granted: string[] = [];
  const failed: Array<{ email: string; reason: string }> = [];

  for (const email of emails) {
    try {
      const user = await auth.getUserByEmail(email);
      await auth.setCustomUserClaims(user.uid, {
        ...(user.customClaims || {}),
        admin: true
      });
      await auth.revokeRefreshTokens(user.uid);
      await db.doc(`users/${user.uid}`).set(
        { isAdmin: true, adminUpdatedAt: FieldValue.serverTimestamp(), adminUpdatedBy: 'bootstrap' },
        { merge: true }
      );
      granted.push(email);
    } catch (error) {
      failed.push({ email, reason: error instanceof Error ? error.message : 'erro desconhecido' });
    }
  }

  logger.info('Bootstrap de admin concluído', { granted, failed });
  res.status(200).json({
    success: true,
    granted,
    failed,
    next: 'Remova ADMIN_BOOTSTRAP_TOKEN do .env e refaça o deploy.'
  });
});

/**
 * LIMPEZA — executar UMA vez, depois do bootstrap.
 *
 * Remove `isAdmin` / `super_admin` / `role` de todos os documentos de usuário
 * que NÃO têm o claim `admin`. Enquanto o app gravava `isAdmin: true` em todo
 * login, a base inteira ficou marcada; estes campos não autorizam mais nada,
 * mas continuam poluindo o painel e confundindo quem lê o dado.
 *
 * Roda em modo simulação por padrão. Passe `{"apply": true}` para gravar.
 */
export const cleanupLegacyAdminFlags = onRequest(
  { ...defaultRuntime, timeoutSeconds: 540 },
  async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res);

    const caller = await requireAdmin(req, res);
    if (!caller) return;

    const apply = (req.body || {}).apply === true;
    const auth = getAuth();
    const db = getFirestore();

    let scanned = 0;
    let wouldClear = 0;
    let cleared = 0;
    const keptAsAdmin: string[] = [];

    try {
      const snapshot = await db.collection('users').get();
      let batch = db.batch();
      let batchCount = 0;

      for (const docSnap of snapshot.docs) {
        scanned += 1;
        const data = docSnap.data();

        const hasLegacyFlag = PRIVILEGED_FIELDS.some(field => data[field] !== undefined && data[field] !== false);
        if (!hasLegacyFlag) continue;

        // Preserva quem realmente tem o claim.
        let isRealAdmin = false;
        try {
          const record = await auth.getUser(docSnap.id);
          isRealAdmin = record.customClaims?.['admin'] === true;
        } catch {
          isRealAdmin = false; // conta de Auth já não existe
        }

        if (isRealAdmin) {
          keptAsAdmin.push(docSnap.id);
          continue;
        }

        wouldClear += 1;
        if (!apply) continue;

        const patch: Record<string, unknown> = {};
        for (const field of PRIVILEGED_FIELDS) {
          if (data[field] !== undefined) patch[field] = FieldValue.delete();
        }

        batch.update(docSnap.ref, patch);
        batchCount += 1;
        cleared += 1;

        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (apply && batchCount > 0) await batch.commit();

      logger.info('Limpeza de flags legadas de admin', { scanned, wouldClear, cleared, apply });
      res.status(200).json({
        success: true,
        mode: apply ? 'aplicado' : 'simulação',
        scanned,
        withLegacyFlag: wouldClear,
        cleared,
        keptAsAdmin,
        hint: apply ? undefined : 'Reenvie com {"apply": true} para gravar.'
      });
    } catch (error) {
      logger.error('Falha na limpeza de flags legadas', error);
      res.status(500).json({ error: 'Erro durante a limpeza.', scanned, cleared });
    }
  }
);
