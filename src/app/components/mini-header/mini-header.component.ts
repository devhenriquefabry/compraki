import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-mini-header',
  templateUrl: './mini-header.component.html',
  styleUrls: ['./mini-header.component.scss'],
  imports: [IonicModule, RouterLink],
  standalone: true
})
export class MiniHeaderComponent  implements OnInit {

  constructor() { }

  ngOnInit() {}

}
