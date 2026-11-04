import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { User, signOut } from 'firebase/auth';
import { VineonLogoComponent } from 'src/app/components/vineon-logo/vineon-logo.component';
import { getFirebaseAuth, waitForAuthUser } from 'src/app/core/auth-state';
import { safeRedirectTarget } from 'src/app/core/auth-redirect';
import { COMPANY, mailtoLink } from 'src/app/core/legal-info';
import {
  TwoFactorError, isSecondFactorPending, requestTwoFactorCode, verifyLoginCode,
} from 'src/app/core/two-factor';

/**
 * Segunda etapa do login. Para aqui toda sessão pendente, seja logo depois da
 * senha/Google, seja ao reabrir o app (ver `watchSecondFactor` no AppComponent).
 */
@Component({
  selector: 'app-two-factor',
  templateUrl: './two-factor.page.html',
  styleUrls: ['../../../theme/auth.scss', './two-factor.page.scss'],
  imports: [FormsModule, VineonLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TwoFactorPage implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly busy = signal(false);
  readonly sending = signal(false);
  readonly sentTo = signal('');
  readonly error = signal('');
  readonly cooldown = signal(0);
  code = '';

  readonly supportLink = mailtoLink(COMPANY.supportEmail, 'Perdi o acesso à verificação em duas etapas');
  private user: User | null = null;
  private timer?: ReturnType<typeof setInterval>;

  private get target(): string {
    return safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirectTo'));
  }

  async ngOnInit() {
    this.user = await waitForAuthUser();
    if (!this.user) {
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }
    if (!(await isSecondFactorPending(this.user, true))) {
      await this.router.navigateByUrl(this.target, { replaceUrl: true });
      return;
    }
    await this.send();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  async send() {
    if (!this.user || this.sending() || this.cooldown() > 0) return;
    this.sending.set(true);
    this.error.set('');
    try {
      const { email, retryAfter } = await requestTwoFactorCode(this.user, 'login');
      this.sentTo.set(email);
      this.startCooldown(retryAfter);
    } catch (error) {
      const failure = error as TwoFactorError;
      // Recarregou a página logo depois do envio: o código anterior continua valendo.
      if (failure.code === 'cooldown') this.startCooldown(failure.retryAfter ?? 60);
      else this.error.set(failure.message);
    } finally {
      this.sending.set(false);
    }
  }

  private startCooldown(seconds: number) {
    clearInterval(this.timer);
    this.cooldown.set(seconds);
    this.timer = setInterval(() => {
      this.cooldown.update(value => value - 1);
      if (this.cooldown() <= 0) clearInterval(this.timer);
    }, 1000);
  }

  async verify() {
    if (!this.user || this.busy()) return;
    if (!/^\d{6}$/.test(this.code.trim())) {
      this.error.set('Digite os 6 números do código.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await verifyLoginCode(this.user, this.code.trim());
      // Recarrega em vez de navegar: os listeners do Firestore abertos enquanto a
      // sessão estava pendente morreram com permission-denied e não voltam sozinhos.
      window.location.replace(this.target);
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async logout() {
    await signOut(getFirebaseAuth()).catch(() => undefined);
    window.location.replace('/login');
  }
}
