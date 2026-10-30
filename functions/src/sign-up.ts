import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';

import { defaultRuntime, handleCors, methodNotAllowed } from './shared/http';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * Cadastro: diz se o e-mail digitado já tem conta, para a tela avisar no
 * passo 1 em vez de deixar a pessoa preencher senha e endereço à toa.
 *
 * Precisa ser no servidor: com a proteção contra enumeração de e-mail do
 * Firebase Auth ligada, `fetchSignInMethodsForEmail` no cliente devolve sempre
 * vazio. O `createUserWithEmailAndPassword` continua barrando o duplicado de
 * qualquer jeito — isto aqui é só o aviso antecipado.
 *
 * `googleOnly`: a conta só entra pelo Google (sem senha), então a tela sugere
 * "Continuar com Google" em vez de recuperar a senha.
 */
export const checkEmailAvailable = onRequest({ ...defaultRuntime, maxInstances: 2 }, async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res);

  const email = String(req.body?.email ?? '').toLowerCase().trim();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Digite um e-mail válido' });
    return;
  }

  try {
    const user = await getAuth().getUserByEmail(email).catch(error => {
      if ((error as { code?: string })?.code === 'auth/user-not-found') return null;
      throw error;
    });
    const providers = user?.providerData.map(p => p.providerId) ?? [];
    res.status(200).json({
      exists: !!user,
      googleOnly: !!user && providers.length > 0 && providers.every(p => p === 'google.com'),
    });
  } catch (error) {
    logger.error('Erro em checkEmailAvailable', error);
    res.status(500).json({ error: 'Não foi possível conferir o e-mail agora.' });
  }
});
