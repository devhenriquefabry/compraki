import { Component, OnInit, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { NgIf, AsyncPipe } from '@angular/common';
import { FirebaseCartService } from '../../services/firebase-cart.service';
import { FirebaseSavedService } from '../../services/firebase-saved.service';
import { NavController } from '@ionic/angular';

@Component({
  selector: 'app-mini-header',
  templateUrl: './mini-header.component.html',
  styleUrls: ['./mini-header.component.scss'],
  imports: [IonicModule, RouterLink, NgIf, AsyncPipe],
  standalone: true
})
export class MiniHeaderComponent  implements OnInit {
  @Input() theme: 'dark' | 'light' = 'dark';
  @Input() backUrl: string = '/';
  @Input() showBackButton: boolean = true;
  @Input() showMenuButton: boolean = true;
  @Input() useChatIcon: boolean = false;

  constructor(
    public cartService: FirebaseCartService,
    public savedService: FirebaseSavedService,
    private navCtrl: NavController
  ) { }

  ngOnInit() {}

  goBack() {
    this.navCtrl.back();
  }

}
