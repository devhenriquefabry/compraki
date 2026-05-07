import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  addDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  Firestore,
  serverTimestamp
} from 'firebase/firestore';
import { getAuth, Auth, User, onAuthStateChanged } from 'firebase/auth';
import { Observable, BehaviorSubject } from 'rxjs';
import { Product } from '../interfaces/product';
import { SavedItem } from '../interfaces/saved-item';

import { environment } from '../../environments/environment';
const firebaseConfig = environment.firebase;

@Injectable({
  providedIn: 'root'
})
export class FirebaseSavedService {
  private db: Firestore;
  private authenticator: Auth;

  private savedCountSource = new BehaviorSubject<number>(0);
  savedCount$ = this.savedCountSource.asObservable();

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.authenticator = getAuth(app);
  }

  // Get current user details from Firebase Auth
  getCurrentUser(): User | null {
    return this.authenticator.currentUser;
  }

  // Save a product to Favorites
  async saveProduct(product: Product): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error("Usuário não autenticado.");

    const userSavedCol = collection(this.db, `users/${user.uid}/savedProducts`);
    
    // Check if it already exists to prevent duplicate saves
    const q = query(userSavedCol, where("productId", "==", product.id));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
       console.log("Product already saved.");
       return querySnapshot.docs[0].id; // Return existing ID
    }

    const newSavedItem = {
      productId: product.id,
      savedAt: serverTimestamp(),
      productData: product // Destructure safely
    };

    const docRef = await addDoc(userSavedCol, newSavedItem);
    return docRef.id;
  }

  // Remove a product from Favorites using Document ID
  async removeProduct(savedItemId: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error("Usuário não autenticado.");

    return deleteDoc(doc(this.db, `users/${user.uid}/savedProducts`, savedItemId));
  }
  
  // Alternative: Remove by ProductId (useful when toggling off in details page)
  async removeByProductId(productId: string): Promise<void> {
      const user = this.getCurrentUser();
      if (!user) return;
      
      const userSavedCol = collection(this.db, `users/${user.uid}/savedProducts`);
      const q = query(userSavedCol, where("productId", "==", productId));
      const querySnapshot = await getDocs(q);
      
      querySnapshot.forEach((document) => {
          deleteDoc(doc(this.db, `users/${user.uid}/savedProducts`, document.id));
      });
  }

  // Check if a specific product is saved
  async isProductSaved(productId: string): Promise<boolean> {
     const user = this.getCurrentUser();
     if (!user) return false;

     const userSavedCol = collection(this.db, `users/${user.uid}/savedProducts`);
     const q = query(userSavedCol, where("productId", "==", productId));
     const querySnapshot = await getDocs(q);
     
     return !querySnapshot.empty;
  }

  // Listen in real-time to all saved products of the current user
  getAllSaved(): Observable<SavedItem[]> {
    return new Observable<SavedItem[]>(subscriber => {
      // Usar onAuthStateChanged para garantir que temos o usuário antes de escutar o Firestore
      const authUnsub = onAuthStateChanged(this.authenticator, (user) => {
        if (!user) {
          subscriber.next([]);
          return;
        }

        const userSavedCol = collection(this.db, `users/${user.uid}/savedProducts`);
        
        const snapshotUnsub = onSnapshot(userSavedCol, (snapshot) => {
          const items = snapshot.docs.map(d => {
             return { id: d.id, ...d.data() } as SavedItem;
          });
          
          this.savedCountSource.next(items.length);

          items.sort((a,b) => {
              if(!a.savedAt || !b.savedAt) return 0;
              return b.savedAt.seconds - a.savedAt.seconds;
          });
          subscriber.next(items);
        }, (err) => {
           subscriber.error(err);
        });

        // Limpar snapshot unsub quando desinscrever do Observable principal
        subscriber.add(() => {
          if (snapshotUnsub) snapshotUnsub();
        });
      });

      // Limpar auth unsub
      return () => {
        if (authUnsub) authUnsub();
      };
    });
  }
}
