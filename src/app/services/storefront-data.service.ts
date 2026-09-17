import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { Category } from '../interfaces/category';
import { CartItem } from '../interfaces/cart-item';
import { SavedItem } from '../interfaces/saved-item';
import { FirebaseCategories } from './firebase-categories';
import { FirebaseCartService } from './firebase-cart.service';
import { FirebaseSavedService } from './firebase-saved.service';

/**
 * Dados que o header e a home de desktop leem ao mesmo tempo.
 *
 * Os serviços do Firebase abrem um listener novo a cada `subscribe`. Aqui cada
 * stream é compartilhado (`shareReplay` com `refCount`), então header e home
 * juntos mantêm um listener só por coleção, e ele fecha quando ninguém mais
 * está olhando.
 *
 * Falha de leitura vira lista vazia: o header não pode quebrar a página porque
 * o carrinho não carregou.
 */
@Injectable({ providedIn: 'root' })
export class StorefrontDataService {
  private readonly categoriesService = inject(FirebaseCategories);
  private readonly cartService = inject(FirebaseCartService);
  private readonly savedService = inject(FirebaseSavedService);

  readonly categories$: Observable<Category[]> = this.categoriesService.getAll().pipe(
    catchError(() => of([])),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly cartItems$: Observable<CartItem[]> = this.cartService.getAllCartItems().pipe(
    catchError(() => of([])),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly savedItems$: Observable<SavedItem[]> = this.savedService.getAllSaved().pipe(
    catchError(() => of([])),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly cartCount$: Observable<number> = this.cartItems$.pipe(
    map(items => items.reduce((sum, item) => sum + (item.quantity || 0), 0))
  );
}
