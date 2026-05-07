import { Component, QueryList, ViewChildren, OnInit, inject } from '@angular/core';
import { IonRouterOutlet, Platform, NavController } from '@ionic/angular';
import { App } from '@capacitor/app';
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

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  public usuario! : User | null;
  public appUser: AppUser | null = null;
  private fbProducts = inject(FirebaseProducts);
  private usersService = inject(FirebaseUsersService);
  private notifyService = inject(NotificationService);
  private presenceService = inject(PresenceService); 
  @ViewChildren(IonRouterOutlet) routerOutlets!: QueryList<IonRouterOutlet>;
  
  showSplash: boolean;
  splashAnimatingOut = false;
  
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
    // Atualização constante do usuário para a sidebar
    setInterval(async () => {
      const user = this.fbProducts.getUser();
      if (user) {
        this.usuario = user;
        const freshAppUser = await this.usersService.getUserById(user.uid);
        
        if (!freshAppUser) {
          // Documento não encontrado no Firestore (provável reset de base)
          // Redireciona para o login para evitar inconsistências
          console.warn('Usuário autenticado mas sem registro no banco. Redirecionando...');
          this.logout();
          return;
        }

        if (!this.appUser || this.appUser.uid !== user.uid) {
           this.appUser = freshAppUser;
        }
      } else {
        this.usuario = null;
        this.appUser = null;
      }
    }, 1500);

    this.restoreLastRoute();
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
          } else {
            this.navCtrl.navigateRoot('/login');
          }
        }
        return;
      }

      // Se estiver na raiz e tiver uma URL salva, tenta restaurar
      if (currentUrl === '/' || currentUrl === '/tabs' || currentUrl === '/tabs/tab2') {
        const user = this.fbProducts.getUser();
        
        // Se não tem usuário, manda pro login independente do que estiver salvo
        if (!user) {
          this.navCtrl.navigateRoot('/login');
          return;
        }

        // Verifica permissões se for admin
        if (lastUrl.includes('/admin') || lastUrl.includes('manage-')) {
          this.usersService.getUserById(user.uid).then(appUser => {
            if (appUser?.isAdmin || appUser?.super_admin) {
              this.navCtrl.navigateRoot(lastUrl);
            } else {
              this.navCtrl.navigateRoot('/tabs/tab2');
            }
          });
        } else {
          this.navCtrl.navigateRoot(lastUrl);
        }
      }
    }, 800);
  }

  logout() {
    this.fbProducts.signOut();
    this.router.navigate(['/login']);
  }

  initializeApp() {
    this.platform.ready().then(() => {
      // Inicializa Google Auth para Web/Native de forma segura
      // Usamos .catch() porque initialize() retorna uma Promise que pode rejeitar no navegador
      GoogleAuth.initialize().catch(e => {
        console.warn('Google Auth não inicializado (uso limitado ao celular ou se origin autorizada):', e);
      });

      // Fake Splash Screen Logic — só roda se a splash estiver visível
      if (this.showSplash) {
        setTimeout(() => {
          this.splashAnimatingOut = true;
          setTimeout(() => {
            this.showSplash = false;
            sessionStorage.setItem('compraki_splash_done', 'true');
          }, 600);
        }, 2500);
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
