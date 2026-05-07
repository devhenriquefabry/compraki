import { NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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

export class SignInFormComponent implements OnInit {
  public currentStep: number = 1;
  public totalSteps: number = 3;
  public formularioValido: boolean = false;
  public registrationSuccess: boolean = false;

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

  constructor(public firebaseProducts: FirebaseProducts, private addressService: AddressService, private router: Router) { }


  ngOnInit() {
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
              this.router.navigate(['/tabs']);
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
          this.router.navigate(['/tabs']);
        }, 2000);
      }
    })
  }
}
