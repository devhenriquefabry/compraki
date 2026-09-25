import { Component, QueryList, ViewChildren, OnDestroy, OnInit, inject } from '@angular/core';
import { IonRouterOutlet, Platform, NavController } from '@ionic/angular';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { FirebaseProducts } from './services/firebase-products';
import { User } from 'firebase/auth';
import { AppUser } from './interfaces/app-user';
import { FirebaseUsersService } from './services/firebase-users.service';
import { addIcons } from 'ionicons';
import { 
  openOutline, heart, heartOutline, searchOutline, 
  informationCircleOutline, cartOutline, chatbubblesOutline, 
  addCircleOutline, cubeOutline, cashOutline, createOutline, 
  listOutline, personOutline, bagCheckOutline, keyOutline, 
  rocketOutline, flaskOutline, logOutOutline,
  person, mail, documentText, phonePortrait, lockClosed, 
  map, location, business, addCircle, navigate, flag, checkmark,
  serverOutline, closeOutline, logoWhatsapp, imagesOutline, images,
  cube, chatbubbles, paperPlane, paperPlaneOutline, refreshOutline,
  qrCodeOutline, phonePortraitOutline, sendOutline, scanOutline,
  documentTextOutline, shieldCheckmarkOutline, flashOutline,
  saveOutline, checkmarkCircleOutline, alertCircleOutline,
  syncOutline, closeCircleOutline, helpCircleOutline, trashOutline
} from 'ionicons/icons';

import { NotificationService } from './services/notification.service';
import { PresenceService } from './services/presence.service';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { isCurrentUserAdmin, onAuthUserChanged } from './core/auth-state';
import { LayoutService } from './core/layout.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit, OnDestroy {
  public usuario! : User | null;
  public appUser: AppUser | null = null;
  private fbProducts = inject(FirebaseProducts);
  private usersService = inject(FirebaseUsersService);
  private notifyService = inject(NotificationService);
  private presenceService = inject(PresenceService);
  /** Liga o header de site em telas grandes (só no navegador). */
  readonly layout = inject(LayoutService);
  @ViewChildren(IonRouterOutlet) routerOutlets!: QueryList<IonRouterOutlet>;
  
  private stopAuthWatch?: () => void;
  private stopUserDocWatch?: () => void;

  showSplash: boolean;
  /** Controla a visibilidade do menu ADMINISTRAÇÃO/AUTOMAÇÃO na sidebar. */
  isAdmin = false;
  
  constructor(
    private platform: Platform,
    private navCtrl: NavController,
    private router: Router
  ) {
    // Só mostra splash UMA VEZ por sessão do app
    const jaExibiu = sessionStorage.getItem('compraki_splash_done');
    this.showSplash = !jaExibiu;

    addIcons({ 
      'open-outline': openOutline,
      'heart': heart,
      'heart-outline': heartOutline,
      'search-outline': searchOutline, 
      'information-circle-outline': informationCircleOutline, 
      'cart-outline': cartOutline, 
      'chatbubbles-outline': chatbubblesOutline, 
      'add-circle-outline': addCircleOutline, 
      'cube-outline': cubeOutline, 
      'cash-outline': cashOutline, 
      'create-outline': createOutline, 
      'list-outline': listOutline, 
      'person-outline': personOutline, 
      'bag-check-outline': bagCheckOutline, 
      'key-outline': keyOutline, 
      'rocket-outline': rocketOutline, 
      'flask-outline': flaskOutline, 
      'log-out-outline': logOutOutline,
      'person': person,
      'mail': mail,
      'document-text': documentText,
      'phone-portrait': phonePortrait,
      'lock-closed': lockClosed,
      'map': map,
      'location': location,
      'business': business,
      'add-circle': addCircle,
      'navigate': navigate,
      'flag': flag,
      'checkmark': checkmark,
      'server-outline': serverOutline,
      'close-outline': closeOutline,
      'logo-whatsapp': logoWhatsapp,
      'images-outline': imagesOutline,
      'images': images,
      'cube': cube,
      'chatbubbles': chatbubbles,
      'paper-plane': paperPlane,
      'paper-plane-outline': paperPlaneOutline,
      'refresh-outline': refreshOutline,
      'qr-code-outline': qrCodeOutline,
      'phone-portrait-outline': phonePortraitOutline,
      'send-outline': sendOutline,
      'scan-outline': scanOutline,
      'document-text-outline': documentTextOutline,
      'shield-checkmark-outline': shieldCheckmarkOutline,
      'flash-outline': flashOutline,
      'save-outline': saveOutline,
      'checkmark-circle-outline': checkmarkCircleOutline,
      'alert-circle-outline': alertCircleOutline,
      'sync-outline': syncOutline,
      'close-circle-outline': closeCircleOutline,
      'help-circle-outline': helpCircleOutline,
      'trash-outline': trashOutline
    });
    this.initializeApp();
    this.notifyService.initOrderListener();
    this.setupRouteTracking();
  }

  ngOnInit() {
    this.watchCurrentUser();
    this.restoreLastRoute();
  }

  ngOnDestroy() {
    this.stopAuthWatch?.();
    this.stopUserDocWatch?.();
  }

  /**
   * Mantém `usuario` e `appUser` em dia para a sidebar.
   *
   * Antes isto era um `setInterval` de 1,5s que chamava `getUserById()` — ou
   * seja, ~40 leituras do Firestore por minuto por usuário logado, para sempre,
   * mesmo sem nada mudar. Agora são dois listeners: o Firebase avisa quando há
   * mudança, em vez de a gente perguntar.
   */
  private watchCurrentUser() {
    this.stopAuthWatch = onAuthUserChanged((user) => {
      this.usuario = user;

      // Troca de conta (ou logout): derruba o listener do documento anterior.
      this.stopUserDocWatch?.();
      this.stopUserDocWatch = undefined;

      if (!user) {
        this.appUser = null;
        this.isAdmin = false;
        return;
      }

      // Só decide o que mostrar na sidebar pelo claim `admin` do ID token —
      // nunca por `isAdmin` do documento, que é gravável pelo próprio dono.
      isCurrentUserAdmin().then(isAdmin => {
        this.isAdmin = isAdmin;
      });

      this.stopUserDocWatch = this.usersService.watchUser(user.uid, (appUser) => {
        if (!appUser) {
          // Autenticado mas sem registro no Firestore (provável reset de base).
          console.warn('Usuário autenticado mas sem registro no banco. Redirecionando...');
          this.logout();
          return;
        }

        this.appUser = appUser;
      });
    });
  }

  private setupRouteTracking() {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      const url = event.urlAfterRedirects;
      // Não salva páginas de login ou públicas se quisermos voltar para o "dashboard"
      const skipUrls = ['/login', '/sign-in', '/forgot-password', '/password-recovery'];
      if (!skipUrls.some(s => url.includes(s))) {
        localStorage.setItem('compraki_last_url', url);
      }
    });
  }

  private async restoreLastRoute() {
    const lastUrl = localStorage.getItem('compraki_last_url');
    
    // Pequeno delay para garantir que a plataforma e o roteador estão prontos
    setTimeout(() => {
      const currentUrl = this.router.url;
      
      // Se não houver URL salva, define o padrão (Login ou Tab2)
      if (!lastUrl) {
        if (currentUrl === '/' || currentUrl === '/tabs' || currentUrl === '/tabs/tab2') {
          const user = this.fbProducts.getUser();
          if (user) {
            this.navCtrl.navigateRoot('/tabs/tab2');
          } else if (Capacitor.isNativePlatform()) {
            // No navegador a vitrine é aberta a visitantes (ver `storefrontGuard`).
            this.navCtrl.navigateRoot('/login');
          }
        }
        return;
      }

      // Se estiver na raiz e tiver uma URL salva, tenta restaurar
      if (currentUrl === '/' || currentUrl === '/tabs' || currentUrl === '/tabs/tab2') {
        const user = this.fbProducts.getUser();
        
        // Sem usuário: no app vai pro login; no navegador fica na vitrine.
        if (!user) {
          if (Capacitor.isNativePlatform()) this.navCtrl.navigateRoot('/login');
          return;
        }

        // Restaurar rota administrativa exige o claim `admin` no ID token.
        // Ler `isAdmin` do documento não vale como autorização: o campo é
        // gravável pelo próprio dono.
        if (lastUrl.includes('/admin') || lastUrl.includes('manage-')) {
          isCurrentUserAdmin().then(isAdmin => {
            this.navCtrl.navigateRoot(isAdmin ? lastUrl : '/tabs/tab2');
          });
        } else {
          this.navCtrl.navigateRoot(lastUrl);
        }
      }
    }, 800);
  }

  onSplashDone() {
    this.showSplash = false;
    sessionStorage.setItem('compraki_splash_done', 'true');
    // Fundo azul-noite da abertura (ver <script> no index.html).
    document.documentElement.classList.remove('vn-booting');
  }

  logout() {
    this.fbProducts.signOut();
    this.router.navigate(['/login']);
  }

  initializeApp() {
    this.platform.ready().then(() => {
      // Só inicializa no Android/iOS: é o plugin nativo do Google (SDK do
      // sistema), sem relação com o gapi.auth2 do navegador. No navegador o
      // login usa signInWithPopup do próprio Firebase (ver
      // firebase-products.ts), então chamar initialize() aqui só geraria um
      // idpiframe_initialization_failed sem propósito — o Google desligou o
      // gapi.auth2 para Client IDs novos.
      if (Capacitor.isNativePlatform()) {
        GoogleAuth.initialize().catch(e => {
          console.warn('Google Auth nativo não inicializado:', e);
        });
      }

      this.platform.backButton.subscribeWithPriority(10, () => {
        let canGoBack = false;
        
        // Verifica se qualquer um dos outlets ativos pode voltar
        this.routerOutlets.forEach((outlet: IonRouterOutlet) => {
          if (outlet && outlet.canGoBack()) {
            canGoBack = true;
          }
        });

        if (canGoBack) {
          this.navCtrl.back();
        } else {
          // Só fecha o app se estiver em rotas consideradas "raízes"
          const rootRoutes = ['/tabs/tab2', '/login', '/home', '/', ''];
          const currentUrl = this.router.url.split('?')[0]; // Remove query params

          if (rootRoutes.includes(currentUrl)) {
            App.exitApp();
          } else {
            // Se não for rota raiz mas não tem história no outlet, 
            // tenta voltar para a aba principal
            this.navCtrl.navigateRoot('/tabs/tab2');
          }
        }
      });
    });
  }
}
