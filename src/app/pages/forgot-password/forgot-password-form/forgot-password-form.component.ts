import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-forgot-password-form',
  templateUrl: './forgot-password-form.component.html',
  styleUrls: ['./forgot-password-form.component.scss'],
  imports: [RouterLink, IonicModule],
  standalone: true

})
export class ForgotPasswordFormComponent  implements OnInit {

  constructor() { }

  ngOnInit() {}

}
