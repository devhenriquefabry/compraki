import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { getFirebaseAuth } from '../core/auth-state';

export interface CoraChargeRequest {
  billingType: 'PIX' | 'BOLETO';
  value: number;
  dueDate: string;
  description?: string;
  customer: { name: string; cpfCnpj: string; email?: string };
  address?: {
    street?: string;
    number?: string;
    district?: string;
    city?: string;
    state?: string;
    complement?: string;
    zipCode?: string;
  };
}

export interface CoraCharge {
  id: string;
  status: string;
  /** PIX copia e cola (EMV). O QR Code é gerado a partir dele no app. */
  pixCode: string | null;
  bankSlipUrl: string | null;
  digitableLine: string | null;
  /** `true` quando as Functions estão no stage do Cora (dinheiro de mentira). */
  sandbox: boolean;
}

export interface CoraSyncResult {
  invoiceStatus: string;
  orderId?: string;
  orderStatus?: string;
  changed: boolean;
  reason?: string;
}

/**
 * PIX e boleto pelo Cora — via Cloud Functions.
 *
 * O Cora autentica por certificado (mTLS); certificado e chave vivem só em
 * `functions/.env`. NÃO trazer credencial do Cora para nenhum arquivo sob
 * `src/` — tudo aqui vai para o navegador.
 */
@Injectable({
  providedIn: 'root'
})
export class CoraService {
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

  createCharge(charge: CoraChargeRequest): Promise<CoraCharge> {
    return this.authorizedFetch('createCoraCharge', {
      method: 'POST',
      body: JSON.stringify(charge)
    });
  }

  getCharge(invoiceId: string): Promise<CoraCharge> {
    return this.authorizedFetch(`getCoraCharge?invoiceId=${encodeURIComponent(invoiceId)}`, { method: 'GET' });
  }

  /** "Já paguei": o servidor pergunta ao Cora e atualiza o pedido na hora. */
  syncCharge(invoiceId: string): Promise<CoraSyncResult> {
    return this.authorizedFetch('syncCoraCharge', {
      method: 'POST',
      body: JSON.stringify({ invoiceId })
    });
  }

  /** Só funciona com as Functions no stage do Cora — o servidor recusa em produção. */
  simulatePayment(invoiceId: string): Promise<CoraSyncResult> {
    return this.authorizedFetch('simulateCoraPayment', {
      method: 'POST',
      body: JSON.stringify({ invoiceId })
    });
  }
}
