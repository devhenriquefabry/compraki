import { Injectable, signal } from '@angular/core';
import { CouponQuote } from '../interfaces/coupon';

/** Cupom aplicado no checkout: o código e o último cálculo do servidor. */
export interface AppliedCoupon {
  code: string;
  quote: CouponQuote;
  /** Frete usado no cálculo; mudou o frete, calcula de novo. */
  shippingPrice: number;
}

@Injectable({
  providedIn: 'root'
})
export class CheckoutStateService {
  paymentData: any = {
    method: 'PIX',
    buyerName: '',
    buyerCpf: '',
    buyerPhone: '',
    cardData: {
      holderName: '',
      number: '',
      expiry: '',
      ccv: ''
    }
  };

  addressData: any = {
    postalCode: '01001-000',
    addressNumber: '123',
    street: '',
    city: '',
    state: '',
    complement: '',
    neighborhood: ''
  };

  shippingData: any = {
    serviceId: null,
    serviceName: '',
    price: 0,
    quotedPrice: 0,
    freeShipping: false,
    deliveryTime: 0
  };

  /** Um cupom por pedido. `null` = sem cupom. */
  readonly coupon = signal<AppliedCoupon | null>(null);

  /** Desconto do cupom em vigor (0 sem cupom). */
  couponDiscount(): number {
    return this.coupon()?.quote.discount ?? 0;
  }

  constructor() {}
}
