import { Component, DoCheck, Input, OnChanges, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

import {
  couponConditions, couponCoversProduct, couponHeadline, couponOwner, isCouponLive, normalizeCouponCode,
} from 'src/app/core/coupons';
import { CartItem } from 'src/app/interfaces/cart-item';
import { Coupon } from 'src/app/interfaces/coupon';
import { CheckoutStateService } from 'src/app/services/checkout-state.service';
import { CouponService } from 'src/app/services/coupon.service';

/**
 * "Cupom de desconto" no checkout: digitar um código ou tocar num dos cupons
 * públicos que servem para este carrinho. Um cupom por pedido.
 *
 * O desconto vem sempre do servidor (`couponQuote`). Mudou o frete ou o
 * carrinho, calcula de novo; se o cupom deixou de valer, sai com o motivo.
 * O cupom aplicado fica em `CheckoutStateService.coupon`, que o total e o
 * "Finalizar compra" leem.
 */
@Component({
  selector: 'app-checkout-coupon',
  templateUrl: './checkout-coupon.component.html',
  styleUrls: ['./checkout-coupon.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule],
})
export class CheckoutCouponComponent implements OnInit, OnChanges, DoCheck {
  @Input() items: CartItem[] = [];
  @Input() readOnly = false;

  private readonly state = inject(CheckoutStateService);
  private readonly coupons = inject(CouponService);

  readonly applied = this.state.coupon;
  readonly code = signal('');
  readonly busy = signal<string | null>(null);
  readonly error = signal('');
  /** Aviso de cupom que saiu sozinho (frete mudou, carrinho mudou...). */
  readonly notice = signal('');
  readonly available = signal<Coupon[]>([]);
  readonly showRules = signal<string | null>(null);

  private allPublic: Coupon[] = [];
  private requoting = false;

  readonly headline = couponHeadline;
  readonly owner = couponOwner;
  readonly conditions = (c: Coupon) => couponConditions(c);

  ngOnInit() {
    void this.loadAvailable();
  }

  ngOnChanges() {
    this.filterAvailable();
    // Carrinho mudou com cupom aplicado: confere de novo.
    if (this.applied()) void this.requote();
  }

  /** O frete é um objeto comum do estado; mudou o preço, recalcula. */
  ngDoCheck() {
    const applied = this.applied();
    if (applied && !this.requoting && this.shippingPrice() !== applied.shippingPrice) void this.requote();
  }

  private shippingPrice(): number {
    return Number(this.state.shippingData?.price) || 0;
  }

  private async loadAvailable() {
    try {
      this.allPublic = await this.coupons.listPublic();
    } catch {
      this.allPublic = [];
    }
    this.filterAvailable();
  }

  /** Públicos, valendo, que cobrem algum item do carrinho. Frete grátis só com frete cobrado. */
  private filterAvailable() {
    const now = Date.now();
    const list = this.allPublic.filter(c =>
      isCouponLive(c, now)
      && this.items.some(item => couponCoversProduct(c, item.productId || item.productData?.id, item.productData?.sellerId)));
    // Loja primeiro (o que o comprador mais procura), depois Vineon; maior número na frente.
    list.sort((a, b) => (a.scope === b.scope ? b.value - a.value : a.scope === 'seller' ? -1 : 1));
    this.available.set(list.slice(0, 6));
  }

  async apply(raw?: string) {
    const code = normalizeCouponCode(raw ?? this.code());
    this.error.set('');
    this.notice.set('');
    if (!code) {
      this.error.set('Digite o código do cupom.');
      return;
    }
    this.busy.set(code);
    try {
      const shippingPrice = this.shippingPrice();
      const quote = await this.coupons.preview(code, this.items, shippingPrice);
      this.state.coupon.set({ code: quote.code, quote, shippingPrice });
      this.code.set('');
    } catch (e: any) {
      this.error.set(e?.message || 'Não foi possível aplicar o cupom.');
    } finally {
      this.busy.set(null);
    }
  }

  remove() {
    this.state.coupon.set(null);
    this.error.set('');
    this.notice.set('');
  }

  private async requote() {
    const applied = this.applied();
    if (!applied || this.requoting) return;
    this.requoting = true;
    const shippingPrice = this.shippingPrice();
    try {
      const quote = await this.coupons.preview(applied.code, this.items, shippingPrice);
      this.state.coupon.set({ code: quote.code, quote, shippingPrice });
    } catch (e: any) {
      this.state.coupon.set(null);
      this.notice.set(`O cupom ${applied.code} saiu do pedido: ${e?.message || 'ele não vale mais para este carrinho.'}`);
    } finally {
      this.requoting = false;
    }
  }

  isApplied(c: Coupon): boolean {
    return this.applied()?.code === c.code;
  }

  toggleRules(code: string) {
    this.showRules.set(this.showRules() === code ? null : code);
  }

  brl(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
