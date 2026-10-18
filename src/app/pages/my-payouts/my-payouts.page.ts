import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule, NavController, ToastController } from '@ionic/angular';

import { onAuthUserChanged } from '../../core/auth-state';
import { isValidCpfOrCnpj, formatCpfCnpj } from '../../core/br-documents';
import { feeFor, formatRate, rateAt } from '../../core/commission';
import { escrowReleaseDate, formatBRL, formatDay, isPaid, sellerAmount, sellerItems, toDate } from '../../core/order-stage';
import { PIX_KEY_TYPES, PixKeyType, SellerPayout, maskPixKey, normalizePixKey, pixKeyLabel, pixKeyProblem } from '../../core/pix';
import { Order } from '../../interfaces/order';
import { AppConfigService } from '../../services/app-config.service';
import { SalesService } from '../../services/sales.service';
import { SellerPayoutService } from '../../services/seller-payout.service';

type PayoutState = 'waiting' | 'holding' | 'release' | 'released' | 'refund' | 'refunded';

interface PayoutLine {
  id: string;
  shortId: string;
  title: string;
  photo: string;
  paidOn: string;
  gross: number;
  rateLabel: string;
  fee: number;
  net: number;
  state: PayoutState;
  label: string;
}

const STATE_ORDER: Record<PayoutState, number> = { release: 0, holding: 1, waiting: 2, refund: 3, released: 4, refunded: 5 };

/**
 * Recebimentos da loja: para onde vai o dinheiro (chave Pix) e quanto está
 * retido, liberado ou em devolução, venda por venda, já com a taxa da Vineon.
 *
 * O repasse é manual: a Vineon paga por Pix depois do prazo de desistência
 * (7 dias da entrega) e marca como liberado no painel. Esta tela mostra o mesmo
 * número que o admin vê na hora de pagar.
 */
@Component({
  selector: 'app-my-payouts',
  templateUrl: './my-payouts.page.html',
  styleUrls: ['./my-payouts.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule],
})
export class MyPayoutsPage {
  private readonly payouts = inject(SellerPayoutService);
  private readonly sales = inject(SalesService);
  private readonly appConfig = inject(AppConfigService);
  private readonly navCtrl = inject(NavController);
  private readonly toastCtrl = inject(ToastController);
  private readonly destroyRef = inject(DestroyRef);

  readonly keyTypes = PIX_KEY_TYPES;

  readonly uid = signal<string | null>(null);
  readonly loadingKey = signal(true);
  readonly loadingSales = signal(true);
  readonly error = signal('');
  readonly payout = signal<SellerPayout | null>(null);
  readonly orders = signal<Order[]>([]);

  readonly editing = signal(false);
  readonly saving = signal(false);
  form = { type: 'cpf' as PixKeyType, key: '', holderName: '', holderDocument: '' };
  formError = '';

  readonly lines = computed<PayoutLine[]>(() => {
    const uid = this.uid();
    if (!uid) return [];
    const commission = this.appConfig.config().commission;
    return this.orders()
      .filter(isPaid)
      .map(order => this.lineFor(order, uid, commission))
      .filter((line): line is PayoutLine => !!line)
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  });

  readonly totals = computed(() => {
    const sum = (states: PayoutState[]) =>
      Math.round(this.lines().filter(l => states.includes(l.state)).reduce((acc, l) => acc + l.net, 0) * 100) / 100;
    return {
      toReceive: sum(['waiting', 'holding', 'release']),
      ready: sum(['release']),
      released: sum(['released']),
      inRefund: sum(['refund']),
    };
  });

  readonly maskedKey = computed(() => {
    const p = this.payout();
    return p ? maskPixKey(p.pixKeyType, p.pixKey) : '';
  });

  constructor() {
    let stop: (() => void) | undefined;
    const stopAuth = onAuthUserChanged(user => {
      stop?.();
      this.uid.set(user?.uid ?? null);
      if (!user) {
        this.loadingKey.set(false);
        this.loadingSales.set(false);
        return;
      }
      const keySub = this.payouts.watch(user.uid).subscribe({
        next: payout => {
          this.payout.set(payout);
          this.loadingKey.set(false);
          if (!payout && !this.editing()) this.startEditing();
        },
        error: err => {
          console.error('[recebimentos] chave', err);
          this.error.set('Não deu para carregar seus dados de recebimento. Confira a conexão.');
          this.loadingKey.set(false);
        },
      });
      const salesSub = this.sales.getSellerSales(user.uid).subscribe({
        next: orders => {
          this.orders.set(orders);
          this.loadingSales.set(false);
        },
        error: err => {
          console.error('[recebimentos] vendas', err);
          this.error.set('Não deu para carregar suas vendas. Confira a conexão.');
          this.loadingSales.set(false);
        },
      });
      stop = () => {
        keySub.unsubscribe();
        salesSub.unsubscribe();
      };
    });
    this.destroyRef.onDestroy(() => {
      stopAuth();
      stop?.();
    });
  }

  private lineFor(order: Order, uid: string, commission: ReturnType<AppConfigService['config']>['commission']): PayoutLine | null {
    const items = sellerItems(order, uid);
    if (!items.length) return null;
    const gross = sellerAmount(order, uid);
    const paidAt = toDate(order.paymentConfirmedAt) ?? toDate(order.createdAt);
    const rate = rateAt(commission, paidAt);
    const fee = feeFor(gross, rate);
    const net = Math.round((gross - fee) * 100) / 100;

    let state: PayoutState;
    let label: string;
    const refund = order.refundInfo?.status;
    if (order.status === 'REFUNDED' || order.escrowInfo?.status === 'REFUNDED' || refund === 'COMPLETED') {
      state = 'refunded';
      label = 'Devolvido ao comprador';
    } else if (refund === 'REQUESTED' || refund === 'APPROVED') {
      state = 'refund';
      label = refund === 'APPROVED' ? 'Devolução aprovada' : 'Devolução em análise';
    } else if (order.escrowInfo?.status === 'RELEASED') {
      state = 'released';
      const at = toDate(order.escrowInfo.releasedAt);
      label = at ? `Liberado em ${formatDay(at)}` : 'Liberado';
    } else {
      const release = escrowReleaseDate(order);
      if (!release) {
        state = 'waiting';
        label = 'Retido até 7 dias depois da entrega';
      } else if (release.getTime() > Date.now()) {
        state = 'holding';
        label = `Retido até ${formatDay(release)}`;
      } else {
        state = 'release';
        label = 'Pronto para liberar';
      }
    }

    const first = items[0];
    const more = items.length > 1 ? ` + ${items.length - 1} ${items.length === 2 ? 'item' : 'itens'}` : '';
    return {
      id: order.id || '',
      shortId: (order.id || '').slice(0, 8).toUpperCase(),
      title: `${first.productData?.name || 'Produto'}${more}`,
      photo: first.productData?.photoURL?.[0] || '',
      paidOn: paidAt ? formatDay(paidAt) : '',
      gross,
      rateLabel: formatRate(rate),
      fee,
      net,
      state,
      label,
    };
  }

  // ------------------------------------------------------------ chave Pix

  startEditing() {
    const p = this.payout();
    this.form = p
      ? {
          type: p.pixKeyType,
          key: p.pixKeyType === 'phone' ? p.pixKey.replace(/^\+55/, '') : p.pixKey,
          holderName: p.holderName,
          holderDocument: formatCpfCnpj(p.holderDocument),
        }
      : { type: 'cpf', key: '', holderName: '', holderDocument: '' };
    this.formError = '';
    this.editing.set(true);
  }

  cancelEditing() {
    this.formError = '';
    this.editing.set(false);
  }

  setType(type: PixKeyType) {
    this.form.type = type;
    this.form.key = '';
    this.formError = '';
  }

  placeholder(): string {
    return PIX_KEY_TYPES.find(t => t.id === this.form.type)?.placeholder ?? '';
  }

  inputMode(): string {
    return this.form.type === 'cpf' || this.form.type === 'cnpj' || this.form.type === 'phone' ? 'numeric' : 'text';
  }

  async saveKey() {
    const uid = this.uid();
    if (!uid || this.saving()) return;
    const key = normalizePixKey(this.form.type, this.form.key);
    const keyProblem = pixKeyProblem(this.form.type, key);
    const holderName = this.form.holderName.replace(/\s+/g, ' ').trim();
    const holderDocument = this.form.holderDocument.replace(/\D/g, '');

    if (keyProblem) return void (this.formError = keyProblem);
    if (holderName.length < 3) return void (this.formError = 'Informe o nome do titular da conta.');
    if (!isValidCpfOrCnpj(holderDocument)) return void (this.formError = 'CPF ou CNPJ do titular inválido.');
    // Chave de CPF/CNPJ é o próprio documento: tem que ser do titular.
    if ((this.form.type === 'cpf' || this.form.type === 'cnpj') && key !== holderDocument) {
      return void (this.formError = 'A chave de CPF/CNPJ precisa ser a do próprio titular.');
    }

    this.formError = '';
    this.saving.set(true);
    try {
      await this.payouts.save(uid, { method: 'pix', pixKeyType: this.form.type, pixKey: key, holderName, holderDocument });
      this.editing.set(false);
      await this.toast('Chave Pix salva. Os próximos repasses vão para ela.', 'success');
    } catch (err) {
      console.error('[recebimentos] salvar', err);
      this.formError = 'Não deu para salvar agora. Confira os dados e tente de novo.';
    } finally {
      this.saving.set(false);
    }
  }

  async removeKey() {
    const uid = this.uid();
    if (!uid) return;
    try {
      await this.payouts.remove(uid);
      await this.toast('Chave removida. Cadastre outra para receber os repasses.', 'medium');
    } catch {
      await this.toast('Não deu para remover agora. Tente de novo.', 'danger');
    }
  }

  // --------------------------------------------------------------- formato

  keyLabel(type: PixKeyType): string {
    return pixKeyLabel(type);
  }

  documentMasked(doc: string): string {
    const d = (doc || '').replace(/\D/g, '');
    if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
    if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.***/****-${d.slice(12)}`;
    return '';
  }

  brl(value: number): string {
    return formatBRL(value || 0);
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }

  private async toast(message: string, color: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3500, color, position: 'bottom' });
    await toast.present();
  }
}
