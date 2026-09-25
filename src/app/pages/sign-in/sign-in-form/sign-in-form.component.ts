import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { safeRedirectTarget } from 'src/app/core/auth-redirect';
import { IonicModule } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmark } from 'ionicons/icons';
import { VineonLogoComponent } from 'src/app/components/vineon-logo/vineon-logo.component';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { AddressService } from 'src/app/services/address.service';
import { AppAddress } from 'src/app/interfaces/app-user';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

type FieldName =
  | 'name' | 'email' | 'cpf' | 'phone' | 'password' | 'repeatPassword'
  | 'cep' | 'street' | 'number' | 'complement' | 'neighborhood' | 'city' | 'state';

@Component({
  selector: 'app-sign-in-form',
  templateUrl: './sign-in-form.component.html',
  styleUrls: ['../../../../theme/auth.scss', './sign-in-form.component.scss'],
  standalone: true,
  imports: [IonicModule, RouterLink, ReactiveFormsModule, VineonLogoComponent]
})
export class SignInFormComponent implements OnInit, OnDestroy {
  public currentStep: number = 1;
  public totalSteps: number = 3;
  public registrationSuccess: boolean = false;
  public status: 'idle' | 'loading' = 'idle';
  public googleLoading = false;
  public showPassword = false;
  /** Erro de cada campo, mostrado embaixo dele; some quando a pessoa volta a digitar. */
  public errors: Partial<Record<FieldName, string>> = {};
  /** Falha que não é de um campo só (e-mail já cadastrado, rede). */
  public formError = '';
  private redirectTimer?: ReturnType<typeof setTimeout>;
  private removeDevAutofillShortcutListener?: () => void;

  signInForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    cpf: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(11)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    repeatPassword: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    
    // Address fields
    cep: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
    street: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    number: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    complement: new FormControl('', { nonNullable: true }),
    neighborhood: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    state: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  })

  readonly stepTitles = ['Crie sua conta', 'Crie uma senha', 'Onde você está?'];
  readonly stepSubtitles = [
    'Leva menos de um minuto. Comece pelos seus dados.',
    'É com ela e o seu e-mail que você vai entrar.',
    'Usamos o endereço para mostrar ofertas perto de você e calcular o frete.',
  ];
  readonly stepNames = ['Seus dados', 'Segurança', 'Endereço'];

  get stepTitle() { return this.stepTitles[this.currentStep - 1]; }
  get stepSubtitle() { return this.stepSubtitles[this.currentStep - 1]; }
  get stepName() { return this.stepNames[this.currentStep - 1]; }

  constructor(
    public firebaseProducts: FirebaseProducts,
    private addressService: AddressService,
    private router: Router,
    private route: ActivatedRoute,
    private changeDetectorRef: ChangeDetectorRef
  ) { }


  ngOnInit() {
    addIcons({ checkmark });

    for (const [name, control] of Object.entries(this.signInForm.controls)) {
      control.valueChanges.subscribe(() => {
        if (this.errors[name as FieldName]) {
          this.errors = { ...this.errors, [name]: undefined };
        }
        this.formError = '';
      });
    }

    const devAutofillShortcutListener = (event: KeyboardEvent) => this.handleDevAutofillShortcut(event);
    document.addEventListener('keydown', devAutofillShortcutListener, true);
    this.removeDevAutofillShortcutListener = () => {
      document.removeEventListener('keydown', devAutofillShortcutListener, true);
    };

    // Restaurando observador de CEP
    this.signInForm.get('cep')?.valueChanges.subscribe(cep => {
      const cleanCep = cep?.replace(/\D/g, '') || '';
      if (cleanCep.length === 8) {
        this.fillAddressFromCEP(cleanCep);
      }
    });
  }

  ngOnDestroy(): void {
    this.removeDevAutofillShortcutListener?.();
    clearTimeout(this.redirectTimer);
  }

  handleDevAutofillShortcut(event: KeyboardEvent): void {
    if (!this.isDevAutofillShortcut(event) || this.registrationSuccess) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.autofillRandomRegistrationData();
  }

  private isDevAutofillShortcut(event: KeyboardEvent): boolean {
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) {
      return false;
    }

    const acceptedKeys = new Set(['\'', '"', 'Dead', '´', '`']);
    const acceptedCodes = new Set(['Quote', 'Backquote', 'IntlRo', 'IntlBackslash', 'BracketLeft', 'BracketRight']);
    return acceptedKeys.has(event.key) || acceptedCodes.has(event.code);
  }

  private autofillRandomRegistrationData(): void {
    const firstNames = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'Lucas'];
    const lastNames = ['Silva', 'Santos', 'Oliveira', 'Costa', 'Pereira', 'Almeida', 'Souza', 'Ferreira', 'Lima', 'Gomes'];
    const streets = ['Rua das Palmeiras', 'Avenida Brasil', 'Rua Sao Jose', 'Rua das Flores', 'Avenida Getulio Vargas'];
    const neighborhoods = ['Centro', 'Santo Antonio', 'Bom Pastor', 'Santa Luzia', 'Nova Cidade'];
    const cities = ['Manhuacu', 'Belo Horizonte', 'Vitoria', 'Juiz de Fora', 'Caratinga'];
    const states = ['MG', 'ES', 'RJ', 'SP'];

    const randomItem = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
    const randomDigits = (length: number): string => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
    const firstName = randomItem(firstNames);
    const lastName = `${randomItem(lastNames)} ${randomItem(lastNames)}`;
    const uniqueId = Date.now().toString(36);
    const password = `Compraki${randomDigits(4)}!`;

    this.signInForm.patchValue({
      name: `${firstName} ${lastName}`,
      email: `teste.${firstName.toLowerCase()}.${uniqueId}@compraki.dev`,
      cpf: randomDigits(11),
      phone: `339${randomDigits(8)}`,
      password,
      repeatPassword: password,
      cep: '36900000',
      street: randomItem(streets),
      number: String(10 + Math.floor(Math.random() * 990)),
      complement: `Apto ${1 + Math.floor(Math.random() * 300)}`,
      neighborhood: randomItem(neighborhoods),
      city: randomItem(cities),
      state: randomItem(states)
    });

    this.signInForm.markAllAsTouched();
    this.errors = {};
    this.currentStep = this.totalSteps;
    this.changeDetectorRef.detectChanges();
    console.info('Cadastro preenchido automaticamente pelo atalho Ctrl + Shift + aspas.');
  }

  /** Confere os campos de uma etapa e devolve o erro de cada um (vazio = tudo certo). */
  private stepErrors(step: number): Partial<Record<FieldName, string>> {
    const v = this.signInForm.getRawValue();
    const digits = (value: string) => value.replace(/\D/g, '');
    const e: Partial<Record<FieldName, string>> = {};
    switch (step) {
      case 1:
        if (v.name.trim().length < 3) e.name = 'Digite seu nome completo';
        if (!EMAIL_RE.test(v.email.trim())) e.email = 'Digite um e-mail válido';
        if (digits(v.cpf).length !== 11) e.cpf = 'O CPF precisa ter 11 números';
        if (digits(v.phone).length < 10) e.phone = 'Digite o celular com DDD';
        break;
      case 2:
        if (v.password.length < 6) e.password = 'A senha precisa de pelo menos 6 caracteres';
        if (!v.repeatPassword) e.repeatPassword = 'Repita a senha';
        else if (v.repeatPassword !== v.password) e.repeatPassword = 'As senhas não são iguais';
        break;
      case 3:
        if (digits(v.cep).length !== 8) e.cep = 'O CEP precisa ter 8 números';
        if (!v.street.trim()) e.street = 'Informe a rua';
        if (!v.number.trim()) e.number = 'Informe o número';
        if (!v.neighborhood.trim()) e.neighborhood = 'Informe o bairro';
        if (!v.city.trim()) e.city = 'Informe a cidade';
        if (v.state.trim().length !== 2) e.state = 'Use a sigla';
        break;
    }
    return e;
  }

  /** Enter ou botão principal: avança de etapa ou, na última, cria a conta. */
  onSubmit() {
    if (this.status !== 'idle') return;
    this.errors = this.stepErrors(this.currentStep);
    this.formError = '';
    if (Object.keys(this.errors).length) return;

    if (this.currentStep < this.totalSteps) {
      this.currentStep++;
    } else {
      this.callSignInFunction();
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.errors = {};
      this.formError = '';
    }
  }

  async fillAddressFromCEP(cep: string) {
    try {
      const data = await this.addressService.getCEP(cep);
      if (data) {
        this.signInForm.patchValue({
          street: data.logradouro,
          neighborhood: data.bairro,
          city: data.localidade,
          state: data.uf
        });
      }
    } catch (e) {
      console.error('Erro ao buscar CEP no formulário:', e);
    }
  }

  async callSignInFunction() {
    // Revalida tudo: o atalho de dev pula direto para a última etapa.
    for (const step of [1, 2, 3]) {
      const errors = this.stepErrors(step);
      if (Object.keys(errors).length) {
        this.currentStep = step;
        this.errors = errors;
        return;
      }
    }

    const form = this.signInForm.getRawValue();
    const address: AppAddress = {
      cep: form.cep,
      street: form.street.trim(),
      number: form.number.trim(),
      complement: form.complement.trim(),
      neighborhood: form.neighborhood.trim(),
      city: form.city.trim(),
      state: form.state.trim().toUpperCase()
    };

    this.status = 'loading';
    try {
      await this.firebaseProducts.signIn(
        form.email.trim(),
        form.password,
        form.name.trim(),
        form.cpf,
        form.phone,
        address
      );
      this.succeed();
    } catch (error) {
      this.formError = (error as Error).message;
    } finally {
      this.status = 'idle';
      this.changeDetectorRef.markForCheck();
    }
  }

  public async callSignInGoogleFunction() {
    if (this.googleLoading) return;
    this.formError = '';
    this.googleLoading = true;
    try {
      if (await this.firebaseProducts.signInWithGoogle()) this.succeed();
    } catch (error) {
      this.formError = (error as Error).message;
    } finally {
      this.googleLoading = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  private succeed() {
    this.registrationSuccess = true;
    this.signInForm.reset();
    this.redirectTimer = setTimeout(() => {
      this.router.navigateByUrl(safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirectTo')));
    }, 1600);
  }
}
