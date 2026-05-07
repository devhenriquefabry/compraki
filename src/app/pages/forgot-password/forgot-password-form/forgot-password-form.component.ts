import { Component, OnInit } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { NgIf } from '@angular/common';
import { FormControl, Validators, ReactiveFormsModule } from '@angular/forms';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { LoadingSpinnerOverlayComponent } from 'src/app/components/loading-spinner-overlay/loading-spinner-overlay.component';

@Component({
  selector: 'app-forgot-password-form',
  templateUrl: './forgot-password-form.component.html',
  styleUrls: ['./forgot-password-form.component.scss'],
  imports: [RouterLink, IonicModule, ReactiveFormsModule, NgIf, LoadingSpinnerOverlayComponent],
  standalone: true

})
export class ForgotPasswordFormComponent implements OnInit {

  emailControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });
  codeControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(6), Validators.maxLength(6)] });
  passwordControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(6)] });
  confirmPasswordControl = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  
  public isLoading = false;
  public currentStep = 1; // 1: Email, 2: Method Choice, 3: Success Sent, 4: Enter Code, 5: New Password, 6: Final Success
  public selectedMethod: 'email' | 'whatsapp' | null = null;
  private generatedCode: string = '';

  constructor(
    private firebaseProducts: FirebaseProducts,
    private router: Router
  ) { }

  ngOnInit() { }

  async identifyUser() {
    if (this.emailControl.invalid) {
      alert('Por favor, informe um e-mail válido.');
      return;
    }
    // Apenas passamos para a escolha do método
    this.currentStep = 2;
  }

  async sendCode(method: 'email' | 'whatsapp') {
    this.selectedMethod = method;
    this.isLoading = true;
    try {
      await this.firebaseProducts.requestPasswordResetCode(this.emailControl.value, method);
      this.currentStep = 3;
    } catch (error: any) {
      alert(error.message || 'Erro ao processar solicitação. Tente novamente.');
    } finally {
      this.isLoading = false;
    }
  }

  goToCodeStep() {
    this.currentStep = 4;
  }

  async verifyCode() {
    if (this.codeControl.invalid) {
      alert('Digite o código de 6 dígitos.');
      return;
    }

    this.isLoading = true;
    try {
      await this.firebaseProducts.validateResetCode(this.emailControl.value, this.codeControl.value);
      this.currentStep = 5;
    } catch (error: any) {
      alert(error.message || 'Código inválido ou expirado.');
    } finally {
      this.isLoading = false;
    }
  }

  async updatePassword() {
    if (this.passwordControl.value !== this.confirmPasswordControl.value) {
      alert('As senhas não coincidem!');
      return;
    }

    if (this.passwordControl.invalid) {
      alert('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    this.isLoading = true;
    try {
      await this.firebaseProducts.completePasswordReset({
        email: this.emailControl.value,
        code: this.codeControl.value,
        newPassword: this.passwordControl.value
      });
      
      this.currentStep = 6;
      setTimeout(() => {
        this.router.navigate(['/login']);
        this.resetForm();
      }, 2000);
    } catch (error: any) {
      alert(error.message || 'Erro ao atualizar a senha.');
    } finally {
      this.isLoading = false;
    }
  }

  resetForm() {
    this.currentStep = 1;
    this.selectedMethod = null;
    this.emailControl.reset();
    this.codeControl.reset();
    this.passwordControl.reset();
    this.confirmPasswordControl.reset();
  }

}
