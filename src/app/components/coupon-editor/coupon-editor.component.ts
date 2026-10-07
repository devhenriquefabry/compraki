import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

import {
  COUPON_LIMITS, couponConditions, couponHeadline, couponOwner, isValidCouponCode, normalizeCouponCode,
} from '../../core/coupons';
import { Coupon, CouponInput, CouponType, CouponVisibility } from '../../interfaces/coupon';
import { Product } from '../../interfaces/product';
import { CouponService } from '../../services/coupon.service';

const DAY = 86_400_000;

/**
 * Formulário de cupom, o mesmo para a loja ("Cupons da loja") e para o admin
 * (aba Cupons). A loja só dá desconto em % ou R$ nos produtos dela e precisa
 * de data final; o admin também cria frete grátis e cupom de 1ª compra.
 *
 * Ao lado (embaixo no celular) fica a prévia: o cupom do jeito que o
 * comprador vai ver, com as regras por extenso.
 */
@Component({
  selector: 'app-coupon-editor',
  templateUrl: './coupon-editor.component.html',
  styleUrls: ['./coupon-editor.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class CouponEditorComponent implements OnInit {
  @Input() mode: 'seller' | 'admin' = 'seller';
  /** Cupom a editar; sem ele, cria um novo. */
  @Input() coupon: Coupon | null = null;
  /** Anúncios da loja, para escolher em quais o cupom vale. */
  @Input() products: Product[] = [];
  @Input() sellerName: string | null = null;
  @Output() saved = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly service = inject(CouponService);

  readonly limits = COUPON_LIMITS;
  readonly code = signal('');
  readonly type = signal<CouponType>('percent');
  readonly value = signal<number | null>(10);
  readonly maxDiscount = signal<number | null>(null);
  readonly minSubtotal = signal<number | null>(null);
  readonly allProducts = signal(true);
  readonly productIds = signal<string[]>([]);
  readonly startsAt = signal(dateInput(Date.now()));
  readonly endsAt = signal(dateInput(Date.now() + 30 * DAY));
  readonly usageLimit = signal<number | null>(null);
  readonly perUserLimit = signal(1);
  readonly firstPurchaseOnly = signal(false);
  readonly visibility = signal<CouponVisibility>('public');
  readonly saving = signal(false);
  readonly error = signal('');
  readonly productFilter = signal('');

  get isEdit(): boolean {
    return !!this.coupon;
  }

  readonly visibleProducts = computed(() => {
    const term = this.productFilter().trim().toLowerCase();
    return this.products.filter(p => !term || (p.name || '').toLowerCase().includes(term)).slice(0, 80);
  });

  /** O cupom como o comprador vai ver, montado com o que está no formulário. */
  readonly preview = computed<Coupon>(() => ({
    code: normalizeCouponCode(this.code()) || 'SEUCODIGO',
    scope: this.mode === 'admin' ? 'platform' : 'seller',
    sellerId: null,
    sellerName: this.sellerName,
    type: this.type(),
    value: Number(this.value()) || 0,
    maxDiscount: this.type() === 'percent' ? (Number(this.maxDiscount()) || null) : null,
    minSubtotal: Number(this.minSubtotal()) || 0,
    productIds: this.mode === 'seller' && !this.allProducts() ? this.productIds() : [],
    startsAt: fromDateInput(this.startsAt(), false),
    endsAt: this.endsAt() ? fromDateInput(this.endsAt(), true) : null,
    usageLimit: Number(this.usageLimit()) || null,
    perUserLimit: Number(this.perUserLimit()) || 1,
    firstPurchaseOnly: this.mode === 'admin' && this.firstPurchaseOnly(),
    visibility: this.visibility(),
    status: 'active',
    redeemedCount: this.coupon?.redeemedCount ?? 0,
    ordersCount: 0,
    discountTotal: 0,
    pausedByAdmin: false,
    createdAt: null,
  }));

  readonly previewHeadline = computed(() => couponHeadline(this.preview()));
  readonly previewOwner = computed(() => couponOwner(this.preview()));
  readonly previewConditions = computed(() => couponConditions(this.preview()));

  ngOnInit() {
    const c = this.coupon;
    if (!c) return;
    this.code.set(c.code);
    this.type.set(c.type);
    this.value.set(c.value);
    this.maxDiscount.set(c.maxDiscount);
    this.minSubtotal.set(c.minSubtotal || null);
    this.allProducts.set(!c.productIds.length);
    this.productIds.set([...c.productIds]);
    this.startsAt.set(dateInput((c.startsAt ?? new Date()).getTime()));
    this.endsAt.set(c.endsAt ? dateInput(c.endsAt.getTime()) : '');
    this.usageLimit.set(c.usageLimit);
    this.perUserLimit.set(c.perUserLimit);
    this.firstPurchaseOnly.set(c.firstPurchaseOnly);
    this.visibility.set(c.visibility);
  }

  setType(type: CouponType) {
    this.type.set(type);
    if (type === 'percent' && !this.value()) this.value.set(10);
    if (type === 'shipping') this.value.set(null);
  }

  num(event: Event): number | null {
    const raw = (event.target as HTMLInputElement).value.replace(',', '.');
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  toggleProduct(id: string) {
    const list = this.productIds();
    this.productIds.set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  }

  /** Mesmas regras do servidor, para errar antes de enviar. */
  private validate(): string | null {
    const code = normalizeCouponCode(this.code());
    if (!isValidCouponCode(code)) return `O código precisa ter de ${COUPON_LIMITS.codeMin} a ${COUPON_LIMITS.codeMax} letras ou números, sem espaço nem acento.`;
    const value = Number(this.value()) || 0;
    if (this.type() === 'percent' && !(Number.isInteger(value) && value >= 1 && value <= COUPON_LIMITS.percentMax)) {
      return `A porcentagem vai de 1% a ${COUPON_LIMITS.percentMax}%, sem casas decimais.`;
    }
    if (this.type() === 'fixed' && !(value >= 1 && value <= COUPON_LIMITS.fixedMax)) return 'O desconto em reais vai de R$ 1 a R$ 10.000.';
    const min = Number(this.minSubtotal()) || 0;
    if (this.type() === 'fixed' && min > 0 && value > min) return 'O desconto não pode ser maior que a compra mínima.';
    if (this.mode === 'seller' && !this.allProducts() && !this.productIds().length) return 'Escolha pelo menos um produto, ou marque "Todos os produtos da loja".';
    if (this.mode === 'seller' && !this.endsAt()) return 'Defina até quando o cupom vale.';
    if (this.endsAt() && fromDateInput(this.endsAt(), true).getTime() <= Math.max(Date.now(), fromDateInput(this.startsAt(), false).getTime())) {
      return 'A data final precisa ser depois do início e de hoje.';
    }
    return null;
  }

  async save() {
    const problem = this.validate();
    if (problem) {
      this.error.set(problem);
      return;
    }
    const startDay = fromDateInput(this.startsAt(), false).getTime();
    const input: CouponInput = {
      code: normalizeCouponCode(this.code()),
      type: this.type(),
      value: Number(this.value()) || 0,
      maxDiscount: this.type() === 'percent' ? (Number(this.maxDiscount()) || null) : null,
      minSubtotal: Number(this.minSubtotal()) || 0,
      productIds: this.mode === 'seller' && !this.allProducts() ? this.productIds() : [],
      // Começa hoje = começa agora (meia-noite já passou).
      startsAt: startDay <= Date.now() ? null : startDay,
      endsAt: this.endsAt() ? fromDateInput(this.endsAt(), true).getTime() : null,
      usageLimit: Number(this.usageLimit()) || null,
      perUserLimit: Number(this.perUserLimit()) || 1,
      firstPurchaseOnly: this.mode === 'admin' && this.firstPurchaseOnly(),
      visibility: this.visibility(),
    };
    this.saving.set(true);
    this.error.set('');
    try {
      if (this.isEdit) await this.service.update(input);
      else await this.service.create(input);
      this.saved.emit(input.code);
    } catch (e: any) {
      this.error.set(e?.message || 'Não foi possível salvar o cupom.');
    } finally {
      this.saving.set(false);
    }
  }

  photo(p: Product): string | null {
    return p.photoURL?.[0] ?? null;
  }

  today(): string {
    return dateInput(Date.now());
  }
}

/** Data local no formato do `<input type="date">`. */
function dateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Início do dia (00:00) ou fim do dia (23:59:59), no horário de quem preenche. */
function fromDateInput(value: string, endOfDay: boolean): Date {
  const [y, m, d] = (value || '').split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d, 0, 0, 0);
}
