import { NgIf } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { safeRedirectTarget } from 'src/app/core/auth-redirect';
import { IonicModule } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { LoadingSpinnerOverlayComponent } from 'src/app/components/loading-spinner-overlay/loading-spinner-overlay.component';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { AddressService } from 'src/app/services/address.service';
import { AppAddress } from 'src/app/interfaces/app-user';

@Component({
  selector: 'app-sign-in-form',
  templateUrl: './sign-in-form.component.html',
  styleUrls: ['./sign-in-form.component.scss'],
  standalone: true,
  imports: [IonicModule, RouterLink, ReactiveFormsModule, NgIf, LoadingSpinnerOverlayComponent]
})

export class SignInFormComponent implements OnInit, OnDestroy {
  public currentStep: number = 1;
  public totalSteps: number = 3;
  public formularioValido: boolean = false;
  public registrationSuccess: boolean = false;
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

  constructor(
    public firebaseProducts: FirebaseProducts,
    private addressService: AddressService,
    private router: Router,
    private route: ActivatedRoute,
    private changeDetectorRef: ChangeDetectorRef
  ) { }


  ngOnInit() {
    const devAutofillShortcutListener = (event: KeyboardEvent) => this.handleDevAutofillShortcut(event);
    document.addEventListener('keydown', devAutofillShortcutListener, true);
    this.removeDevAutofillShortcutListener = () => {
      document.removeEventListener('keydown', devAutofillShortcutListener, true);
    };

    this.signInForm.valueChanges.subscribe(() => {
      this.formularioValido = this.signInForm.valid;
    });

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
    this.formularioValido = this.signInForm.valid;
    this.currentStep = this.totalSteps;
    this.changeDetectorRef.detectChanges();
    console.info('Cadastro preenchido automaticamente pelo atalho Ctrl + Shift + aspas.');
  }

  isStepValid(step: number): boolean {
    const f = this.signInForm;
    switch (step) {
      case 1:
        return f.get('name')!.valid && f.get('email')!.valid && 
               f.get('cpf')!.valid && f.get('phone')!.valid;
      case 2:
        return f.get('password')!.valid && f.get('repeatPassword')!.valid &&
               f.get('password')!.value === f.get('repeatPassword')!.value;
      case 3:
        return f.get('cep')!.valid && f.get('street')!.valid && 
               f.get('number')!.valid && f.get('neighborhood')!.valid && 
               f.get('city')!.valid && f.get('state')!.valid;
      default:
        return false;
    }
  }

  nextStep() {
    if (this.currentStep < this.totalSteps && this.isStepValid(this.currentStep)) {
      this.currentStep++;
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
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

  callSignInFunction() {
    const form = this.signInForm.value;
    if (this.signInForm.valid && this.isStepValid(3)) {
      if (form.email && form.password && form.name) {
        
        const address: AppAddress = {
          cep: form.cep!,
          street: form.street!,
          number: form.number!,
          complement: form.complement,
          neighborhood: form.neighborhood!,
          city: form.city!,
          state: form.state!
        };

        this.firebaseProducts.signIn(
          form.email, 
          form.password,
          form.name,
          form.cpf,
          form.phone,
          address
        ).then((salvouNoFirebaseMesmo) => {
          if (salvouNoFirebaseMesmo === true) {
            this.registrationSuccess = true;
            this.signInForm.reset();
            
            setTimeout(() => {
              this.router.navigateByUrl(safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirectTo')));
            }, 2000);
          }
        })
      }
    }
  }

  public callSignInGoogleFunction () {
    this.firebaseProducts.signInWithGoogle().then((salvouNoFirebaseMesmo)=> {
      if (salvouNoFirebaseMesmo === true) {
        this.registrationSuccess = true;
        this.signInForm.reset();
        
        setTimeout(() => {
          this.router.navigateByUrl(safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirectTo')));
        }, 2000);
      }
    })
  }
}
