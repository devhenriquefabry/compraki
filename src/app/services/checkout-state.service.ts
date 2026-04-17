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
    // Para simplificar, poderíamos armazenar também o endereço, 
    // mas no momento precisamos focar no pagamento e dados como CEP para o Asaas.
    postalCode: '01001-000',
    addressNumber: '123'
  };

  constructor() {}
}
