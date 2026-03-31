import { Component, inject, OnInit } from '@angular/core';
import { Notifications } from 'src/app/interfaces/notifications';
import { Product } from 'src/app/interfaces/product';
import { User } from 'firebase/auth';
import { FirebaseProducts } from 'src/app/services/firebase-products';

@Component({
  selector: 'app-my-account',
  templateUrl: './my-account.page.html',
  styleUrls: ['./my-account.page.scss'],
  standalone: false
})
export class MyAccountPage implements OnInit {

  public usuario!: User | null;
  public firebaseService = inject(FirebaseProducts);

  constructor() { }

  ngOnInit() {
    setInterval(() => {
      this.usuario = this.firebaseService.getUser();
    }, 1000);
  }

  logout() {
    this.firebaseService.signOut();
  }

}
