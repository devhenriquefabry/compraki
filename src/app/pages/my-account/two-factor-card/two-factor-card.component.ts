import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { User } from 'firebase/auth';
import { VnIconComponent } from 'src/app/components/vn-icon/vn-icon.component';
import {
  TwoFactorError, TwoFactorPurpose, disableTwoFactor, enableTwoFactor, requestTwoFactorCode, twoFactorEnabled,
} from 'src/app/core/two-factor';

/** Linha "Verificação em duas etapas" de Senha e segurança: ligar e desligar. */
@Component({
  selector: 'app-two-factor-card',
  templateUrl: './two-factor-card.component.html',
  styleUrls: ['./two-factor-card.component.scss'],
  imports: [FormsModule, IonicModule, VnIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TwoFactorCardComponent implements OnInit {
  private readonly toastCtrl = inject(ToastController);

  readonly user = input.required<User>();

  /** `null` enquanto não se sabe. */
  readonly enabled = signal<boolean | null>(null);
  readonly purpose = signal<TwoFactorPurpose | null>(null);
  readonly sentTo = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  code = '';

  async ngOnInit() {
    try {
      this.enabled.set(await twoFactorEnabled(this.user()));
    } catch {
      this.enabled.set(false);
      this.error.set('Não foi possível ver o estado da verificação agora.');
    }
  }

  async start(purpose: TwoFactorPurpose) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.code = '';
    try {
      const { email } = await requestTwoFactorCode(this.user(), purpose);
      this.sentTo.set(email);
      this.purpose.set(purpose);
    } catch (error) {
      const failure = error as TwoFactorError;
      if (failure.code === 'cooldown') {
        // O código pedido há pouco ainda vale, se foi para a mesma ação.
        this.error.set(`${failure.message} (${failure.retryAfter ?? 60} s)`);
      } else {
        this.error.set(failure.message);
      }
    } finally {
      this.busy.set(false);
    }
  }

  cancel() {
    this.purpose.set(null);
    this.error.set('');
    this.code = '';
  }

  async confirm() {
    const purpose = this.purpose();
    const code = this.code.trim();
    if (!purpose || this.busy()) return;
    if (!/^\d{6}$/.test(code)) {
      this.error.set('Digite os 6 números do código.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      if (purpose === 'enable') {
        await enableTwoFactor(this.user(), code);
        this.enabled.set(true);
        await this.toast('Verificação em duas etapas ativada.');
      } else {
        await disableTwoFactor(this.user(), code);
        this.enabled.set(false);
        await this.toast('Verificação em duas etapas desativada.');
      }
      this.cancel();
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  private async toast(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, position: 'top', color: 'dark' });
    await toast.present();
  }
}
