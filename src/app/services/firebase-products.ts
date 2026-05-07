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
  Firestore,
  query,
  where,
  orderBy
} from 'firebase/firestore';

import { getDownloadURL, ref, getStorage, uploadBytes } from 'firebase/storage';
import { Product } from '../interfaces/product';
import { Observable } from 'rxjs';
import { AppAddress } from '../interfaces/app-user';
import { Auth, getAuth, createUserWithEmailAndPassword, signOut, User, signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider, onAuthStateChanged} from 'firebase/auth';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { Router } from '@angular/router';
import { FirebaseUsersService } from './firebase-users.service';
import { WhatsappInstancesService } from './whatsapp-instances.service';
import { environment } from '../../environments/environment';

// Copie sua config aqui para garantir que o SDK use o objeto puro
const firebaseConfig = {
  apiKey: "AIzaSyBD5AH1b1_p6AghhPx3Nr0fBVab8djRbkI",
  authDomain: "compraki-mcu.firebaseapp.com",
  databaseURL: "https://compraki-mcu-default-rtdb.firebaseio.com",
  projectId: "compraki-mcu",
  storageBucket: "compraki-mcu.firebasestorage.app",
  messagingSenderId: "2028715763",
  appId: "1:2028715763:web:5507a8b12473bfc6e50186",
  measurementId: "G-92Q7R0CQR0"
};

@Injectable({
  providedIn: 'root',
})
export class FirebaseProducts {
  private db: Firestore;
  private authenticator: Auth;
  private storage;

  public usuarioLogado : User | null = null
  public carregando : boolean = false



  constructor(
    private router : Router,
    private usersService: FirebaseUsersService,
    private whatsappService: WhatsappInstancesService
  ) {
    // Inicializa ou recupera o App SEM passar pelo sistema de injeção do Angular 21
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.storage = getStorage(app);
    this.authenticator = getAuth(app)

    // Listener para manter o estado do usuário sempre sincronizado
    onAuthStateChanged(this.authenticator, (user) => {
      this.usuarioLogado = user;
      console.log('Estado de autenticação alterado. Usuário:', user?.email);
    });
  }

  getAll(): Observable<Product[]> {
    return new Observable<Product[]>(subscriber => {
      const productCol = collection(this.db, 'products');

      return onSnapshot(productCol,
        (snapshot) => {
          const products = snapshot.docs.map(d => {
            const data = d.data() as any;
            return { ...data, id: d.id } as Product;
          });
          subscriber.next(products);
        },
        (err) => subscriber.error(err)
      );
    });
  }

  getById(id: string): Observable<Product | null> {
    return new Observable<Product | null>(subscriber => {
      const productDoc = doc(this.db, 'products', id);

      return onSnapshot(productDoc,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data() as any;
            subscriber.next({ ...data, id: snapshot.id } as Product);
          } else {
            subscriber.next(null);
          }
        },
        (err) => subscriber.error(err)
      );
    });
  }

  getBySeller(sellerId: string): Observable<Product[]> {
    return new Observable<Product[]>(subscriber => {
      const productCol = collection(this.db, 'products');
      const q = query(productCol, where('sellerId', '==', sellerId), orderBy('createdAt', 'desc'));

      return onSnapshot(q,
        (snapshot) => {
          const products = snapshot.docs.map(d => {
            const data = d.data() as any;
            return { ...data, id: d.id } as Product;
          });
          subscriber.next(products);
        },
        (err) => subscriber.error(err)
      );
    });
  }

  add(product: Product) {
    const productCol = collection(this.db, 'products');
    return addDoc(productCol, product);
  }

  update(product: Product) {
    if (!product.id) throw new Error("ID necessário");
    const itemDocRef = doc(this.db, 'products', product.id);
    const { id, ...data } = product;
    return updateDoc(itemDocRef, data);
  }

  delete(id: string) {
    return deleteDoc(doc(this.db, 'products', id));
  }


  // Função para fazer upload da imagem e retornar a URL
  async uploadImage(file: File): Promise<string> {
    const filePath = `products/${Date.now()}_${file.name}`;
    const storageRef = ref(this.storage, filePath);

    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  }
  async signIn(email: string, password: string, name: string, cpf?: string, phone?: string, address?: AppAddress): Promise<boolean> {
    this.carregando = true;

    try {
      const { updateProfile } = await import('firebase/auth');
      const userCredential = await createUserWithEmailAndPassword(this.authenticator, email, password);
      
      // Atualiza o perfil no Auth com o nome fornecido
      await updateProfile(userCredential.user, {
        displayName: name
      });

      // 🔥 Espelhando o usuário no Firestore passivamente com dados extras
      await this.usersService.ensureAppUserDocument(userCredential.user, {
          cpf: cpf || null,
          phoneNumber: phone || null,
          displayName: name,
          address: address || undefined
      });

      void this.dispatchWhatsappTriggerSafe('account_created', {
        nome: name,
        email,
        telefone: phone || '',
        usuario: userCredential.user.uid
      });
      
      console.log('O ID do usuário no sistema é: ' + userCredential.user.uid);
      return true; // Retorno em caso de sucesso

  } catch (error) {
    const erroRetornadoTransformadoEmString = JSON.stringify(error)
    console.warn(erroRetornadoTransformadoEmString);

    if(erroRetornadoTransformadoEmString.includes('auth/email-already-in-use')){
      alert('Email já em uso!')
    }
    else if(erroRetornadoTransformadoEmString.includes('auth/weak-password')){
      alert('Senha fraca, sua senha deve conter no minimo 6 caracteres.')
    }

    else if(erroRetornadoTransformadoEmString.includes('auth/network-request-failed')){
      alert('Sem conexão com a internet.')
    }

    return false; // Retorno em caso de erro

  } finally {
    this.carregando = false;
  }
}

async signInWithGoogle(): Promise<boolean> {
  this.carregando = true;

  try {
    // 1. Dispara a bandeja nativa do Google no Android/iOS
    const googleUser = await GoogleAuth.signIn();

    if (!googleUser.authentication.idToken) {
      throw new Error("Falha ao recuperar idToken do Google.");
    }

    // 2. Passar o token para o Firebase Auth
    const credential = GoogleAuthProvider.credential(googleUser.authentication.idToken);
    const result = await signInWithCredential(this.authenticator, credential);
    const user = result.user;
    
    // 🔥 Espelhando/Atualizando o usuário vindo do Google no Firestore de forma segura
    await this.usersService.ensureAppUserDocument(user);

    void this.dispatchWhatsappTriggerSafe('new_login', {
      nome: user.displayName || 'Usuário Google',
      email: user.email || '',
      telefone: user.phoneNumber || '',
      usuario: user.uid
    });
    
    console.log('Bem-vindo, ' + user.displayName);
    return true;
  } catch (error) {
    console.error("Erro ao logar com Google NATIVO:", error);
    alert('Erro ao autenticar. Coloque o seu Web Client ID em capacitor.config.ts e strings.xml para o plugin funcionar.');
    return false;
  } finally {
    this.carregando = false;
  }
}

  signOut() {
    if (this.getUser()) {

      signOut(this.authenticator).then(() => {

        console.log("O usuario foi deslogado com sucesso!S")
        this.router.navigate(['login'])


      }).catch((erro) => {
        alert(erro)
      })

    } else {
      alert('Não tenho nenhum usuário logado!')
    }

  }

  async resetPassword(email: string): Promise<boolean> {
    const { sendPasswordResetEmail } = await import('firebase/auth');
    try {
      await sendPasswordResetEmail(this.authenticator, email);
      return true;
    } catch (error) {
      console.error('Erro ao enviar e-mail de recuperação:', error);
      throw error;
    }
  }

  getUser(): User | null {

    return this.authenticator.currentUser
  }

  async login(email: string , senha : string ) : Promise<boolean>{
        this.carregando = true

    try {
      const usuario = await signInWithEmailAndPassword(this.authenticator, email, senha);
      console.log('Bem-vindo, ' + usuario.user.email +  '.' + ' Você é o usuário de ID : ' + usuario.user.uid);
      void this.dispatchWhatsappTriggerSafe('new_login', {
        nome: usuario.user.displayName || 'Usuário',
        email: usuario.user.email || email,
        telefone: usuario.user.phoneNumber || '',
        usuario: usuario.user.uid
      });
      return true
      
    } catch (error) {
      console.log(error)
      alert('erro ao fazer login, verifique suas credenciais e tente novamente')
      return false
      
    }
    finally{
      this.carregando = false
    }

  }

  private async dispatchWhatsappTriggerSafe(eventType: 'account_created' | 'new_login', data: Record<string, unknown>): Promise<void> {
    try {
      await this.whatsappService.dispatchTrigger({ eventType, data });
    } catch (error) {
      console.warn('Falha ao disparar gatilho WhatsApp:', error);
    }
  }

  // --- RECUPERAÇÃO DE SENHA PERSONALIZADA ---

  async requestPasswordResetCode(email: string, method?: 'email' | 'whatsapp'): Promise<any> {
    return this.callPublicFunction('requestPasswordResetCode', {
      method: 'POST',
      body: { email: email.toLowerCase().trim(), method }
    });
  }

  async validateResetCode(email: string, code: string): Promise<any> {
    return this.callPublicFunction('validateResetCode', {
      method: 'POST',
      body: { email: email.toLowerCase().trim(), code }
    });
  }

  async completePasswordReset(payload: { email: string; code: string; newPassword: string }): Promise<any> {
    return this.callPublicFunction('completePasswordReset', {
      method: 'POST',
      body: { ...payload, email: payload.email.toLowerCase().trim() }
    });
  }
  private async callPublicFunction<T>(
    functionName: string,
    options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}
  ): Promise<T> {
    const baseUrl = `https://us-central1-${environment.firebase.projectId}.cloudfunctions.net`;
    const response = await fetch(`${baseUrl}/${functionName}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'Erro ao processar solicitação no servidor.');
    }
    return data as T;
  }
}
