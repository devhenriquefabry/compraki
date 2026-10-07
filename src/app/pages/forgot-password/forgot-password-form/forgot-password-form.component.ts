import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import { checkmark, chevronForwardOutline, logoWhatsapp, mailOutline, paperPlaneOutline } from 'ionicons/icons';
import { merge, Subscription } from 'rxjs';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { VineonLogoComponent } from 'src/app/components/vineon-logo/vineon-logo.component';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * Iguais aos do servidor (`RESET_CODE_LENGTH` e o mínimo de `completePasswordReset`
 * em functions/src/index.ts). Mudou lá, mude aqui — a tela aceitava 6 dígitos e o
 * servidor manda 8 desde a Fase 0, e a recuperação ficou impossível.
 */
export const RESET_CODE_LENGTH = 8;
export const RESET_MIN_PASSWORD = 8;

type Step = 1 | 2 | 3 | 4 | 5 | 6;

@Component({
  selector: 'app-forgot-password-form',
  templateUrl: './forgot-password-form.component.html',
  styleUrls: ['../../../../theme/auth.scss', './forgot-password-form.component.scss'],
  imports: [RouterLink, IonicModule, FormsModule, ReactiveFormsModule, VineonLogoComponent],
  standalone: true
})
export class ForgotPasswordFormComponent implements OnInit, OnDestroy {

  emailControl = new FormControl('', { nonNullable: true });
  codeControl = new FormControl('', { nonNullable: true });
  passwordControl = new FormControl('', { nonNullable: true });
  confirmPasswordControl = new FormControl('', { nonNullable: true });

  public isLoading = false;
  /** 1: e-mail · 2: canal · 3: código enviado · 4: digitar código · 5: nova senha · 6: pronto */
  public currentStep: Step = 1;
  public selectedMethod: 'email' | 'whatsapp' | null = null;
  public showPassword = false;
  public readonly codeLength = RESET_CODE_LENGTH;
  public readonly minPassword = RESET_MIN_PASSWORD;

  /** Erro do campo principal da etapa (e-mail, código ou nova senha). */
  public fieldError = '';
  /** Erro da confirmação de senha. */
  public confirmError = '';
  /** Erro vindo do servidor (código inválido, e-mail sem conta, rede). */
  public formError = '';

  private subs = new Subscription();
  private redirectTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private firebaseProducts: FirebaseProducts,
    private router: Router
  ) { }

  ngOnInit() {
    addIcons({ checkmark, chevronForwardOutline, logoWhatsapp, mailOutline, paperPlaneOutline });

    // Voltar a digitar limpa o erro da tela.
    this.subs.add(merge(this.emailControl.valueChanges, this.codeControl.valueChanges, this.passwordControl.valueChanges)
      .subscribe(() => { this.fieldError = ''; this.formError = ''; }));
    this.subs.add(this.confirmPasswordControl.valueChanges
      .subscribe(() => { this.confirmError = ''; this.formError = ''; }));
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    clearTimeout(this.redirectTimer);
  }

  goTo(step: Step) {
    this.currentStep = step;
    this.fieldError = this.confirmError = this.formError = '';
  }

  identifyUser() {
    const email = this.emailControl.value.trim();
    if (!EMAIL_RE.test(email)) {
      this.fieldError = 'Digite um e-mail válido';
      return;
    }
    this.goTo(2);
  }

  async sendCode(method: 'email' | 'whatsapp') {
    if (this.isLoading) return;
    this.selectedMethod = method;
    this.formError = '';
    this.isLoading = true;
    try {
      await this.firebaseProducts.requestPasswordResetCode(this.emailControl.value, method);
      this.goTo(3);
    } catch (error: any) {
      this.formError = error?.message || 'Não foi possível enviar o código. Tente novamente.';
    } finally {
      this.isLoading = false;
    }
  }

  async verifyCode() {
    if (this.isLoading) return;
    const code = this.codeControl.value.replace(/\D/g, '');
    if (code.length !== RESET_CODE_LENGTH) {
      this.fieldError = `O código tem ${RESET_CODE_LENGTH} números`;
      return;
    }

    this.isLoading = true;
    try {
      await this.firebaseProducts.validateResetCode(this.emailControl.value, code);
      this.codeControl.setValue(code, { emitEvent: false });
      this.goTo(5);
    } catch (error: any) {
      this.formError = error?.message || 'Código inválido ou expirado.';
    } finally {
      this.isLoading = false;
    }
  }

  async updatePassword() {
    if (this.isLoading) return;
    const password = this.passwordControl.value;
    this.fieldError = password.length >= RESET_MIN_PASSWORD ? '' : `A senha precisa de pelo menos ${RESET_MIN_PASSWORD} caracteres`;
    this.confirmError = !this.confirmPasswordControl.value
      ? 'Repita a senha'
      : this.confirmPasswordControl.value !== password ? 'As senhas não são iguais' : '';
    if (this.fieldError || this.confirmError) return;

    this.isLoading = true;
    try {
      await this.firebaseProducts.completePasswordReset({
        email: this.emailControl.value,
        code: this.codeControl.value,
        newPassword: password
      });

      this.goTo(6);
      this.redirectTimer = setTimeout(() => {
        this.router.navigate(['/login']);
        this.resetForm();
      }, 1800);
    } catch (error: any) {
      this.formError = error?.message || 'Não foi possível salvar a senha. Tente novamente.';
    } finally {
      this.isLoading = false;
    }
  }

  resetForm() {
    this.goTo(1);
    this.selectedMethod = null;
    this.showPassword = false;
    this.emailControl.reset();
    this.codeControl.reset();
    this.passwordControl.reset();
    this.confirmPasswordControl.reset();
    this.fieldError = this.confirmError = this.formError = '';
  }
}
