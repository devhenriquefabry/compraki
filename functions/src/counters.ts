import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';

import { defaultRuntime, handleCors, methodNotAllowed, region, requireAdmin } from './shared/http';

/**
 * Contadores desnormalizados em `products/{id}`.
 *
 * POR QUE ISSO EXISTE
 * `StatsService.countSaves()` fazia `collectionGroup('savedProducts')` filtrando
 * por `productId` — uma varredura entre TODOS os usuários, cobrada por documento
 * lido, toda vez que um vendedor abria a tela de estatísticas do produto. Com
 * regras corretas essa consulta também não passa: os documentos ficam sob
 * `users/{uid}/`, e não há como o Firestore autorizar a leitura cruzada sem
 * abrir os salvos de todo mundo.
 *
 * A solução padrão é contar na escrita, não na leitura: os gatilhos abaixo
 * mantêm `savedCount` em dia, e a tela lê um número já pronto.
 *
 * LIMITE CONHECIDO: um documento suporta ~1 escrita por segundo sustentada. Se
 * um produto virar viral a ponto de passar disso, o caminho é sharded counter
 * (N subdocumentos somados na leitura). Não vale a complexidade agora.
 */

const counterRuntime = { region, maxInstances: 10 } as const;

async function bumpSavedCount(productId: string, delta: number): Promise<void> {
  if (!productId) return;

  const productRef = getFirestore().doc(`products/${productId}`);

  try {
    await productRef.update({ savedCount: FieldValue.increment(delta) });
  } catch (error) {
    // Produto apagado enquanto o gatilho rodava: nada a contar.
    logger.debug('Não foi possível atualizar savedCount', { productId, delta, error });
  }
}

export const onProductSaved = onDocumentCreated(
  { document: 'users/{uid}/savedProducts/{savedId}', ...counterRuntime },
  async (event) => {
    const productId = event.data?.data()?.['productId'];
    await bumpSavedCount(String(productId || ''), 1);
  }
);

export const onProductUnsaved = onDocumentDeleted(
  { document: 'users/{uid}/savedProducts/{savedId}', ...counterRuntime },
  async (event) => {
    const productId = event.data?.data()?.['productId'];
    await bumpSavedCount(String(productId || ''), -1);
  }
);

/**
 * Recalcula `savedCount` de todos os produtos a partir do estado real.
 *
 * Rode uma vez depois do deploy (os salvos existentes nunca passaram pelos
 * gatilhos) e sempre que suspeitar de contador fora do lugar — os gatilhos
 * podem perder eventos em falha rara, e este é o conserto.
 *
 * Simulação por padrão; `{"apply": true}` grava.
 */
export const recomputeSavedCounts = onRequest(
  { ...defaultRuntime, timeoutSeconds: 540 },
  async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res);

    const caller = await requireAdmin(req, res);
    if (!caller) return;

    const apply = (req.body || {}).apply === true;
    const db = getFirestore();

    try {
      // Uma varredura de collection group aqui é aceitável: roda no Admin SDK,
      // sob demanda, e não a cada abertura de tela.
      const savedSnap = await db.collectionGroup('savedProducts').get();

      const counts = new Map<string, number>();
      savedSnap.forEach((docSnap) => {
        const productId = String(docSnap.data()?.['productId'] || '');
        if (!productId) return;
        counts.set(productId, (counts.get(productId) || 0) + 1);
      });

      const productsSnap = await db.collection('products').get();
      let updated = 0;
      let drifted = 0;

      let batch = db.batch();
      let batchCount = 0;

      for (const productDoc of productsSnap.docs) {
        const expected = counts.get(productDoc.id) || 0;
        const current = productDoc.data()?.['savedCount'];

        if (current === expected) continue;
        drifted += 1;

        if (!apply) continue;

        batch.update(productDoc.ref, { savedCount: expected });
        batchCount += 1;
        updated += 1;

        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (apply && batchCount > 0) await batch.commit();

      logger.info('Recontagem de savedCount', { drifted, updated, apply });
      res.status(200).json({
        success: true,
        mode: apply ? 'aplicado' : 'simulação',
        totalSaves: savedSnap.size,
        products: productsSnap.size,
        outOfSync: drifted,
        updated,
        hint: apply ? undefined : 'Reenvie com {"apply": true} para gravar.'
      });
    } catch (error) {
      logger.error('Falha ao recontar savedCount', error);
      res.status(500).json({ error: 'Erro durante a recontagem.' });
    }
  }
);
