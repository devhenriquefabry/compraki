import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, updateDoc, serverTimestamp, Firestore, collection, onSnapshot, deleteDoc, query, where, orderBy, writeBatch } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { EmailAuthProvider, getAuth, reauthenticateWithCredential, updatePassword, updateProfile } from 'firebase/auth';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { AppUser } from '../interfaces/app-user';
import { PublicSellerProfile } from '../interfaces/seller';
import { Observable } from 'rxjs';
import { Order } from '../interfaces/order';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FirebaseUsersService {
  private db: Firestore;
  private storage;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
    this.storage = getStorage(app);
  }

  /**
   * Garante que o usuário possua um documento no Firestore.
   * Usa `{ merge: true }` para não sobrescrever dados já existentes.
   *
   * IMPORTANTE — não voltar a gravar `isAdmin`, `super_admin` ou `role` aqui.
   * Privilégio administrativo vive exclusivamente no custom claim `admin` do
   * ID token, atribuído pela Cloud Function `setAdminClaim`. As regras do
   * Firestore rejeitam qualquer payload deste método que toque nesses campos.
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

      // Blindagem: mesmo que algum chamador passe um campo de privilégio em
      // `extraData`, ele não sai daqui — a regra do Firestore negaria a escrita
      // inteira e o usuário ficaria sem documento.
      delete (payload as Record<string, unknown>)['isAdmin'];
      delete (payload as Record<string, unknown>)['super_admin'];
      delete (payload as Record<string, unknown>)['role'];
      delete (payload as Record<string, unknown>)['isChatBanned'];

      // Cria ou Executa Merge
      await setDoc(userRef, payload, { merge: true });

    } catch (e) {
      console.error("Erro no espelhamento passivo do usuário Firestore:", e);
    }
  }

  /**
   * Puxa os dados completos de um usuário. Só funciona para o próprio usuário
   * ou para admin — `users/{uid}` guarda CPF, telefone e endereço e não tem
   * leitura pública. Para exibir o perfil de OUTRO usuário (vendedor), use
   * `getPublicSellerProfile()`.
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

  /**
   * Perfil público de vendedor, lido de `sellers/{uid}`.
   *
   * Essa coleção é um espelho somente-leitura mantido pela Cloud Function
   * `syncSellerProfile`, que copia de `users/{uid}` apenas os campos de
   * vitrine — nunca CPF, e-mail, telefone ou endereço.
   */
  async getPublicSellerProfile(uid: string): Promise<PublicSellerProfile | null> {
    if (!uid) return null;

    const { getDoc } = await import('firebase/firestore');
    const sellerRef = doc(this.db, 'sellers', uid);
    const snap = await getDoc(sellerRef);

    if (snap.exists()) {
      return { uid: snap.id, ...snap.data() } as PublicSellerProfile;
    }

    // Vendedor ainda não espelhado (conta criada antes do backfill, ou trigger
    // em atraso). Melhor devolver null do que quebrar a tela.
    return null;
  }

  /**
   * Observa o documento de um usuário em tempo real.
   *
   * Substitui o padrão de `getUserById()` dentro de `setInterval`: um listener
   * custa uma leitura inicial e depois só cobra quando o dado muda de verdade.
   * A sondagem de 1,5s que existia no `app.component` gerava ~40 leituras por
   * minuto por usuário logado, independente de haver mudança.
   *
   * `null` no callback significa que o documento não existe.
   *
   * @returns função para cancelar a inscrição.
   */
  watchUser(uid: string, callback: (user: AppUser | null) => void): () => void {
    const userRef = doc(this.db, 'users', uid);

    return onSnapshot(
      userRef,
      (snap) => callback(snap.exists() ? ({ uid: snap.id, ...snap.data() } as AppUser) : null),
      (err) => {
        console.error('Falha ao observar o usuário:', err);
        callback(null);
      }
    );
  }

  async uploadProfilePhoto(uid: string, file: File): Promise<string> {
    const extension = file.name.split('.').pop() || 'jpg';
    const filePath = `profile-photos/${uid}/${Date.now()}.${extension}`;
    const storageRef = ref(this.storage, filePath);

    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }

  async uploadShowcaseBanner(uid: string, file: File): Promise<string> {
    const extension = file.name.split('.').pop() || 'jpg';
    const filePath = `showcase-banners/${uid}/${Date.now()}.${extension}`;
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

  async updateUserPartial(uid: string, data: Partial<AppUser>): Promise<void> {
    const userRef = doc(this.db, 'users', uid);
    await setDoc(userRef, {
      ...data,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  async toggleUserChatBan(uid: string, isBanned: boolean): Promise<void> {
    await this.updateUserPartial(uid, { isChatBanned: isBanned });
  }

  async toggleUserSeller(uid: string, isSeller: boolean): Promise<void> {
    const userDoc = doc(this.db, 'users', uid);
    return updateDoc(userDoc, { isSeller });
  }

  /**
   * Promove ou remove privilégios de administrador.
   *
   * Passa pela Cloud Function `setAdminClaim`, que grava o custom claim no ID
   * token e encerra as sessões abertas do alvo. Escrever `isAdmin` direto no
   * documento (como era feito antes) não concede mais nada: as regras do
   * Firestore rejeitam a escrita e nenhuma autorização consulta esse campo.
   */
  async toggleUserAdmin(uid: string, isAdmin: boolean): Promise<void> {
    await this.callAdminFunction('setAdminClaim', { uid, admin: isAdmin });
  }

  /**
   * Super admin não é mais um nível separado — o claim `admin` é binário.
   * Mantido para não quebrar chamadores existentes.
   */
  async setSuperAdmin(uid: string, status: boolean): Promise<void> {
    await this.toggleUserAdmin(uid, status);
  }

  /** Chamada autenticada às Cloud Functions administrativas. */
  private async callAdminFunction(fnName: string, body: unknown): Promise<unknown> {
    const currentUser = getAuth().currentUser;
    if (!currentUser) throw new Error('Sessão expirada. Faça login novamente.');

    const token = await currentUser.getIdToken();
    const baseUrl = `https://us-central1-${environment.firebase.projectId}.cloudfunctions.net`;

    const response = await fetch(`${baseUrl}/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(data?.error || 'Não foi possível concluir a operação.');
    }

    return data;
  }

  async deleteUserDocument(uid: string): Promise<void> {
    const userRef = doc(this.db, 'users', uid);
    await deleteDoc(userRef);
  }

  getUserAddresses(uid: string): Observable<any[]> {
    return new Observable<any[]>(observer => {
      const addrCol = collection(this.db, 'users', uid, 'addresses');
      return onSnapshot(addrCol, (snapshot) => {
        const addresses: any[] = [];
        snapshot.forEach(d => addresses.push({ id: d.id, ...d.data() }));
        observer.next(addresses);
      }, (err) => observer.error(err));
    });
  }

  getCurrentUser(): User | null {
    return getAuth().currentUser;
  }

  getUserPurchases(uid: string): Observable<Order[]> {
    const q = query(
      collection(this.db, 'orders'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc')
    );
    return new Observable<Order[]>(observer => {
      return onSnapshot(q, (snapshot) => {
        const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Order));
        observer.next(orders);
      }, (err) => observer.error(err));
    });
  }

  getUserSales(uid: string): Observable<Order[]> {
    const q = query(
      collection(this.db, 'orders'),
      where('sellerIds', 'array-contains', uid),
      orderBy('createdAt', 'desc')
    );
    return new Observable<Order[]>(observer => {
      return onSnapshot(q, (snapshot) => {
        const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Order));
        observer.next(orders);
      }, (err) => observer.error(err));
    });
  }

  getSellerFollowerCount(sellerId: string): Observable<number> {
    return new Observable<number>(observer => {
      const followersCol = collection(this.db, 'users', sellerId, 'followers');
      return onSnapshot(followersCol, (snapshot) => {
        observer.next(snapshot.size);
      }, (err) => observer.error(err));
    });
  }

  isFollowingSeller(sellerId: string): Observable<boolean> {
    return new Observable<boolean>(observer => {
      const auth = getAuth();
      let unsubscribeSnapshot: (() => void) | undefined;
      const unsubscribeAuth = auth.onAuthStateChanged((user) => {
        unsubscribeSnapshot?.();
        unsubscribeSnapshot = undefined;

        if (!user || user.uid === sellerId) {
          observer.next(false);
          return;
        }

        const followDoc = doc(this.db, 'users', sellerId, 'followers', user.uid);
        unsubscribeSnapshot = onSnapshot(followDoc, (snapshot) => {
          observer.next(snapshot.exists());
        }, (err) => observer.error(err));
      });

      return () => {
        unsubscribeSnapshot?.();
        unsubscribeAuth();
      };
    });
  }

  /** Aceita o perfil publico: so precisa de uid, nome e foto. */
  async followSeller(seller: PublicSellerProfile | AppUser): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Usuário precisa estar autenticado para seguir vendedores.');
    }

    if (!seller.uid || seller.uid === currentUser.uid) {
      throw new Error('Não é possível seguir este vendedor.');
    }

    const batch = writeBatch(this.db);
    const followerRef = doc(this.db, 'users', seller.uid, 'followers', currentUser.uid);
    const followingRef = doc(this.db, 'users', currentUser.uid, 'followingSellers', seller.uid);

    const payload = {
      createdAt: serverTimestamp(),
      followerId: currentUser.uid,
      sellerId: seller.uid
    };

    batch.set(followerRef, {
      ...payload,
      followerName: currentUser.displayName || currentUser.email || 'Usuário Compraki',
      followerPhotoURL: currentUser.photoURL || null
    });

    batch.set(followingRef, {
      ...payload,
      sellerName: seller.shopName || seller.displayName || seller.username || 'Vendedor Compraki',
      sellerPhotoURL: seller.photoURL || null
    });

    await batch.commit();
  }

  async unfollowSeller(sellerId: string): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Usuário precisa estar autenticado para deixar de seguir vendedores.');
    }

    const batch = writeBatch(this.db);
    batch.delete(doc(this.db, 'users', sellerId, 'followers', currentUser.uid));
    batch.delete(doc(this.db, 'users', currentUser.uid, 'followingSellers', sellerId));
    await batch.commit();
  }
}
