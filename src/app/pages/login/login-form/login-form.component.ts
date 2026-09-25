import { ChangeDetectorRef, Component, OnInit, OnDestroy } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { safeRedirectTarget } from 'src/app/core/auth-redirect';
import { IonicModule } from '@ionic/angular';
import { VineonLogoComponent } from 'src/app/components/vineon-logo/vineon-logo.component';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { Subscription } from 'rxjs';
import { environment } from 'src/environments/environment';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
/** Tempo do "Tudo certo ✓" no botão antes de seguir. */
const DONE_DELAY_MS = 700;

@Component({
  selector: 'app-login-form',
  templateUrl: './login-form.component.html',
  styleUrls: ['../../../../theme/auth.scss', './login-form.component.scss'],
  imports: [IonicModule, ReactiveFormsModule, FormsModule, RouterLink, VineonLogoComponent],
  standalone: true,
})
export class LoginFormComponent implements OnInit, OnDestroy {

  loginForm = new FormGroup({
    email: new FormControl('', { nonNullable: true }),
    password: new FormControl('', { nonNullable: true }),
  });

  public status: 'idle' | 'loading' | 'done' = 'idle';
  public googleLoading = false;
  public showPassword = false;
  public emailError = '';
  public passwordError = '';
  /** Falha que não é de um campo só: credencial errada, rede, conta suspensa. */
  public formError = '';

  private subs = new Subscription();
  private redirectTimer?: ReturnType<typeof setTimeout>;

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
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit() {
    if (this.showTestAccounts) {
      this.loadRealUsers();
    }

    // O erro de cada campo some assim que a pessoa volta a digitar nele.
    const { email, password } = this.loginForm.controls;
    this.subs.add(email.valueChanges.subscribe(() => { this.emailError = ''; this.formError = ''; }));
    this.subs.add(password.valueChanges.subscribe(() => { this.passwordError = ''; this.formError = ''; }));
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    clearTimeout(this.redirectTimer);
  }

  private loadRealUsers() {
    this.subs.add(this.usersService.getAllUsers().subscribe({ next: users => {
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
    } }));
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

  async login() {
    if (this.status !== 'idle' || this.googleLoading) return;

    const email = this.loginForm.controls.email.value.trim();
    const password = this.loginForm.controls.password.value;
    this.emailError = EMAIL_RE.test(email) ? '' : 'Digite um e-mail válido';
    this.passwordError = password.length >= 6 ? '' : 'A senha precisa de pelo menos 6 caracteres';
    this.formError = '';
    if (this.emailError || this.passwordError) return;

    this.status = 'loading';
    try {
      await this.firebaseProducts.login(email, password);
      this.finish();
    } catch (error) {
      this.status = 'idle';
      this.formError = (error as Error).message;
    }
    this.cdr.markForCheck();
  }

  async loginWithGoogle() {
    if (this.status !== 'idle' || this.googleLoading) return;
    this.formError = '';
    this.googleLoading = true;
    try {
      const entrou = await this.firebaseProducts.signInWithGoogle();
      this.googleLoading = false;
      if (entrou) this.finish();
    } catch (error) {
      this.googleLoading = false;
      this.formError = (error as Error).message;
    }
    this.cdr.markForCheck();
  }

  /** "Tudo certo ✓" no botão e segue para onde a pessoa ia (ou a vitrine). */
  private finish() {
    this.status = 'done';
    this.redirectTimer = setTimeout(() => {
      this.router.navigateByUrl(safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirectTo')));
    }, DONE_DELAY_MS);
  }

  resetState() {
    clearTimeout(this.redirectTimer);
    this.status = 'idle';
    this.googleLoading = false;
    this.showPassword = false;
    this.loginForm.reset();
    this.emailError = this.passwordError = this.formError = '';
  }
}
