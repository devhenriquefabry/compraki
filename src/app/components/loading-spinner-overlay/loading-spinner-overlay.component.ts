import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-loading-spinner-overlay',
  templateUrl: './loading-spinner-overlay.component.html',
  styleUrls: ['./loading-spinner-overlay.component.scss'],
  standalone: true,
  imports: [IonicModule]
})
export class LoadingSpinnerOverlayComponent  implements OnInit {

  constructor() { }

  ngOnInit() {}

}
