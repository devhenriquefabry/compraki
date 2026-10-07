import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertController, IonicModule, NavController, ToastController } from '@ionic/angular';

import { onAuthUserChanged } from '../../core/auth-state';
import {
  COUPON_LIMITS, COUPON_STATE_LABEL, CouponState, couponConditions, couponHeadline, couponState,
} from '../../core/coupons';
import { formatBRL } from '../../core/order-stage';
import { CouponEditorComponent } from '../../components/coupon-editor/coupon-editor.component';
import { Coupon } from '../../interfaces/coupon';
import { Product } from '../../interfaces/product';
import { CouponService } from '../../services/coupon.service';
import { FirebaseProducts } from '../../services/firebase-products';
import { FirebaseUsersService } from '../../services/firebase-users.service';

/**
 * "Cupons da loja": a loja cria cupom de % ou de valor fixo para os produtos
 * dela, acompanha quantos pedidos saíram com ele e quanto deu de desconto,
 * pausa, edita e encerra. Gravação pela Cloud Function `saveCoupon`.
 */
@Component({
  selector: 'app-my-coupons',
  templateUrl: './my-coupons.page.html',
  styleUrls: ['./my-coupons.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, CouponEditorComponent],
})
export class MyCouponsPage {
  private readonly service = inject(CouponService);
  private readonly productsService = inject(FirebaseProducts);
  private readonly users = inject(FirebaseUsersService);
  private readonly navCtrl = inject(NavController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly coupons = signal<Coupon[]>([]);
  readonly products = signal<Product[]>([]);
  readonly shopName = signal<string | null>(null);
  /** `new` = formulário vazio; um cupom = editando; `null` = lista. */
  readonly editing = signal<Coupon | 'new' | null>(null);
  readonly busy = signal<string | null>(null);

  readonly stateLabel = COUPON_STATE_LABEL;
  readonly headline = couponHeadline;
  readonly limits = COUPON_LIMITS;

  readonly activeCount = computed(() => this.coupons().filter(c => c.status === 'active').length);
  readonly ordersTotal = computed(() => this.coupons().reduce((s, c) => s + c.ordersCount, 0));
  readonly discountTotal = computed(() => this.coupons().reduce((s, c) => s + c.discountTotal, 0));
  readonly canCreate = computed(() => this.activeCount() < COUPON_LIMITS.sellerActiveMax);

  constructor() {
    let stop: (() => void) | undefined;
    const stopAuth = onAuthUserChanged(user => {
      stop?.();
      if (!user) {
        this.coupons.set([]);
        this.loading.set(false);
        return;
      }
      const subs = [
        this.service.watchMine(user.uid).subscribe({
          next: list => {
            this.coupons.set(list);
            this.loading.set(false);
          },
          error: err => {
            console.error('[cupons da loja]', err);
            this.error.set('Não deu para carregar seus cupons. Confira a conexão e tente de novo.');
            this.loading.set(false);
          },
        }),
        this.productsService.getBySeller(user.uid).subscribe(list => this.products.set(list)),
      ];
      void this.users.getUserById(user.uid).then(u => this.shopName.set(u?.shopName || u?.displayName || null));
      stop = () => subs.forEach(s => s.unsubscribe());
    });
    this.destroyRef.onDestroy(() => {
      stopAuth();
      stop?.();
    });
  }

  state(c: Coupon): CouponState {
    return couponState(c);
  }

  rules(c: Coupon): string[] {
    // Na lista da loja as datas vão no rodapé do cartão; o resto por extenso.
    return couponConditions(c, { withDates: false }).filter(line => !line.startsWith('Não acumula'));
  }

  period(c: Coupon): string {
    const fmt = (d: Date) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(d);
    const from = c.startsAt ? fmt(c.startsAt) : 'hoje';
    return c.endsAt ? `${from} até ${fmt(c.endsAt)}` : `desde ${from}`;
  }

  brl(value: number): string {
    return formatBRL(value || 0);
  }

  create() {
    this.editing.set('new');
    window.scrollTo?.({ top: 0 });
  }

  edit(c: Coupon) {
    this.editing.set(c);
  }

  editingCoupon(): Coupon | null {
    const e = this.editing();
    return e && e !== 'new' ? e : null;
  }

  async onSaved(code: string) {
    const wasNew = this.editing() === 'new';
    this.editing.set(null);
    await this.toast(wasNew ? `Cupom ${code} criado.` : `Cupom ${code} atualizado.`);
  }

  async copy(c: Coupon) {
    try {
      await navigator.clipboard.writeText(c.code);
      await this.toast(`Código ${c.code} copiado.`);
    } catch {
      await this.toast(`Código: ${c.code}`);
    }
  }

  async setStatus(c: Coupon, status: 'active' | 'paused') {
    await this.run(c.code, () => this.service.setStatus(c.code, status), status === 'active' ? 'Cupom reativado.' : 'Cupom pausado.');
  }

  async end(c: Coupon) {
    const neverUsed = c.redeemedCount === 0 && c.ordersCount === 0;
    const alert = await this.alertCtrl.create({
      header: neverUsed ? `Apagar ${c.code}?` : `Encerrar ${c.code}?`,
      message: neverUsed
        ? 'O cupom nunca foi usado e some da lista.'
        : 'O cupom para de valer agora e não pode ser reativado. Os pedidos que já usaram continuam com o desconto.',
      buttons: [
        { text: 'Voltar', role: 'cancel' },
        { text: neverUsed ? 'Apagar' : 'Encerrar', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;
    await this.run(
      c.code,
      () => (neverUsed ? this.service.remove(c.code) : this.service.setStatus(c.code, 'ended')),
      neverUsed ? 'Cupom apagado.' : 'Cupom encerrado.',
    );
  }

  private async run(code: string, job: () => Promise<void>, done: string) {
    this.busy.set(code);
    try {
      await job();
      await this.toast(done);
    } catch (e: any) {
      await this.toast(e?.message || 'Não foi possível concluir agora.', true);
    } finally {
      this.busy.set(null);
    }
  }

  private async toast(message: string, danger = false) {
    const t = await this.toastCtrl.create({ message, duration: 2600, position: 'top', color: danger ? 'danger' : undefined });
    await t.present();
  }

  goBack() {
    if (this.editing()) {
      this.editing.set(null);
      return;
    }
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }
}
