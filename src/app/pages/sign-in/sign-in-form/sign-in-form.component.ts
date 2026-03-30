import { NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { LoadingSpinnerOverlayComponent } from 'src/app/components/loading-spinner-overlay/loading-spinner-overlay.component';
import { FirebaseProducts } from 'src/app/services/firebase-products';

@Component({
  selector: 'app-sign-in-form',
  templateUrl: './sign-in-form.component.html',
  styleUrls: ['./sign-in-form.component.scss'],
  standalone: true,
  imports: [IonicModule, RouterLink, ReactiveFormsModule, NgIf, LoadingSpinnerOverlayComponent]
})

export class SignInFormComponent implements OnInit {

  public formularioValido: boolean = false

  signInForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    repeatPassword: new FormControl('', { nonNullable: true, validators: [Validators.required] }),



  })
  constructor(public firebaseProducts: FirebaseProducts) { }


  ngOnInit() {
    this.signInForm.valid
    this.signInForm.valueChanges.subscribe(() => {
      if (this.signInForm.valid) {
        this.formularioValido = true
      }
      else {
        this.formularioValido = false
      }
      console.log(this.signInForm.value)
    })
  }

  callSignInFunction() {
    if (this.signInForm.valid) {
      if (this.signInForm.value.email && this.signInForm.value.password) {
        this.firebaseProducts.signIn(this.signInForm.value.email, this.signInForm.value.password).then((salvouNoFirebaseMesmo) => {
          if (salvouNoFirebaseMesmo === true) {
            this.signInForm.reset()
          }
        })
      }
    }
  }

  public callSignInGoogleFunction () {
    this.firebaseProducts.signInWithGoogle().then((salvouNoFirebaseMesmo)=> {
      if (salvouNoFirebaseMesmo === true) {
            this.signInForm.reset()
          }
    })
  }
}
