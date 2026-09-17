import { Router } from '@angular/router';
import { getCurrentUser } from './auth-state';

const HOME = '/tabs/tab2';

/**
 * Destino depois do login. Só aceita caminho interno: `redirectTo` vem da URL,
 * e um `//site-malicioso.com` ali viraria redirecionamento aberto.
 */
export function safeRedirectTarget(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return HOME;
  if (/^\/(login|sign-in|forgot-password|password-recovery)(\/|\?|$)/.test(raw)) return HOME;
  return raw;
}

/**
 * Ações que exigem conta (carrinho, favoritos, seguir, conversar, avaliar).
 *
 * Com sessão devolve `true` e a ação segue. Sem sessão leva ao login lembrando
 * a página atual, para a pessoa voltar exatamente onde estava.
 */
export function requireAccount(router: Router, returnUrl: string = router.url): boolean {
  if (getCurrentUser()) return true;
  router.navigate(['/login'], { queryParams: { redirectTo: returnUrl } });
  return false;
}
