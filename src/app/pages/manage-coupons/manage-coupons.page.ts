import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';

import {
  COUPON_STATE_LABEL, CouponState, couponConditions, couponHeadline, couponOwner, couponState,
} from '../../core/coupons';
import { formatBRL } from '../../core/order-stage';
import { CouponEditorComponent } from '../../components/coupon-editor/coupon-editor.component';
import { Coupon, CouponStatus } from '../../interfaces/coupon';
import { CouponService } from '../../services/coupon.service';

type ScopeFilter = 'all' | 'platform' | 'seller';
type StateFilter = 'live' | 'paused' | 'over' | 'all';

/**
 * Aba Cupons do painel: cria e edita os cupons da Vineon (desconto e frete
 * grátis) e acompanha os das lojas, com poder de pausar (moderação). A loja
 * não reativa um cupom que a Vineon pausou.
 */
@Component({
  selector: 'app-manage-coupons',
  templateUrl: './manage-coupons.page.html',
  styleUrls: ['./manage-coupons.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, CouponEditorComponent],
})
export class ManageCouponsPage {
  private readonly service = inject(CouponService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly coupons = signal<Coupon[]>([]);
  readonly scope = signal<ScopeFilter>('all');
  readonly stateFilter = signal<StateFilter>('live');
  readonly search = signal('');
  readonly editing = signal<Coupon | 'new' | null>(null);
  readonly busy = signal<string | null>(null);
  readonly open = signal<string | null>(null);

  readonly stateLabel = COUPON_STATE_LABEL;
  readonly headline = couponHeadline;
  readonly owner = couponOwner;

  readonly stats = computed(() => {
    const list = this.coupons();
    const sum = (scope: 'platform' | 'seller') =>
      list.filter(c => c.scope === scope).reduce((s, c) => s + c.discountTotal, 0);
    return {
      live: list.filter(c => couponState(c) === 'live').length,
      orders: list.reduce((s, c) => s + c.ordersCount, 0),
      platform: sum('platform'),
      seller: sum('seller'),
    };
  });

  readonly counts = computed(() => {
    const byScope = this.coupons().filter(c => this.scope() === 'all' || c.scope === this.scope());
    const bucket = (c: Coupon) => this.bucket(couponState(c));
    return {
      live: byScope.filter(c => bucket(c) === 'live').length,
      paused: byScope.filter(c => bucket(c) === 'paused').length,
      over: byScope.filter(c => bucket(c) === 'over').length,
      all: byScope.length,
    };
  });

  readonly visible = computed(() => {
    const term = this.search().trim().toLowerCase();
    return this.coupons().filter(c =>
      (this.scope() === 'all' || c.scope === this.scope())
      && (this.stateFilter() === 'all' || this.bucket(couponState(c)) === this.stateFilter())
      && (!term || c.code.toLowerCase().includes(term) || (c.sellerName || '').toLowerCase().includes(term)));
  });

  constructor() {
    const sub = this.service.watchAll().subscribe({
      next: list => {
        this.coupons.set(list);
        this.loading.set(false);
      },
      error: err => {
        console.error('[admin cupons]', err);
        this.error.set('Não deu para carregar os cupons.');
        this.loading.set(false);
      },
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  /** Agendado conta como "valendo"; vencido e esgotado como "encerrados". */
  private bucket(state: CouponState): Exclude<StateFilter, 'all'> {
    if (state === 'live' || state === 'scheduled') return 'live';
    if (state === 'paused') return 'paused';
    return 'over';
  }

  state(c: Coupon): CouponState {
    return couponState(c);
  }

  rules(c: Coupon): string[] {
    return couponConditions(c);
  }

  usage(c: Coupon): string {
    return c.usageLimit ? `${c.redeemedCount} de ${c.usageLimit}` : `${c.redeemedCount}`;
  }

  period(c: Coupon): string {
    const fmt = (d: Date) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
    const from = c.startsAt ? fmt(c.startsAt) : '—';
    return c.endsAt ? `${from} → ${fmt(c.endsAt)}` : `${from} → sem fim`;
  }

  brl(value: number): string {
    return formatBRL(value || 0);
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

  async setStatus(c: Coupon, status: CouponStatus) {
    if (status === 'paused' && c.scope === 'seller') {
      const ok = await this.confirm(
        `Pausar ${c.code}?`,
        `O cupom da loja ${c.sellerName || ''} para de valer e a loja não consegue reativar sozinha. Avise a loja pelo atendimento.`,
        'Pausar',
      );
      if (!ok) return;
    }
    await this.run(c.code, () => this.service.setStatus(c.code, status), status === 'active' ? 'Cupom reativado.' : 'Cupom pausado.');
  }

  async end(c: Coupon) {
    const neverUsed = c.redeemedCount === 0 && c.ordersCount === 0;
    const ok = await this.confirm(
      neverUsed ? `Apagar ${c.code}?` : `Encerrar ${c.code}?`,
      neverUsed
        ? 'O cupom nunca foi usado e some da lista.'
        : 'O cupom para de valer agora e não volta. Pedidos que já usaram continuam com o desconto.',
      neverUsed ? 'Apagar' : 'Encerrar',
    );
    if (!ok) return;
    await this.run(
      c.code,
      () => (neverUsed ? this.service.remove(c.code) : this.service.setStatus(c.code, 'ended')),
      neverUsed ? 'Cupom apagado.' : 'Cupom encerrado.',
    );
  }

  async copy(c: Coupon) {
    try {
      await navigator.clipboard.writeText(c.code);
      await this.toast(`Código ${c.code} copiado.`);
    } catch {
      await this.toast(`Código: ${c.code}`);
    }
  }

  private async confirm(header: string, message: string, action: string): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: [{ text: 'Voltar', role: 'cancel' }, { text: action, role: 'destructive' }],
    });
    await alert.present();
    return (await alert.onDidDismiss()).role === 'destructive';
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
}
