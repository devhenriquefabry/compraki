import { Component, Input, OnInit } from '@angular/core';
import { User } from 'firebase/auth';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ActionFooterComponent } from '../action-footer/action-footer.component';

@Component({
  selector: 'app-profile-card',
  templateUrl: './profile-card.component.html',
  styleUrls: ['./profile-card.component.scss'],
  imports: [IonicModule, RouterModule, CommonModule, ActionFooterComponent],
  standalone: true
})
export class ProfileCardComponent implements OnInit {
  @Input() usuario: User | null = null;

  constructor(private router: Router) {}

  ngOnInit() {}

  navigateToLogin() {
    this.router.navigate(['/sign-in']);
  }
}
