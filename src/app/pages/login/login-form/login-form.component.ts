
import { NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import {  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import {  RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { LoadingSpinnerOverlayComponent } from 'src/app/components/loading-spinner-overlay/loading-spinner-overlay.component';
import { FirebaseProducts } from 'src/app/services/firebase-products';

@Component({
  selector: 'app-login-form',
  templateUrl: './login-form.component.html',
  styleUrls: ['./login-form.component.scss'],
  imports: [IonicModule, ReactiveFormsModule, RouterLink, LoadingSpinnerOverlayComponent, NgIf],
  standalone: true,

})  
export class LoginFormComponent  implements OnInit {

  loginForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  public isLoading : boolean = false;
  constructor( public firebaseProducts:FirebaseProducts) { }

  ngOnInit() {
    this.loginForm.valueChanges.subscribe((valores_dos_campos)=>{

      console.log(valores_dos_campos.email , valores_dos_campos.password)
    })

  }

  toggleIsLoading(){
    this.isLoading = !this.isLoading
  }

  login(){
    if (this.loginForm.valid) {
      if(this.loginForm.value.email &&  this.loginForm.value.password){
       this.firebaseProducts.login(this.loginForm.value.email , this.loginForm.value.password).then((salvouNoFirebaseMesmo)=>{
        if(salvouNoFirebaseMesmo === true){
          this.loginForm.reset()
        }
       })

      }
    
  }
  }
}
