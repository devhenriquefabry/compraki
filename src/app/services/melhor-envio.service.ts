import { Injectable, isDevMode } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, map, of } from 'rxjs';
import { MelhorEnvioConfig, ShippingAnalysis, ShippingQuote } from '../interfaces/shipping';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, Firestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class MelhorEnvioService {
  private db: Firestore;
  private auth: Auth;
  private functionsBaseUrl = `https://us-central1-${environment.firebase.projectId}.cloudfunctions.net`;

  constructor(private http: HttpClient) {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
    this.auth = getAuth(app);
  }


  getConfig(): Observable<MelhorEnvioConfig | null> {
    const configRef = doc(this.db, 'settings', 'melhor_envio');
    return from(getDoc(configRef)).pipe(
      map(snap => snap.exists() ? snap.data() as MelhorEnvioConfig : null)
    );
  }

  saveConfig(config: MelhorEnvioConfig): Observable<boolean> {
    const configRef = doc(this.db, 'settings', 'melhor_envio');
    return from(setDoc(configRef, config)).pipe(map(() => true));
  }

  getUserInfo(config: MelhorEnvioConfig): Observable<any> {
    return from(this.callFunction<any>('getMelhorEnvioMe'));
  }


  getQuotes(config: MelhorEnvioConfig, zipTo: string, products: any[]): Observable<ShippingQuote[]> {
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

  addToCart(config: MelhorEnvioConfig, order: any): Observable<any> {
    const payload = {
      service: order.shippingInfo?.serviceId,
      agency: 1, 
      from: {
        name: config.senderName,
        phone: config.senderPhone.replace(/\D/g, ''),
        email: config.senderEmail,
        document: config.senderCpfCnpj.replace(/\D/g, ''),
        address: config.address.street,
        number: config.address.number,
        district: config.address.district,
        city: config.address.city,
        state: config.address.state,
        postal_code: config.address.zipCode.replace(/\D/g, '')
      },
      to: {
        name: order.customerData.name,
        phone: order.customerData.phone.replace(/\D/g, ''),
        email: order.customerData.email,
        document: order.customerData.cpf.replace(/\D/g, ''),
        address: order.addressData.street,
        number: order.addressData.number,
        complement: order.addressData.complement || '',
        district: order.addressData.neighborhood || 'Bairro',
        city: order.addressData.city,
        state: order.addressData.state,
        postal_code: order.addressData.postalCode.replace(/\D/g, '')
      },
      products: order.items.map((item: any) => ({
        name: item.productData.name,
        quantity: item.quantity,
        unitary_value: item.productData.priceDiscounted || item.productData.price
      })),
      volumes: order.items.map((item: any) => ({
        height: item.productData.height || 10,
        width: item.productData.width || 10,
        length: item.productData.length || 15,
        weight: item.productData.weight || 0.1
      })),
      options: {
        insurance_value: order.total - (order.shippingInfo?.price || 0),
        receipt: false,
        own_hand: false,
        reverse: false,
        non_commercial: true 
      }
    };

    return from(this.callFunction<any>('createMelhorEnvioShipment', {
      method: 'POST',
      body: payload
    }));
  }

  checkout(config: MelhorEnvioConfig, shipmentIds: string[]): Observable<any> {
    return from(this.callFunction<any>('checkoutMelhorEnvioShipment', {
      method: 'POST',
      body: { shipmentIds }
    }));
  }

  generateLabel(config: MelhorEnvioConfig, shipmentIds: string[]): Observable<any> {
    return from(this.callFunction<any>('generateMelhorEnvioLabel', {
      method: 'POST',
      body: { shipmentIds }
    }));
  }

  getLabelUrl(config: MelhorEnvioConfig, shipmentIds: string[]): Observable<any> {
    return from(this.callFunction<any>('printMelhorEnvioLabel', {
      method: 'POST',
      body: { shipmentIds }
    }));
  }

  getTracking(config: MelhorEnvioConfig, shipmentId: string): Observable<any> {
    return from(this.callFunction<any>('trackMelhorEnvioShipment', {
      method: 'POST',
      body: { shipmentIds: [shipmentId] }
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
