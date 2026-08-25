import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { waitForAuthUser } from '../core/auth-state';

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
 * Guard para rotas que NÃO devem ser acessadas por usuários já logados
 * (Login, Sign-in, recuperação de senha).
 */
export const noAuthGuard: CanActivateFn = async () => {
  const router = inject(Router);

  const user = await waitForAuthUser();
  if (!user) return true;

  router.navigate(['/tabs/tab2']);
  return false;
};
