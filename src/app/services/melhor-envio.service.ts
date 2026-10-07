import { Injectable, isDevMode } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, map, of } from 'rxjs';
import { MelhorEnvioConfig, MelhorEnvioSettings, ShippingAnalysis, ShippingQuote } from '../interfaces/shipping';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class MelhorEnvioService {
  private auth: Auth;
  private functionsBaseUrl = environment.functionsBaseUrl;

  constructor(private http: HttpClient) {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.auth = getAuth(app);
  }


  /**
   * Configuração do Melhor Envio (aba do admin). Vem da Cloud Function
   * `melhorEnvioSettings`: `settings/` é fechado no Firestore e o token nunca
   * volta para o navegador (só `hasToken` e os 4 últimos caracteres).
   */
  getSettings(): Observable<MelhorEnvioSettings> {
    return from(this.callFunction<MelhorEnvioSettings>('melhorEnvioSettings'));
  }

  /** Salva a configuração. `accessToken` vazio mantém o token atual. */
  saveSettings(config: MelhorEnvioConfig): Observable<MelhorEnvioSettings> {
    return from(this.callFunction<MelhorEnvioSettings>('melhorEnvioSettings', { method: 'POST', body: config }));
  }

  getUserInfo(config: MelhorEnvioConfig): Observable<any> {
    return from(this.callFunction<any>('getMelhorEnvioMe'));
  }


  /** O `config` não é usado: a function lê a configuração no servidor. */
  getQuotes(_config: MelhorEnvioConfig | null, zipTo: string, products: any[]): Observable<ShippingQuote[]> {
    const payload = {
      zipTo: zipTo,
      products: products.map(p => ({
        id: p.id || 'prod',
        width: p.width || 10,
        height: p.height || 10,
        length: p.length || 10,
        weight: p.weight || 0.1,
        insurance_value: p.priceDiscounted || p.price || 10,
        quantity: p.quantity || 1
      }))
    };

    return from(this.callFunction<any[]>('calculateMelhorEnvioShipping', {
      method: 'POST',
      body: payload
    })).pipe(
      map(res => {
        if (!Array.isArray(res)) return [];
        return res.filter(q => !q.error).map(q => ({
          id: q.id,
          name: q.name,
          price: parseFloat(q.price),
          delivery_time: q.delivery_time,
          company: {
            name: q.company.name,
            picture: q.company.picture
          }
        }));
      })
    );
  }

  /**
   * Compra e gera a etiqueta de um pedido pago. Quem monta o envio (remetente,
   * destinatário, volumes) e confere se a pessoa é a loja do pedido é o servidor.
   */
  createLabel(orderId: string): Observable<{ shipmentId: string; labelStatus: string }> {
    return from(this.callFunction<{ shipmentId: string; labelStatus: string }>('createMelhorEnvioShipment', {
      method: 'POST',
      body: { orderId }
    }));
  }

  /** Link do PDF da etiqueta do pedido. */
  getLabelUrl(orderId: string): Observable<{ url?: string }> {
    return from(this.callFunction<{ url?: string }>('printMelhorEnvioLabel', {
      method: 'POST',
      body: { orderId }
    }));
  }

  /** Rastreio do envio do pedido (comprador, loja ou admin). */
  getTracking(orderId: string): Observable<any> {
    return from(this.callFunction<any>('trackMelhorEnvioShipment', {
      method: 'POST',
      body: { orderId }
    }));
  }

  private async callFunction<T>(
    functionName: string,
    options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}
  ): Promise<T> {
    const token = await this.auth.currentUser?.getIdToken();
    
    const headers: any = {
      'Content-Type': 'application/json'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.functionsBaseUrl}/${functionName}`, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = typeof data?.error === 'string'
        ? data.error
        : 'Erro ao chamar serviço do Melhor Envio.';
      throw new Error(errorMessage);
    }

    return data as T;
  }

  getAnalysis(config: MelhorEnvioConfig): Observable<ShippingAnalysis> {
    return from(this.callFunction<any>('listMelhorEnvioShipments')).pipe(
      map(res => {
        const orders = res.data || [];
        const analysis: ShippingAnalysis = {
          totalSpent: 0,
          totalLabelsGenerated: orders.length,
          averageCost: 0,
          statusSummary: { pending: 0, released: 0, posted: 0, delivered: 0, cancelled: 0 },
          carrierPerformance: []
        };

        const carrierMap = new Map<string, { count: number, total: number }>();

        orders.forEach((o: any) => {
          const price = parseFloat(o.price || 0);
          analysis.totalSpent += price;
          
          const carrier = o.service?.name || 'Desconhecido';
          const current = carrierMap.get(carrier) || { count: 0, total: 0 };
          carrierMap.set(carrier, { count: current.count + 1, total: current.total + price });

          const status = o.status;
          if (status === 'pending') analysis.statusSummary.pending++;
          else if (status === 'released') analysis.statusSummary.released++;
          else if (status === 'posted') analysis.statusSummary.posted++;
          else if (status === 'delivered') analysis.statusSummary.delivered++;
          else if (status === 'cancelled') analysis.statusSummary.cancelled++;
        });

        analysis.averageCost = orders.length > 0 ? analysis.totalSpent / orders.length : 0;
        
        carrierMap.forEach((val, key) => {
          analysis.carrierPerformance.push({
            carrier: key,
            count: val.count,
            totalCost: val.total
          });
        });

        return analysis;
      })
    );
  }
}
