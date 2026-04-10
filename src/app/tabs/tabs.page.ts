import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonRouterOutlet } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { home, heart, add, cart, person } from 'ionicons/icons';
import { Auth } from '../services/auth';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonRouterOutlet, CommonModule, RouterLink]
})
export class TabsPage {

  constructor(public authService : Auth, public router : Router) {
    addIcons({ home, heart, add, cart, person });
    if (authService.isAuthenticated === false){
      // router.navigate(['sign-in'])
    }
  }

}
