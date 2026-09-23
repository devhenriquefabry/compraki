import { NgIf } from '@angular/common';
import { Component, OnInit, OnDestroy } from '@angular/core';
import {  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { safeRedirectTarget } from 'src/app/core/auth-redirect';
import { IonicModule } from '@ionic/angular';
import { LoadingSpinnerOverlayComponent } from 'src/app/components/loading-spinner-overlay/loading-spinner-overlay.component';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { Subscription } from 'rxjs';
import { environment } from 'src/environments/environment';

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
  
  // Atalho de contas de teste: so existe fora de producao. As regras do
  // Firestore nao deixam visitante listar /users (e dado pessoal), entao em
  // producao a lista nunca carregaria — e nao deve aparecer para o publico.
  public readonly showTestAccounts = !environment.production;
  public testUsersError = false;

  // Lista de usuários reais carregados do Firestore
  public testUsers: any[] = [];
  public defaultPassword = '123456'; // Senha padrão para testes

  constructor( 
    public firebaseProducts: FirebaseProducts,
    private usersService: FirebaseUsersService,
    private router: Router,
    private route: ActivatedRoute
  ) { }

  ngOnInit() {
    this.loginSuccess = false; // Reset state on initialization
    if (this.showTestAccounts) {
      this.loadRealUsers();
    }
    
    this.loginForm.valueChanges.subscribe((valores_dos_campos)=>{
      console.log(valores_dos_campos.email , valores_dos_campos.password)
    })
  }

  ngOnDestroy() {
    this.usersSub?.unsubscribe();
  }

  private loadRealUsers() {
    this.usersSub = this.usersService.getAllUsers().subscribe({ next: users => {
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
        icon: 'code-working' 
      };

      // Filter out devAccount if it's already in the list to avoid duplicates
      const otherUsers = mappedUsers.filter(u => u.email !== devAccount.email);
      
      this.testUsers = [devAccount, ...otherUsers];
    }, error: err => {
      // Sem permissao para listar /users (visitante nao logado ou nao admin).
      console.warn('Contas de teste indisponiveis:', err?.code ?? err);
      this.testUsersError = true;
    } });
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
            this.router.navigateByUrl(safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirectTo')));
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
          this.router.navigateByUrl(safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirectTo')));
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
