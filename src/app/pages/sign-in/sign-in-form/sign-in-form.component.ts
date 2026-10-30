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
import { isValidCpf, maskCep, maskCpf, maskPhone } from 'src/app/core/br-documents';
import { environment } from 'src/environments/environment';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
/** Tempo mínimo do "Buscando endereço…": o ViaCEP às vezes responde tão rápido que o aviso só piscava. */
const CEP_MIN_LOADING_MS = 600;
const digitsOf = (value: string) => value.replace(/\D/g, '');

/** CPF de teste com dígitos verificadores certos (só para o atalho de dev). */
function validRandomCpf(base9: string): string {
  const dv = (digits: string) => {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * (digits.length + 1 - i);
    const r = (sum * 10) % 11;
    return String(r === 10 ? 0 : r);
  };
  const d10 = base9 + dv(base9);
  return d10 + dv(d10);
}

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
  /** Busca do CEP no ViaCEP: mostra o carregando e trava os campos de endereço. */
  public cepStatus: 'idle' | 'loading' | 'found' | 'notFound' | 'failed' = 'idle';
  /** Conferência do e-mail no servidor (passo 1). */
  public emailStatus: 'idle' | 'checking' | 'available' | 'taken' = 'idle';
  /** A conta existente só entra pelo Google: sugere o botão do Google, não recuperar senha. */
  public emailTakenGoogleOnly = false;
  private cepLookup = 0;
  private lastCepLooked = '';
  private emailCheck?: { email: string; result: Promise<boolean> };
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

    // Atalho de preenchimento de teste: só fora da produção (criava contas
    // falsas @compraki.dev no site no ar).
    if (!environment.production) {
      const devAutofillShortcutListener = (event: KeyboardEvent) => this.handleDevAutofillShortcut(event);
      document.addEventListener('keydown', devAutofillShortcutListener, true);
      this.removeDevAutofillShortcutListener = () => {
        document.removeEventListener('keydown', devAutofillShortcutListener, true);
      };
    }

    this.applyMask('cpf', maskCpf);
    this.applyMask('phone', maskPhone);
    this.applyMask('cep', maskCep);

    // Mudou o e-mail: o resultado da conferência anterior não vale mais.
    this.signInForm.controls.email.valueChanges.subscribe(() => {
      this.emailStatus = 'idle';
      this.emailTakenGoogleOnly = false;
    });

    this.signInForm.controls.cep.valueChanges.subscribe(cep => {
      const cleanCep = digitsOf(cep || '').slice(0, 8);
      if (cleanCep.length === 8 && cleanCep !== this.lastCepLooked) {
        this.fillAddressFromCEP(cleanCep);
      } else if (cleanCep.length < 8) {
        this.lastCepLooked = '';
        this.cepLookup++;
        this.cepStatus = 'idle';
      }
    });
  }

  /**
   * Formata o campo enquanto a pessoa digita (CPF, celular, CEP) e devolve o
   * cursor para depois do mesmo dígito — editar no meio não pula para o fim.
   */
  private applyMask(name: 'cpf' | 'phone' | 'cep', mask: (value: string) => string) {
    const control = this.signInForm.controls[name];
    control.valueChanges.subscribe(value => {
      const masked = mask(value || '');
      if (masked === value) return;

      const input = document.getElementById(`su-${name}`) as HTMLInputElement | null;
      const focused = !!input && document.activeElement === input;
      const caret = focused ? (input!.selectionStart ?? value.length) : value.length;
      const digitsBefore = digitsOf(value.slice(0, caret)).length;

      control.setValue(masked, { emitEvent: false });

      if (focused) {
        let pos = 0;
        for (let seen = 0; pos < masked.length && seen < digitsBefore; pos++) {
          if (/\d/.test(masked[pos])) seen++;
        }
        input!.setSelectionRange(pos, pos);
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
      cpf: validRandomCpf(randomDigits(9)),
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
        else if (!isValidCpf(v.cpf)) e.cpf = 'CPF inválido. Confira os números';
        if (digits(v.phone).length < 10) e.phone = 'Digite o celular com DDD';
        break;
      case 2:
        if (v.password.length < 8) e.password = 'A senha precisa de pelo menos 8 caracteres';
        else if (!/[A-Za-z]/.test(v.password) || !/\d/.test(v.password)) e.password = 'Use letras e números na senha';
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
  async onSubmit() {
    if (this.status !== 'idle') return;
    this.errors = this.stepErrors(this.currentStep);
    this.formError = '';
    if (Object.keys(this.errors).length) return;

    // O botão não trava durante a conferência: o blur do e-mail a dispara no mesmo
    // clique do "Continuar", e botão desabilitado engoliria o clique. Aqui só espera.
    if (this.currentStep === 1 && await this.isEmailTaken()) return;

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

  /** Ao sair do campo de e-mail já confere se tem conta, antes do "Continuar". */
  onEmailBlur() {
    if (EMAIL_RE.test(this.signInForm.controls.email.value.trim())) void this.isEmailTaken();
  }

  /**
   * Pergunta ao servidor se o e-mail já tem conta. Se a conferência falhar
   * (rede, function fora do ar), deixa seguir: o cadastro barra o duplicado no fim.
   */
  private isEmailTaken(): Promise<boolean> {
    const email = this.signInForm.controls.email.value.trim().toLowerCase();
    if (this.emailCheck?.email === email && this.emailStatus !== 'idle') return this.emailCheck.result;

    this.emailStatus = 'checking';
    const result = this.firebaseProducts.checkEmailAvailable(email)
      .then(({ exists, googleOnly }) => {
        if (this.emailCheck?.email !== email) return exists;
        this.emailStatus = exists ? 'taken' : 'available';
        this.emailTakenGoogleOnly = exists && googleOnly;
        return exists;
      })
      .catch(error => {
        console.warn('Não deu para conferir o e-mail agora:', error);
        if (this.emailCheck?.email === email) this.emailStatus = 'idle';
        return false;
      })
      .finally(() => this.changeDetectorRef.markForCheck());
    this.emailCheck = { email, result };
    return result;
  }

  async fillAddressFromCEP(cep: string) {
    const lookup = ++this.cepLookup;
    this.lastCepLooked = cep;
    this.cepStatus = 'loading';
    const minDelay = new Promise(resolve => setTimeout(resolve, CEP_MIN_LOADING_MS));

    try {
      const [data] = await Promise.all([this.addressService.getCEP(cep), minDelay]);
      if (lookup !== this.cepLookup) return;
      // CEP de cidade pequena vem sem rua e bairro: não apaga o que a pessoa já digitou.
      this.signInForm.patchValue({
        street: data.logradouro || this.signInForm.controls.street.value,
        neighborhood: data.bairro || this.signInForm.controls.neighborhood.value,
        city: data.localidade,
        state: data.uf
      });
      this.cepStatus = 'found';
    } catch (e) {
      await minDelay;
      if (lookup !== this.cepLookup) return;
      console.error('Erro ao buscar CEP no formulário:', e);
      this.cepStatus = (e as Error)?.message === 'CEP não encontrado' ? 'notFound' : 'failed';
    } finally {
      if (lookup === this.cepLookup) this.changeDetectorRef.markForCheck();
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
      cep: digitsOf(form.cep),
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
        digitsOf(form.cpf),
        digitsOf(form.phone),
        address
      );
      this.succeed();
    } catch (error) {
      this.formError = (error as Error).message;
      // Passou pela conferência do passo 1 (ou ela falhou): volta lá com o aviso certo.
      if (/já tem uma conta/.test(this.formError)) {
        this.formError = '';
        this.emailStatus = 'taken';
        this.emailCheck = { email: form.email.trim().toLowerCase(), result: Promise.resolve(true) };
        this.currentStep = 1;
      }
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
