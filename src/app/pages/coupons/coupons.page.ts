import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IonicModule, NavController, ToastController } from '@ionic/angular';

import { couponConditions, couponHeadline, couponOwner, isCouponLive } from '../../core/coupons';
import { Coupon } from '../../interfaces/coupon';
import { CouponService } from '../../services/coupon.service';

/**
 * "Cupons": os cupons públicos valendo agora, da Vineon e das lojas, com as
 * regras por extenso. Aberta para quem ainda não tem conta (vitrine pública).
 * Usa no checkout, digitando o código ou tocando em "Aplicar" lá.
 */
@Component({
  selector: 'app-coupons',
  templateUrl: './coupons.page.html',
  styleUrls: ['./coupons.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterLink],
})
export class CouponsPage {
  private readonly service = inject(CouponService);
  private readonly navCtrl = inject(NavController);
  private readonly toastCtrl = inject(ToastController);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly coupons = signal<Coupon[]>([]);
  readonly open = signal<string | null>(null);

  readonly headline = couponHeadline;
  readonly owner = couponOwner;

  readonly vineon = computed(() => this.coupons().filter(c => c.scope === 'platform'));
  readonly stores = computed(() => this.coupons().filter(c => c.scope === 'seller'));

  constructor() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const now = Date.now();
      const list = (await this.service.listPublic()).filter(c => isCouponLive(c, now));
      // Os que acabam antes primeiro; sem data no fim.
      list.sort((a, b) => (a.endsAt?.getTime() ?? Infinity) - (b.endsAt?.getTime() ?? Infinity));
      this.coupons.set(list);
    } catch (err) {
      console.error('[cupons]', err);
      this.error.set('Não deu para carregar os cupons. Confira a conexão e tente de novo.');
    } finally {
      this.loading.set(false);
    }
  }

  rules(c: Coupon): string[] {
    return couponConditions(c);
  }

  endsSoon(c: Coupon): boolean {
    return !!c.endsAt && c.endsAt.getTime() - Date.now() < 3 * 86_400_000;
  }

  until(c: Coupon): string {
    if (!c.endsAt) return 'Sem data de término';
    const days = Math.ceil((c.endsAt.getTime() - Date.now()) / 86_400_000);
    if (days <= 1) return 'Acaba hoje';
    if (days <= 3) return `Acaba em ${days} dias`;
    return `Até ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(c.endsAt)}`;
  }

  toggle(code: string) {
    this.open.set(this.open() === code ? null : code);
  }

  async copy(c: Coupon) {
    let message = `Código ${c.code} copiado. Cole no checkout, na etapa Entrega.`;
    try {
      await navigator.clipboard.writeText(c.code);
    } catch {
      message = `Código: ${c.code}. Use no checkout, na etapa Entrega.`;
    }
    const t = await this.toastCtrl.create({ message, duration: 2800, position: 'top' });
    await t.present();
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }
}
