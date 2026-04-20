import { Component, QueryList, ViewChildren, OnInit, inject } from '@angular/core';
import { IonRouterOutlet, Platform, NavController } from '@ionic/angular';
import { App } from '@capacitor/app';
import { Router } from '@angular/router';
import { FirebaseProducts } from './services/firebase-products';
import { User } from 'firebase/auth';
import { addIcons } from 'ionicons';
import { 
  openOutline, heart, heartOutline, searchOutline, 
  informationCircleOutline, cartOutline, chatbubblesOutline, 
  addCircleOutline, cubeOutline, cashOutline, createOutline, 
  listOutline, personOutline, bagCheckOutline, keyOutline, 
  rocketOutline, flaskOutline, logOutOutline,
  person, mail, documentText, phonePortrait, lockClosed, 
  map, location, business, addCircle, navigate, flag, checkmark,
  serverOutline, closeOutline
} from 'ionicons/icons';

import { NotificationService } from './services/notification.service';
import { PresenceService } from './services/presence.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  public usuario! : User | null;
  private fbProducts = inject(FirebaseProducts);
  private notifyService = inject(NotificationService);
  private presenceService = inject(PresenceService); // Inicializa o rastreamento global
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
      'close-outline': closeOutline
    });
    this.initializeApp();
    this.notifyService.initOrderListener();
  }

  ngOnInit() {
    // Atualização constante do usuário para a sidebar
    setInterval(() => {
      const user = this.fbProducts.getUser();
      if (user) {
        this.usuario = user;
      }
    }, 1000);
  }

  logout() {
    this.fbProducts.signOut();
    this.router.navigate(['/login']);
  }

  initializeApp() {
    this.platform.ready().then(() => {
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
