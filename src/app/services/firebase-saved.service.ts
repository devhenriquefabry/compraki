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
import { getAuth, Auth, User } from 'firebase/auth';
import { Observable, BehaviorSubject } from 'rxjs';
import { Product } from '../interfaces/product';
import { SavedItem } from '../interfaces/saved-item';

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
  providedIn: 'root'
})
export class FirebaseSavedService {
  private db: Firestore;
  private authenticator: Auth;

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
      // Small timeout or observer pattern might be needed if user is not loaded immediately
      // Assuming Auth state is loaded immediately upon enter
      const user = this.getCurrentUser();
      
      if (!user) {
          // You could listen to auth state changes, but for simplicity:
          subscriber.next([]);
          subscriber.complete();
          return;
      }

      const userSavedCol = collection(this.db, `users/${user.uid}/savedProducts`);
      
      return onSnapshot(userSavedCol, (snapshot) => {
        const items = snapshot.docs.map(d => {
           return { id: d.id, ...d.data() } as SavedItem;
        });
        
        // Return sorted by mostly recent if needed:
        items.sort((a,b) => {
            if(!a.savedAt || !b.savedAt) return 0;
            return b.savedAt.seconds - a.savedAt.seconds;
        })
        subscriber.next(items);
      }, (err) => {
         subscriber.error(err);
      });
    });
  }
}
