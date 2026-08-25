import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';

import { defaultRuntime, handleCors, methodNotAllowed, region, requireAdmin } from './shared/http';

/**
 * Espelho público do perfil de vendedor: `users/{uid}` -> `sellers/{uid}`.
 *
 * POR QUE ISSO EXISTE
 * `users/{uid}` guarda CPF, e-mail, telefone e endereço, e antes tinha
 * `allow read: if true` — qualquer pessoa lia tudo. Como as regras do
 * Firestore são por documento (não dá para liberar só alguns campos), a saída
 * é manter uma cópia pública contendo apenas o que pode ser visto por
 * qualquer um.
 *
 * `sellers/{uid}` é somente-leitura para o cliente; só o Admin SDK escreve.
 */

/**
 * Lista fechada do que é público. Espelha `PUBLIC_SELLER_FIELDS` em
 * src/app/interfaces/seller.ts — manter as duas em sincronia.
 *
 * NUNCA acrescentar aqui: cpf, email, phoneNumber, address, isAdmin,
 * super_admin, role, isChatBanned.
 */
const PUBLIC_FIELDS = [
  'displayName',
  'photoURL',
  'username',
  'isSeller',
  'status',
  'shopName',
  'shopDescription',
  'shopBanner',
  'shopPrimaryColor',
  'shopSecondaryColor',
  'shopFeaturedTitle',
  'shopInstagram',
  'shopWhatsApp',
  'createdAt'
] as const;

function buildPublicProfile(data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const profile: Record<string, unknown> = {};

  for (const field of PUBLIC_FIELDS) {
    const value = data[field];
    if (value !== undefined) profile[field] = value;
  }

  profile['updatedAt'] = FieldValue.serverTimestamp();
  return profile;
}

/** Só reescreve o espelho quando um campo público mudou de verdade. */
function publicFieldsChanged(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData
): boolean {
  if (!before) return true;

  return PUBLIC_FIELDS.some(field => {
    const a = before[field];
    const b = after[field];
    if (a === b) return false;
    return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  });
}

/**
 * Mantém `sellers/{uid}` em dia a cada escrita em `users/{uid}`.
 */
export const syncSellerProfile = onDocumentWritten(
  { document: 'users/{uid}', region, maxInstances: 10 },
  async (event) => {
    const uid = event.params['uid'];
    const sellerRef = getFirestore().doc(`sellers/${uid}`);

    const after = event.data?.after;
    const before = event.data?.before;

    // Usuário removido: derruba o espelho junto.
    if (!after?.exists) {
      await sellerRef.delete().catch(() => undefined);
      logger.info('Perfil público removido', { uid });
      return;
    }

    const afterData = after.data();
    if (!afterData) return;

    if (!publicFieldsChanged(before?.exists ? before.data() : undefined, afterData)) {
      return;
    }

    await sellerRef.set(buildPublicProfile(afterData), { merge: true });
    logger.debug('Perfil público sincronizado', { uid });
  }
);

/**
 * BACKFILL — executar UMA vez, antes de publicar as regras que fecham a
 * leitura de `users/`. Sem isto, os perfis de vendedores já existentes ficam
 * sem espelho e as telas de vitrine aparecem vazias.
 *
 * Roda em modo simulação por padrão. Passe `{"apply": true}` para gravar.
 */
export const backfillSellerProfiles = onRequest(
  { ...defaultRuntime, timeoutSeconds: 540 },
  async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res);

    const caller = await requireAdmin(req, res);
    if (!caller) return;

    const apply = (req.body || {}).apply === true;
    const db = getFirestore();

    let scanned = 0;
    let mirrored = 0;

    try {
      const snapshot = await db.collection('users').get();
      let batch = db.batch();
      let batchCount = 0;

      for (const docSnap of snapshot.docs) {
        scanned += 1;
        const data = docSnap.data();
        if (!data) continue;

        mirrored += 1;
        if (!apply) continue;

        batch.set(db.doc(`sellers/${docSnap.id}`), buildPublicProfile(data), { merge: true });
        batchCount += 1;

        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (apply && batchCount > 0) await batch.commit();

      logger.info('Backfill de perfis públicos', { scanned, mirrored, apply });
      res.status(200).json({
        success: true,
        mode: apply ? 'aplicado' : 'simulação',
        scanned,
        mirrored,
        hint: apply ? undefined : 'Reenvie com {"apply": true} para gravar.'
      });
    } catch (error) {
      logger.error('Falha no backfill de perfis públicos', error);
      res.status(500).json({ error: 'Erro durante o backfill.', scanned });
    }
  }
);
