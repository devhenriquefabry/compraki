import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseProducts } from '../services/firebase-products';
import { FirebaseUsersService } from '../services/firebase-users.service';

export const adminGuard = async () => {
  const router = inject(Router);
  const fbProducts = inject(FirebaseProducts);
  const usersService = inject(FirebaseUsersService);

  const user = fbProducts.getUser();
  
  if (!user) {
    router.navigate(['/login']);
    return false;
  }

  try {
    const appUser = await usersService.getUserById(user.uid);
    if (appUser && appUser.isAdmin) {
      return true;
    }
    
    // Se não for admin, manda para a home
    router.navigate(['/home']);
    return false;
  } catch (error) {
    router.navigate(['/home']);
    return false;
  }
};
