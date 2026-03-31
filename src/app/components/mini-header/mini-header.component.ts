import { Component, OnInit, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { NgIf } from '@angular/common';

@Component({
  selector: 'app-mini-header',
  templateUrl: './mini-header.component.html',
  styleUrls: ['./mini-header.component.scss'],
  imports: [IonicModule, RouterLink, NgIf],
  standalone: true
})
export class MiniHeaderComponent  implements OnInit {
  @Input() theme: 'dark' | 'light' = 'dark';
  @Input() backUrl: string = '/';
  @Input() showBackButton: boolean = true;
  @Input() useChatIcon: boolean = false;

  constructor() { }

  ngOnInit() {}

}
