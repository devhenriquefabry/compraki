import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { getFirebaseAuth } from '../core/auth-state';

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

export interface AsaasPaymentResult {
  id: string;
  status: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  pixQrCode?: {
    encodedImage?: string;
    payload?: string;
    expirationDate?: string;
  } | null;
}

/**
 * Cliente do Asaas — via Cloud Functions.
 *
 * A chave de produção NÃO mora mais aqui. Antes ela estava literal neste
 * arquivo, o que a colocava dentro do bundle publicado e no histórico do Git;
 * qualquer pessoa com o app aberto conseguia extrair e emitir cobranças.
 * Agora a chave só existe em `functions/.env` (`ASAAS_API_KEY`) e o app fala
 * apenas com endpoints que verificam o ID token.
 *
 * NÃO reintroduzir chave, token ou segredo neste arquivo — nem em nenhum
 * outro sob `src/`. Tudo que está em `src/` vai para o navegador.
 */
@Injectable({
  providedIn: 'root'
})
export class AsaasService {
  private readonly functionsBaseUrl = environment.functionsBaseUrl;

  private async authorizedFetch<T>(fnName: string, init: RequestInit = {}): Promise<T> {
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      throw new Error('Você precisa estar logado para concluir o pagamento.');
    }

    const token = await user.getIdToken();

    const response = await fetch(`${this.functionsBaseUrl}/${fnName}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {})
      }
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(data?.error || 'Não foi possível concluir a operação.');
    }

    return data as T;
  }

  /**
   * Garante o cadastro do usuário logado no Asaas.
   * O `customerId` fica guardado no servidor — o app não escolhe para qual
   * cliente a cobrança vai.
   */
  async createCustomer(customer: AsaasCustomer): Promise<{ id: string; reused: boolean }> {
    return this.authorizedFetch('createAsaasCustomer', {
      method: 'POST',
      body: JSON.stringify({
        name: customer.name,
        cpfCnpj: customer.cpfCnpj,
        email: customer.email,
        phone: customer.phone
      })
    });
  }

  /**
   * Cria a cobrança do usuário logado.
   *
   * `customerId` continua na assinatura por compatibilidade com os chamadores
   * existentes, mas é ignorado: o servidor resolve o cliente pelo ID token.
   */
  async createPayment(
    _customerId: string,
    billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX',
    value: number,
    dueDate: string,
    creditCard?: CreditCardData,
    creditCardHolderInfo?: CreditCardHolderInfo
  ): Promise<AsaasPaymentResult> {
    return this.authorizedFetch('createAsaasPayment', {
      method: 'POST',
      body: JSON.stringify({
        billingType,
        value,
        dueDate,
        creditCard: billingType === 'CREDIT_CARD' ? creditCard : undefined,
        creditCardHolderInfo: billingType === 'CREDIT_CARD' ? creditCardHolderInfo : undefined
      })
    });
  }

  /**
   * O QR Code do PIX já volta dentro de `createPayment`. Este método existe
   * para os chamadores antigos e faz uma consulta à cobrança.
   */
  async getPixQrCode(paymentId: string): Promise<unknown> {
    const payment = await this.getPayment(paymentId);
    return (payment as { pixQrCode?: unknown })?.pixQrCode ?? null;
  }

  /** Consulta o status de uma cobrança do próprio usuário. */
  async getPayment(paymentId: string): Promise<unknown> {
    return this.authorizedFetch(
      `getAsaasPayment?paymentId=${encodeURIComponent(paymentId)}`,
      { method: 'GET' }
    );
  }

  /**
   * Estorno — exige privilégio de administrador no servidor.
   * Um usuário comum recebe 403.
   */
  async refundPayment(paymentId: string, value?: number, description?: string): Promise<unknown> {
    return this.authorizedFetch('refundAsaasPayment', {
      method: 'POST',
      body: JSON.stringify({ paymentId, value, description })
    });
  }

  /**
   * REMOVIDO: busca de cliente por CPF.
   *
   * Consultar a base de clientes do Asaas por CPF a partir do app permitiria
   * enumerar clientes. O vínculo usuário → cliente Asaas agora é resolvido no
   * servidor por `createCustomer()`.
   */
  async getCustomerByCpf(_cpfCnpj: string): Promise<null> {
    console.warn(
      'getCustomerByCpf foi descontinuado. Use createCustomer(), que reaproveita o cadastro existente.'
    );
    return null;
  }
}
