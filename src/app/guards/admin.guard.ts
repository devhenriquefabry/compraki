import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseProducts } from '../services/firebase-products';

export const adminGuard = async () => {
  const router = inject(Router);
  const fbProducts = inject(FirebaseProducts);

  const user = fbProducts.getUser();
  
  if (!user) {
    router.navigate(['/login']);
    return false;
  }

  // Liberado para todos por enquanto (conforme solicitado pelo usuário)
  return true;
};
