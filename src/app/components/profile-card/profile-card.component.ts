import { Component, Input, OnInit } from '@angular/core';
import { User } from 'firebase/auth';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-profile-card',
  templateUrl: './profile-card.component.html',
  styleUrls: ['./profile-card.component.scss'],
  imports: [IonicModule],
  standalone: true
})
export class ProfileCardComponent implements OnInit {
  @Input() usuario: User | null = null;

  constructor() {}

  ngOnInit() {}
}
