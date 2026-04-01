import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp, Firestore } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { AppUser } from '../interfaces/app-user';

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
export class FirebaseUsersService {
  private db: Firestore;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
  }

  /**
   * Método Atômico: Garante que o usuário possua um documento no Firestore.
   * Ao utilizar `{ merge: true }`, o Firebase não sobrescreve os dados (como nome trocado, 
   * ou um campo super_admin flag), caso o documento já exista.
   */
  async ensureAppUserDocument(user: User): Promise<void> {
    try {
      if (!user.uid) return;

      const userRef = doc(this.db, 'users', user.uid);
      
      const payload: Partial<AppUser> = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'Novo Usuário',
        photoURL: user.photoURL || null,
        lastLoginAt: serverTimestamp()
      };

      // Cria ou Executa Merge
      await setDoc(userRef, payload, { merge: true });
      console.log('Documento Firestore do Usuário mantido e sincronizado.');

    } catch (e) {
      console.error("Erro no espelhamento passivo do usuário Firestore:", e);
    }
  }
}
