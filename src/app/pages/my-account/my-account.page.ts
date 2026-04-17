import { Component, inject, OnInit } from '@angular/core';
import { User } from 'firebase/auth';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { NavController } from '@ionic/angular';

@Component({
  selector: 'app-my-account',
  templateUrl: './my-account.page.html',
  styleUrls: ['./my-account.page.scss'],
  standalone: false
})
export class MyAccountPage implements OnInit {

  public usuario!: User | null;
  public firebaseService = inject(FirebaseProducts);
  private navCtrl = inject(NavController);

  constructor() { }

  ngOnInit() {
    setInterval(() => {
      this.usuario = this.firebaseService.getUser();
    }, 1000);
  }

  goToAddress() {
    this.navCtrl.navigateForward('/address');
  }

  goToPayments() {
    this.navCtrl.navigateForward('/payments');
  }

  logout() {
    this.firebaseService.signOut();
  }

}
