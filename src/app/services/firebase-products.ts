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
} from 'firebase/firestore';

import { getDownloadURL, ref, getStorage, uploadBytes } from 'firebase/storage';
import { Product } from '../interfaces/product';
import { Observable } from 'rxjs';
import { Auth, getAuth, createUserWithEmailAndPassword, signOut, User, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider} from 'firebase/auth';
import { Router } from '@angular/router';

// Copie sua config aqui para garantir que o SDK use o objeto puro
const firebaseConfig = {
  apiKey: "AIzaSyBD5AH1b1_p6AghhPx3Nr0fBVab8djRbkI",
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
export class FirebaseProducts {
  private db: Firestore;
  private authenticator: Auth;
  private storage;

  public usuarioLogado! : User | null
  public carregando : boolean = false



  constructor(private router : Router) {
    // Inicializa ou recupera o App SEM passar pelo sistema de injeção do Angular 21
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.storage = getStorage(app);
    this.authenticator = getAuth(app)

    this.usuarioLogado = this.getUser()
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
async signIn(email: string, password: string): Promise<boolean> {
  this.carregando = true;

  try {
    const userCredential = await createUserWithEmailAndPassword(this.authenticator, email, password);
    
    alert('cadastrado com sucesso!');
    console.log('O ID do usuário no sistema é: ' + userCredential.user.uid);
    
    this.router.navigate(['/tabs']);
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
  const provider = new GoogleAuthProvider();

  try {
    const result = await signInWithPopup(this.authenticator, provider);
    const user = result.user;
    
    alert('Bem-vindo, ' + user.displayName);
    this.router.navigate(['/tabs']);
    return true;
  } catch (error) {
    console.error("Erro ao logar com Google:", error);
    alert('Erro ao autenticar com o Google. Tente novamente.');
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

  resetPassword() {

  }

  getUser(): User | null {

    return this.authenticator.currentUser
  }

  async login(email: string , senha : string ) : Promise<boolean>{
        this.carregando = true

    try {
      await signInWithEmailAndPassword(this.authenticator, email, senha).then((usuario)=>{
      alert('Bem-vindo, ' + usuario.user.email +  '.' + ' Você é o usuário de ID : ' + usuario.user.uid)
      this.router.navigate(['/tabs'])
      })
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
}
