import { Component } from '@angular/core';
import { Auth } from '../services/auth';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: false,
})
export class TabsPage {

  constructor(public authService : Auth, public router : Router) {
    if (authService.isAuthenticated === false){
      // router.navigate(['sign-in'])
    }
  }

}
