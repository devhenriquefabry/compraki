import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp, Firestore, collection, onSnapshot } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { EmailAuthProvider, getAuth, reauthenticateWithCredential, updatePassword, updateProfile } from 'firebase/auth';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { AppUser } from '../interfaces/app-user';
import { Observable } from 'rxjs';

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
  private storage;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.storage = getStorage(app);
  }

  /**
   * Método Atômico: Garante que o usuário possua um documento no Firestore.
   * Ao utilizar `{ merge: true }`, o Firebase não sobrescreve os dados (como nome trocado, 
   * ou um campo super_admin flag), caso o documento já exista.
   */
  async ensureAppUserDocument(user: User, extraData?: Partial<AppUser>): Promise<void> {
    try {
      if (!user.uid) return;

      const userRef = doc(this.db, 'users', user.uid);
      
      const payload: Partial<AppUser> = {
        uid: user.uid,
        email: user.email,
        displayName: extraData?.displayName || user.displayName || 'Novo Usuário',
        photoURL: user.photoURL || null,
        phoneNumber: extraData?.phoneNumber || user.phoneNumber || null,
        cpf: extraData?.cpf || null,
        isSeller: true,
        lastLoginAt: serverTimestamp(),
        ...extraData
      };

      // Cria ou Executa Merge
      await setDoc(userRef, payload, { merge: true });
      console.log('Documento Firestore do Usuário mantido e sincronizado.');

    } catch (e) {
      console.error("Erro no espelhamento passivo do usuário Firestore:", e);
    }
  }

  /**
   * Puxa os dados de um usuário específico do Firestore.
   */
  async getUserById(uid: string): Promise<AppUser | null> {
    const { getDoc } = await import('firebase/firestore');
    const userRef = doc(this.db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return snap.data() as AppUser;
    }
    return null;
  }

  async uploadProfilePhoto(uid: string, file: File): Promise<string> {
    const extension = file.name.split('.').pop() || 'jpg';
    const filePath = `profile-photos/${uid}/${Date.now()}.${extension}`;
    const storageRef = ref(this.storage, filePath);

    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }

  async updateCurrentUserProfile(data: Partial<AppUser>): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Usuário precisa estar autenticado para atualizar o perfil.');
    }

    const authPayload: { displayName?: string; photoURL?: string } = {};
    if (typeof data.displayName === 'string') authPayload.displayName = data.displayName;
    if (typeof data.photoURL === 'string') authPayload.photoURL = data.photoURL;

    if (Object.keys(authPayload).length > 0) {
      await updateProfile(currentUser, authPayload);
    }

    const userRef = doc(this.db, 'users', currentUser.uid);
    await setDoc(userRef, {
      uid: currentUser.uid,
      email: currentUser.email,
      ...data,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  async changeCurrentUserPassword(currentPassword: string, newPassword: string): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser?.email) {
      throw new Error('Usuário precisa estar autenticado com e-mail para alterar a senha.');
    }

    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPassword);
  }

  /**
   * Puxa todos os usuários do sistema para que possamos iniciar um bate-papo.
   */
  getAllUsers(): Observable<AppUser[]> {
    return new Observable<AppUser[]>(observer => {
       const usersCol = collection(this.db, 'users');
       
       return onSnapshot(usersCol, (snapshot) => {
          const users: AppUser[] = [];
          snapshot.forEach(d => {
            const data = d.data() as any;
            users.push({ id: d.id, ...data } as AppUser);
          });
          observer.next(users);
       }, (err) => {
           observer.error(err);
       });
    });
  }
}
