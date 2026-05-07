import { NgIf } from '@angular/common';
import { Component, OnInit, OnDestroy } from '@angular/core';
import {  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import {  Router, RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { LoadingSpinnerOverlayComponent } from 'src/app/components/loading-spinner-overlay/loading-spinner-overlay.component';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-login-form',
  templateUrl: './login-form.component.html',
  styleUrls: ['./login-form.component.scss'],
  imports: [IonicModule, ReactiveFormsModule, FormsModule, RouterLink, LoadingSpinnerOverlayComponent, NgIf],
  standalone: true,

})  
export class LoginFormComponent  implements OnInit, OnDestroy {

  loginForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  public isLoading : boolean = false;
  public loginSuccess: boolean = false;
  private usersSub?: Subscription;
  
  // Lista de usuários reais carregados do Firestore
  public testUsers: any[] = [];
  public defaultPassword = '123456'; // Senha padrão para testes

  constructor( 
    public firebaseProducts: FirebaseProducts,
    private usersService: FirebaseUsersService,
    private router: Router
  ) { }

  ngOnInit() {
    this.loginSuccess = false; // Reset state on initialization
    this.loadRealUsers();
    
    this.loginForm.valueChanges.subscribe((valores_dos_campos)=>{
      console.log(valores_dos_campos.email , valores_dos_campos.password)
    })
  }

  ngOnDestroy() {
    this.usersSub?.unsubscribe();
  }

  private loadRealUsers() {
    this.usersSub = this.usersService.getAllUsers().subscribe(users => {
      const mappedUsers = users.map(user => ({
        label: user.displayName || 'Usuário sem nome',
        email: user.email,
        password: this.defaultPassword,
        icon: user.isSeller ? 'storefront' : 'person'
      }));

      // Henrique dev account priority shortcut
      const devAccount = { 
        label: 'Henrique (Dev)', 
        email: 'dev.henriquefabry@gmail.com', 
        password: 'conde7/9', 
        icon: 'code-working' 
      };

      // Filter out devAccount if it's already in the list to avoid duplicates
      const otherUsers = mappedUsers.filter(u => u.email !== devAccount.email);
      
      this.testUsers = [devAccount, ...otherUsers];
    });
  }

  toggleIsLoading(){
    this.isLoading = !this.isLoading
  }

  selectTestUser(user: any) {
    this.loginForm.patchValue({
      email: user.email,
      password: user.password || this.defaultPassword
    });
  }

  loginWithTestUser(user: any) {
    this.selectTestUser(user);
    this.login();
  }

  login(){
    if (this.loginForm.valid) {
      if(this.loginForm.value.email &&  this.loginForm.value.password){
       this.firebaseProducts.login(this.loginForm.value.email , this.loginForm.value.password).then((salvouNoFirebaseMesmo)=>{
        if(salvouNoFirebaseMesmo === true){
          this.loginSuccess = true;
          this.loginForm.reset();
          
          setTimeout(() => {
            this.router.navigate(['/tabs']);
          }, 2000);
        }
       })

      }
    }
  }

  loginWithGoogle() {
    this.firebaseProducts.signInWithGoogle().then((salvouNoFirebaseMesmo) => {
      if (salvouNoFirebaseMesmo === true) {
        this.loginSuccess = true;
        this.loginForm.reset();
        
        setTimeout(() => {
          this.router.navigate(['/tabs']);
        }, 2000);
      }
    });
  }

  resetState() {
    this.loginSuccess = false;
    this.isLoading = false;
    this.loginForm.reset();
  }
}
