import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { waitForAuthUser } from '../core/auth-state';
import { safeRedirectTarget } from '../core/auth-redirect';

/**
 * Guard para rotas que exigem autenticação.
 * Redireciona para /login se o usuário não estiver logado.
 *
 * Usa o estado compartilhado de `core/auth-state`: o listener de auth é único
 * no app, então só a primeira navegação espera o Firebase resolver.
 */
export const authGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);

  const user = await waitForAuthUser();
  if (user) return true;

  // Guarda o destino para voltar depois do login.
  router.navigate(['/login'], { queryParams: { redirectTo: state.url } });
  return false;
};

/**
 * Guard da vitrine (home, busca, produto, loja do vendedor).
 *
 * No navegador a vitrine é aberta: quem chega por um link ou pelo Google navega
 * sem conta, como no Mercado Livre e na Amazon, e só é mandado ao login quando
 * tenta comprar, salvar, seguir ou conversar (ver `core/auth-redirect`). O que
 * é lido aqui — produtos, categorias, banners, `sellers/` e avaliações — já tem
 * leitura pública nas regras do Firestore.
 *
 * No app nativo (APK) o fluxo continua começando pelo login.
 */
export const storefrontGuard: CanActivateFn = (route, state) => {
  if (!Capacitor.isNativePlatform()) return true;
  return authGuard(route, state);
};

/**
 * Guard para rotas que NÃO devem ser acessadas por usuários já logados
 * (Login, Sign-in, recuperação de senha).
 */
export const noAuthGuard: CanActivateFn = async (route) => {
  const router = inject(Router);

  const user = await waitForAuthUser();
  if (!user) return true;

  router.navigateByUrl(safeRedirectTarget(route.queryParamMap.get('redirectTo')));
  return false;
};
