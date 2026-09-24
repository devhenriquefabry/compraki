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
  orderBy,
  limit,
  startAfter,
  getDocs,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot
} from 'firebase/firestore';

import { getDownloadURL, ref, getStorage, uploadBytes } from 'firebase/storage';
import { Product } from '../interfaces/product';
import { isProductHidden } from '../core/product-moderation';

import { Observable, from, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { AppAddress } from '../interfaces/app-user';
import { Auth, getAuth, createUserWithEmailAndPassword, signOut, User, signInWithEmailAndPassword, signInWithCredential, signInWithPopup, GoogleAuthProvider, onAuthStateChanged} from 'firebase/auth';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { Capacitor } from '@capacitor/core';
import { Router } from '@angular/router';
import { FirebaseUsersService } from './firebase-users.service';
import { WhatsappInstancesService } from './whatsapp-instances.service';
import { environment } from '../../environments/environment';

const SUSPENDED_ACCOUNT_MESSAGE =
  'Esta conta foi suspensa por violar os termos de uso do Vineon. Se acha que foi um engano, fale com o suporte.';

/** Uma pagina do catalogo, com o cursor para pedir a proxima. */
export interface ProductPage {
  products: Product[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}


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
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
    this.storage = getStorage(app);
    this.authenticator = getAuth(app)

    // Listener para manter o estado do usuário sempre sincronizado
    onAuthStateChanged(this.authenticator, async (user) => {
      this.usuarioLogado = user;
      console.log('Estado de autenticação alterado. Usuário:', user?.email);
      
      if (user) {
        // 🔥 Garante que o usuário esteja no Firestore e COM STATUS ADMIN LIBERADO
        // Isso resolve o erro 403 em sessões persistentes sem precisar de novo login
        await this.usersService.ensureAppUserDocument(user);
      }
    });
  }

  // ==========================================================================
  // LEITURA
  //
  // Regra desta seção: todo Observable de leitura passa por `shareReplay`.
  //
  // Os Observables criados com `new Observable()` em volta de `onSnapshot` são
  // FRIOS: cada `subscribe` abre uma conexão nova. Como o template usa o pipe
  // `async`, cada `| async` contava como um subscribe — a tela de detalhe do
  // produto chegava a abrir 17 listeners, vários no mesmo documento. Com
  // `shareReplay({ bufferSize: 1, refCount: true })` todos compartilham um
  // listener só, e ele fecha quando o último inscrito sai.
  // ==========================================================================

  /** Cache de streams por chave, para que a partilha sobreviva entre telas. */
  private readonly productStreamCache = new Map<string, Observable<Product | null>>();
  private readonly sellerStreamCache = new Map<string, Observable<Product[]>>();
  private allProductsStream?: Observable<Product[]>;

  private mapSnapshot(snapshot: QuerySnapshot<DocumentData>): Product[] {
    return snapshot.docs.map(d => ({ ...(d.data() as any), id: d.id } as Product));
  }

  /** Vitrine não mostra anúncio fora do ar por moderação (`product.moderation`). */
  private visible(products: Product[]): Product[] {
    return products.filter(p => !isProductHidden(p));
  }

  /**
   * Catálogo inteiro, em tempo real.
   *
   * @deprecated Para listas, prefira `getPage()`; para achar UM produto, use
   * `getById()`. Este método transmite a coleção `products` completa e
   * retransmite tudo a cada alteração em qualquer produto — o custo cresce
   * junto com o catálogo. Ainda é usado pela vitrine principal, que será
   * migrada para rolagem paginada.
   */
  getAll(includeHidden = false): Observable<Product[]> {
    if (!this.allProductsStream) {
      this.allProductsStream = new Observable<Product[]>(subscriber => {
        const productCol = collection(this.db, 'products');
        return onSnapshot(
          productCol,
          (snapshot) => subscriber.next(this.mapSnapshot(snapshot)),
          (err) => subscriber.error(err)
        );
      }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    }

    // O painel admin (`includeHidden`) precisa ver o que está fora do ar.
    return includeHidden
      ? this.allProductsStream
      : this.allProductsStream.pipe(map(products => this.visible(products)));
  }

  /**
   * Uma página do catálogo. Substitui `getAll()` onde só se exibe uma lista.
   *
   * Leitura pontual (`getDocs`), não listener: a vitrine não precisa reagir a
   * cada edição de produto alheio, e um listener sobre a coleção inteira é o
   * padrão mais caro possível.
   *
   * @param cursor último documento da página anterior, para continuar dali.
   */
  async getPage(options: {
    pageSize?: number;
    cursor?: QueryDocumentSnapshot<DocumentData> | null;
    categoryId?: string;
    sellerId?: string;
  } = {}): Promise<ProductPage> {
    const pageSize = options.pageSize ?? 24;
    const constraints: QueryConstraint[] = [];

    if (options.categoryId) {
      constraints.push(where('categoryIds', 'array-contains', options.categoryId));
    }

    if (options.sellerId) {
      constraints.push(where('sellerId', '==', options.sellerId));
    }

    constraints.push(orderBy('createdAt', 'desc'));

    if (options.cursor) {
      constraints.push(startAfter(options.cursor));
    }

    // Pede um a mais para saber se existe próxima página sem uma consulta extra.
    constraints.push(limit(pageSize + 1));

    const snapshot = await getDocs(query(collection(this.db, 'products'), ...constraints));
    const docs = snapshot.docs.slice(0, pageSize);

    return {
      products: this.visible(docs.map(d => ({ ...(d.data() as any), id: d.id } as Product))),
      cursor: docs.length > 0 ? docs[docs.length - 1] : null,
      hasMore: snapshot.docs.length > pageSize
    };
  }

  /**
   * Produtos relacionados, por categoria em comum.
   *
   * A tela de detalhe chamava `getAll()` e descartava o resto com `.slice(0,10)`
   * — o catálogo inteiro trafegava para exibir dez itens.
   */
  getRelated(product: Product | null, max = 10): Observable<Product[]> {
    if (!product?.categoryIds?.length) return of([]);

    // `array-contains-any` aceita no máximo 30 valores por consulta.
    const categories = product.categoryIds.slice(0, 30);

    const q = query(
      collection(this.db, 'products'),
      where('categoryIds', 'array-contains-any', categories),
      limit(max + 1) // margem para descartar o próprio produto
    );

    return from(getDocs(q)).pipe(
      map(snapshot => this.visible(this.mapSnapshot(snapshot))
        .filter(p => p.id !== product.id)
        .slice(0, max)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /** Um produto, em tempo real. Streams são compartilhados por id. */
  getById(id: string): Observable<Product | null> {
    const cached = this.productStreamCache.get(id);
    if (cached) return cached;

    const stream = new Observable<Product | null>(subscriber => {
      const productDoc = doc(this.db, 'products', id);

      return onSnapshot(
        productDoc,
        (snapshot) => subscriber.next(
          snapshot.exists()
            ? ({ ...(snapshot.data() as any), id: snapshot.id } as Product)
            : null
        ),
        (err) => subscriber.error(err)
      );
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.productStreamCache.set(id, stream);
    return stream;
  }

  /**
   * Produtos de um vendedor, em tempo real. Compartilhado por sellerId.
   *
   * @param includeHidden `true` nas telas do próprio vendedor (Meus anúncios,
   * editar), que mostram também o que a moderação tirou do ar.
   */
  getBySeller(sellerId: string, includeHidden = false): Observable<Product[]> {
    const stream = this.sellerStream(sellerId);
    return includeHidden ? stream : stream.pipe(map(products => this.visible(products)));
  }

  private sellerStream(sellerId: string): Observable<Product[]> {
    const cached = this.sellerStreamCache.get(sellerId);
    if (cached) return cached;

    const stream = new Observable<Product[]>(subscriber => {
      const q = query(
        collection(this.db, 'products'),
        where('sellerId', '==', sellerId),
        orderBy('createdAt', 'desc')
      );

      return onSnapshot(
        q,
        (snapshot) => subscriber.next(this.mapSnapshot(snapshot)),
        (err) => subscriber.error(err)
      );
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.sellerStreamCache.set(sellerId, stream);
    return stream;
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

  /** Grava só os campos informados (ex.: preço e estoque pela tela do anúncio). */
  updateFields(id: string, fields: { price?: number; priceDiscounted?: number | null; stock?: number }) {
    return updateDoc(doc(this.db, 'products', id), { ...fields, updatedAt: new Date() });
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
      const createdAt = new Date();
      
      // Atualiza o perfil no Auth com o nome fornecido
      await updateProfile(userCredential.user, {
        displayName: name
      });

      // 🔥 Espelhando o usuário no Firestore passivamente com dados extras
      await this.usersService.ensureAppUserDocument(userCredential.user, {
          cpf: cpf || null,
          phoneNumber: phone || null,
          displayName: name,
          address: address || undefined,
          createdAt: createdAt.toISOString()
      });

      void this.dispatchWhatsappTriggerSafe('account_created', {
        nome: name,
        email,
        telefone: phone || '',
        cpf: cpf || '',
        cep: address?.cep || '',
        rua: address?.street || '',
        numero: address?.number || '',
        complemento: address?.complement || 'Nao informado',
        bairro: address?.neighborhood || '',
        cidade: address?.city || '',
        uf: address?.state || '',
        uid: userCredential.user.uid,
        usuario: userCredential.user.uid,
        perfil: 'vendedor',
        admin: true,
        vendedor: true,
        endereco: this.formatAddressForWhatsapp(address),
        criadoEm: createdAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
        origem: 'cadastro_email_senha',
        photoURL: userCredential.user.photoURL || ''
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
  try {
    // Sem spinner enquanto a escolha de conta está aberta: se o usuário fecha
    // o popup no "x", o Chrome bloqueia o `popup.closed` (COOP da página do
    // Google) e o signInWithPopup às vezes nunca rejeita — o overlay ficaria
    // travado para sempre. Com a tela livre, basta clicar de novo: o Firebase
    // cancela o popup pendente (auth/cancelled-popup-request) e abre outro.
    const user = Capacitor.isNativePlatform()
      ? await this.signInWithGoogleNative()
      : await this.signInWithGoogleWeb();

    this.carregando = true;

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
    if (this.isGoogleSignInCancel(error)) {
      return false;
    }
    console.error("Erro ao logar com Google:", error);
    alert(this.isSuspendedAccount(error)
      ? SUSPENDED_ACCOUNT_MESSAGE
      : 'Não foi possível entrar com o Google agora. Tente novamente ou use e-mail e senha.');
    return false;
  } finally {
    this.carregando = false;
  }
}

/** Conta derrubada pelo admin (`setAccountSuspension` desativa o usuário no Auth). */
private isSuspendedAccount(error: unknown): boolean {
  return String((error as { code?: unknown } | null)?.code ?? '') === 'auth/user-disabled';
}

/** Usuário desistiu (fechou o popup/bandeja ou abriu outro): não é erro. */
private isGoogleSignInCancel(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code ?? '');
  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/user-cancelled' ||
    code === '12501' // Android: GoogleSignInStatusCodes.SIGN_IN_CANCELLED
  ) {
    return true;
  }
  return /cancel/i.test(String(e?.message ?? ''));
}

/** Android/iOS: bandeja nativa do Google, via SDK do próprio sistema. */
private async signInWithGoogleNative(): Promise<User> {
  const googleUser = await GoogleAuth.signIn();

  if (!googleUser.authentication.idToken) {
    throw new Error("Falha ao recuperar idToken do Google.");
  }

  const credential = GoogleAuthProvider.credential(googleUser.authentication.idToken);
  return (await signInWithCredential(this.authenticator, credential)).user;
}

/**
 * Navegador: popup do próprio Firebase Auth, não a biblioteca antiga do
 * Google (gapi.auth2, usada por @codetrix-studio/capacitor-google-auth na
 * versão web). O Google desligou esse fluxo antigo para Client IDs criados
 * de uns tempos pra cá — dá "idpiframe_initialization_failed" mesmo com a
 * origem cadastrada certa no Console. signInWithPopup não depende dela.
 */
private async signInWithGoogleWeb(): Promise<User> {
  return (await signInWithPopup(this.authenticator, new GoogleAuthProvider())).user;
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
      alert(this.isSuspendedAccount(error)
        ? SUSPENDED_ACCOUNT_MESSAGE
        : 'erro ao fazer login, verifique suas credenciais e tente novamente')
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

  private formatAddressForWhatsapp(address?: AppAddress): string {
    if (!address) return 'Nao informado';
    return [
      address.street,
      address.number,
      address.complement,
      address.neighborhood,
      address.city,
      address.state,
      address.cep
    ]
      .filter(Boolean)
      .join(', ');
  }

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
    const baseUrl = environment.functionsBaseUrl;
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
