import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  Firestore,
  serverTimestamp,
} from 'firebase/firestore';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { Observable, BehaviorSubject } from 'rxjs';
import { CartItem } from '../interfaces/cart-item';
import { Product } from '../interfaces/product';

const firebaseConfig = {
  apiKey: "AIzaSyDD50YO6EznucB9D1yx6ujwjdD3v-ZCfyg",
  authDomain: "compraki-mcu.firebaseapp.com",
  projectId: "compraki-mcu",
  storageBucket: "compraki-mcu.firebasestorage.app",
  messagingSenderId: "2028715763",
  appId: "1:2028715763:web:5507a8b12473bfc6e50186",
  measurementId: "G-92Q7R0CQR0"
};

@Injectable({
  providedIn: 'root',
})
export class FirebaseCartService {
  private db: Firestore;
  private auth;

  private cartCountSource = new BehaviorSubject<number>(0);
  cartCount$ = this.cartCountSource.asObservable();

  // Promise que resolve quando o auth estiver pronto
  private authReady: Promise<User | null>;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.auth = getAuth(app);

    // Esperar o auth inicializar
    this.authReady = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, (user) => {
        unsubscribe();
        resolve(user);
      });
    });
  }

  private async waitForUser(): Promise<User> {
    // Primeiro tenta o currentUser (já inicializado)
    if (this.auth.currentUser) return this.auth.currentUser;
    // Senão, espera o auth ficar pronto
    const user = await this.authReady;
    if (!user) throw new Error('Usuário não autenticado');
    return user;
  }

  private getCartCollectionForUser(uid: string) {
    return collection(this.db, 'users', uid, 'cart');
  }

  getAllCartItems(): Observable<CartItem[]> {
    return new Observable<CartItem[]>(subscriber => {
      // Usar onAuthStateChanged para garantir reatividade total ao estado de login
      const authUnsub = onAuthStateChanged(this.auth, (user) => {
        if (!user) {
          this.cartCountSource.next(0);
          subscriber.next([]);
          return;
        }

        const cartCol = this.getCartCollectionForUser(user.uid);
        const snapshotUnsub = onSnapshot(cartCol,
          (snapshot) => {
            const items = snapshot.docs.map(d => {
              const data = d.data() as any;
              return { ...data, id: d.id } as CartItem;
            });
            this.cartCountSource.next(items.reduce((sum, item) => sum + item.quantity, 0));
            subscriber.next(items);
          },
          (err) => subscriber.error(err)
        );

        // Limpar o snapshot quando o usuário deslogar ou mudar
        subscriber.add(() => {
          if (snapshotUnsub) snapshotUnsub();
        });
      });

      // Limpar o listener de auth no final
      return () => {
        authUnsub();
      };
    });
  }

  async addToCart(product: Product, quantity: number = 1): Promise<void> {
    const user = await this.waitForUser();
    const cartCol = this.getCartCollectionForUser(user.uid);

    // Verificar se o produto já existe no carrinho
    const q = query(cartCol, where('productId', '==', product.id));
    const existing = await getDocs(q);

    if (!existing.empty) {
      // Atualizar quantidade
      const existingDoc = existing.docs[0];
      const currentQty = existingDoc.data()['quantity'] || 1;
      await updateDoc(existingDoc.ref, {
        quantity: currentQty + quantity,
      });
    } else {
      // Adicionar novo item
      await addDoc(cartCol, {
        productId: product.id || null,
        quantity: quantity,
        addedAt: serverTimestamp(),
        productData: {
          id: product.id || null,
          name: product.name || '',
          price: product.price || 0,
          priceDiscounted: product.priceDiscounted || null,
          photoURL: product.photoURL || [],
          condition: product.condition || null,
          stock: product.stock || 0,
          shipping: product.shipping || null,
          paymentMethods: product.paymentMethods || [],
          categoryIds: product.categoryIds || [],
          subcategoryIds: product.subcategoryIds || [],
          sellerId: product.sellerId || null,
        },
      });
    }
  }

  async updateQuantity(cartItemId: string, quantity: number): Promise<void> {
    const user = await this.waitForUser();
    const cartCol = this.getCartCollectionForUser(user.uid);
    const itemRef = doc(cartCol, cartItemId);
    await updateDoc(itemRef, { quantity });
  }

  async removeFromCart(cartItemId: string): Promise<void> {
    const user = await this.waitForUser();
    const cartCol = this.getCartCollectionForUser(user.uid);
    const itemRef = doc(cartCol, cartItemId);
    await deleteDoc(itemRef);
  }

  async clearCart(): Promise<void> {
    const user = await this.waitForUser();
    const cartCol = this.getCartCollectionForUser(user.uid);
    const snapshot = await getDocs(cartCol);
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  }
}
