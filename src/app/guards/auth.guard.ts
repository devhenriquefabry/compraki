import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { environment } from 'src/environments/environment';

/**
 * Função utilitária para garantir que o Firebase está inicializado e retornar o Auth
 */
const getFirebaseAuth = () => {
  const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
  return getAuth(app);
};

/**
 * Guard para proteger rotas que exigem autenticação.
 * Redireciona para /login se o usuário não estiver logado.
 */
export const authGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const auth = getFirebaseAuth();

  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        resolve(true);
      } else {
        console.log('Acesso negado: Usuário não autenticado. Redirecionando para login...');
        router.navigate(['/login']);
        resolve(false);
      }
    });
  });
};

/**
 * Guard para rotas que NÃO devem ser acessadas por usuários já logados (ex: Login, Sign-in).
 * Redireciona para /tabs se o usuário já estiver logado.
 */
export const noAuthGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const auth = getFirebaseAuth();

  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        router.navigate(['/tabs']);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};
