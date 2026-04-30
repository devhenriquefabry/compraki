import { Injectable } from '@angular/core';

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
    deliveryTime: 0
  };

  constructor() {}
}
