import { Injectable } from '@angular/core';

export interface AsaasCustomer {
  id?: string;
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
}

export interface CreditCardData {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface CreditCardHolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

@Injectable({
  providedIn: 'root'
})
export class AsaasService {
  // ATENÇÃO: Proxy url configured in angular.json. Request will be intercepted and sent to https://api.asaas.com
  // Chave original: $aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjczYjFjZTkyLTVlZmEtNGMxMS1hMjczLTY0OWM1ZWJjZTg4OTo6JGFhY2hfNWQ3NzFkMjYtNDZlNy00NjYzLTk4MWMtMTczZGZjNjA3NDYy
  private apiUrl = '/asaas-api'; 
  private apiKey = '$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjczYjFjZTkyLTVlZmEtNGMxMS1hMjczLTY0OWM1ZWJjZTg4OTo6JGFhY2hfNWQ3NzFkMjYtNDZlNy00NjYzLTk4MWMtMTczZGZjNjA3NDYy';

  constructor() {}

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'access_token': this.apiKey
    };
  }

  // 1. Criar Cliente
  async createCustomer(customer: AsaasCustomer): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v3/customers`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(customer)
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.description || 'Erro ao criar cliente no Asaas');
    }
    return data;
  }

  // Pesquisar Cliente
  async getCustomerByCpf(cpfCnpj: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v3/customers?cpfCnpj=${cpfCnpj}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error('Erro ao buscar cliente');
    }
    
    if (data.data && data.data.length > 0) {
      return data.data[0];
    }
    return null;
  }

  // 2. Criar Pagamento
  async createPayment(
    customerId: string, 
    billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX', 
    value: number,
    dueDate: string, // YYYY-MM-DD
    creditCard?: CreditCardData,
    creditCardHolderInfo?: CreditCardHolderInfo
  ): Promise<any> {
    
    const payload: any = {
      customer: customerId,
      billingType: billingType,
      value: value,
      dueDate: dueDate,
      description: 'Compra no App Compraki'
    };

    if (billingType === 'CREDIT_CARD' && creditCard && creditCardHolderInfo) {
      payload.creditCard = creditCard;
      payload.creditCardHolderInfo = creditCardHolderInfo;
    }

    const response = await fetch(`${this.apiUrl}/v3/payments`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.description || 'Erro ao processar pagamento');
    }
    return data;
  }

  // Recuperar QRCode do PIX
  async getPixQrCode(paymentId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v3/payments/${paymentId}/pixQrCode`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error('Erro ao buscar PIX QR Code');
    }
    return data;
  }

  // 3. Estornar Pagamento
  async refundPayment(paymentId: string, value?: number, description?: string): Promise<any> {
    const payload: any = {};
    if (value) payload.value = value;
    if (description) payload.description = description;

    const response = await fetch(`${this.apiUrl}/v3/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.description || 'Erro ao processar estorno no Asaas');
    }
    return data;
  }
}
