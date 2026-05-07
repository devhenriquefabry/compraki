import { Component, OnInit, ViewChild } from '@angular/core';
import { LoginFormComponent } from './login-form/login-form.component';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage implements OnInit {
  @ViewChild(LoginFormComponent) loginForm!: LoginFormComponent;

  constructor() { }

  ngOnInit() {
  }

  ionViewWillEnter() {
    if (this.loginForm) {
      this.loginForm.resetState();
    }
  }
}
