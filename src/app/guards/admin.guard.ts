import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { isCurrentUserAdmin, waitForAuthUser } from '../core/auth-state';

/**
 * Protege as rotas administrativas.
 *
 * Autoriza pelo custom claim `admin` no ID token — nunca por campo do
 * documento do usuário, que é gravável pelo próprio dono e por isso não
 * serve como autorização.
 *
 * Para conceder acesso a alguém, use a Cloud Function `setAdminClaim`.
 */
export const adminGuard: CanActivateFn = async () => {
  const router = inject(Router);

  const user = await waitForAuthUser();
  if (!user) {
    router.navigate(['/login']);
    return false;
  }

  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    router.navigate(['/tabs/tab2']);
    return false;
  }

  return true;
};
