import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule, NavController, ToastController } from '@ionic/angular';
import { User, signOut } from 'firebase/auth';

import {
  AccountDeletionError, DeletionCheck, checkAccountDeletion, confirmIdentity, deleteAccount, signInMethods,
} from '../../core/account-deletion';
import { getFirebaseAuth, isCurrentUserAdmin, onAuthUserChanged } from '../../core/auth-state';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { VnIconName } from '../../core/vn-icons';

type View = 'loading' | 'failed' | 'admin' | 'ready' | 'deleting';

interface Line {
  icon: VnIconName;
  text: string;
}

/**
 * Excluir conta (LGPD, art. 18, VI).
 *
 * Primeiro pergunta ao servidor o que impede e o que será apagado (sem apagar
 * nada). Com pedido andando, mostra o que falta terminar. Sem impedimento, a
 * pessoa confirma que entendeu, confirma a identidade (senha ou Google) e a
 * Cloud Function `deleteMyAccount` apaga tudo. Conta de admin não chega aqui:
 * a linha não aparece em Minha conta, e esta tela e o servidor recusam.
 */
@Component({
  selector: 'app-delete-account',
  templateUrl: './delete-account.page.html',
  styleUrls: ['./delete-account.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, RouterLink, VnIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteAccountPage {
  private readonly navCtrl = inject(NavController);
  private readonly toastCtrl = inject(ToastController);

  readonly view = signal<View>('loading');
  readonly error = signal<string | null>(null);
  readonly check = signal<DeletionCheck | null>(null);
  readonly user = signal<User | null>(null);

  readonly understood = signal(false);
  readonly password = signal('');

  readonly methods = computed(() => {
    const user = this.user();
    return user ? signInMethods(user) : { password: false, google: false };
  });

  readonly blockers = computed(() => this.check()?.blockers ?? []);

  /** O que some — só linhas com algo a apagar, com o número real. */
  readonly deleted = computed<Line[]>(() => {
    const s = this.check()?.summary;
    if (!s) return [];
    const lines: Line[] = [
      { icon: 'account', text: 'Seu cadastro: nome, CPF, telefone, foto e login' },
    ];
    if (s.addresses) lines.push({ icon: 'pin', text: plural(s.addresses, 'endereço salvo', 'endereços salvos') });
    if (s.products) lines.push({ icon: 'tag', text: `${plural(s.products, 'anúncio', 'anúncios')} e a sua loja na vitrine` });
    if (s.savedProducts) lines.push({ icon: 'heart', text: plural(s.savedProducts, 'favorito', 'favoritos') });
    if (s.reviews) lines.push({ icon: 'star', text: plural(s.reviews, 'avaliação que você fez', 'avaliações que você fez') });
    lines.push({ icon: 'bell', text: 'Carrinho, avisos, lojas que você segue e seus seguidores' });
    return lines;
  });

  /** O que fica, e por quê. */
  readonly kept = computed<Line[]>(() => {
    const s = this.check()?.summary;
    if (!s) return [];
    const lines: Line[] = [];
    const orders = s.ordersKept + s.salesKept;
    if (orders) {
      lines.push({
        icon: 'receipt',
        text: `${plural(orders, 'pedido', 'pedidos')} e as notas fiscais, por 5 anos: as leis fiscais e o Código de Defesa do Consumidor exigem`,
      });
    }
    if (s.chats) {
      lines.push({
        icon: 'chat',
        text: `${plural(s.chats, 'conversa', 'conversas')}: as mensagens continuam com a outra pessoa, com seu nome trocado por "Conta excluída"`,
      });
    }
    if (s.tickets) {
      lines.push({
        icon: 'ticket',
        text: `${plural(s.tickets, 'atendimento', 'atendimentos')} com a Vineon: o texto fica como registro, sem seu nome, e-mail e anexos`,
      });
    }
    return lines;
  });

  constructor() {
    const stop = onAuthUserChanged(user => {
      this.user.set(user);
      if (user && this.view() === 'loading') void this.load(user);
    });
    inject(DestroyRef).onDestroy(stop);
  }

  async load(user = this.user()) {
    if (!user) return;
    this.view.set('loading');
    this.error.set(null);
    if (await isCurrentUserAdmin()) {
      this.view.set('admin');
      return;
    }
    try {
      this.check.set(await checkAccountDeletion(user));
      this.view.set('ready');
    } catch (error) {
      if (error instanceof AccountDeletionError && error.code === 'admin') {
        this.view.set('admin');
        return;
      }
      this.error.set(error instanceof Error ? error.message : 'Não foi possível conferir sua conta agora.');
      this.view.set('failed');
    }
  }

  /** `withGoogle`: confirma pelo Google mesmo quando a conta também tem senha. */
  async confirmDelete(withGoogle = false) {
    const user = this.user();
    if (!user || this.view() !== 'ready' || this.blockers().length || !this.understood()) return;
    const usePassword = this.methods().password && !withGoogle;
    if (usePassword && !this.password()) {
      await this.toast('Digite sua senha para confirmar.');
      return;
    }

    this.view.set('deleting');
    try {
      await confirmIdentity(user, usePassword ? this.password() : undefined);
      const result = await deleteAccount(user);
      if (!result.ok) {
        // Algo mudou entre a conferência e agora (um pedido foi pago, por exemplo).
        this.check.set(result);
        this.view.set('ready');
        await this.toast('Apareceu um pedido em andamento. Veja abaixo o que falta terminar.');
        return;
      }
      this.password.set('');
      await signOut(getFirebaseAuth()).catch(() => undefined);
      await this.toast('Sua conta foi excluída.');
      this.navCtrl.navigateRoot('/');
    } catch (error) {
      this.view.set('ready');
      await this.toast(error instanceof Error ? error.message : 'Não foi possível excluir a conta agora.');
    }
  }

  orderLink(blocker: { kind: 'purchase' | 'sale'; orderId: string }): string[] {
    return blocker.kind === 'sale' ? ['/sale-details', blocker.orderId] : ['/my-orders'];
  }

  shortId(id: string): string {
    return id.substring(0, 8).toUpperCase();
  }

  goBack(): void {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 3600, position: 'top', color: 'dark' });
    await toast.present();
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
