import { Injectable, isDevMode } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, map, of } from 'rxjs';
import { MelhorEnvioConfig, ShippingAnalysis, ShippingQuote } from '../interfaces/shipping';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, Firestore } from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class MelhorEnvioService {
  // URLs reais para produção/celular
  private productionUrl = 'https://www.melhorenvio.com.br';
  private sandboxUrl = 'https://sandbox.melhorenvio.com.br';
  
  // URLs de proxy para evitar CORS no navegador (localhost)
  private proxyProductionUrl = '/melhor-envio-prod';
  private proxySandboxUrl = '/melhor-envio-sandbox';

  private db: Firestore;

  private firebaseConfig = {
    apiKey: "AIzaSyDD50YO6EznucB9D1yx6ujwjdD3v-ZCfyg",
    authDomain: "compraki-mcu.firebaseapp.com",
    projectId: "compraki-mcu",
    storageBucket: "compraki-mcu.firebasestorage.app",
    messagingSenderId: "2028715763",
    appId: "1:2028715763:web:5507a8b12473bfc6e50186",
    measurementId: "G-92Q7R0CQR0"
  };

  constructor(private http: HttpClient) {
    const app = getApps().length === 0 ? initializeApp(this.firebaseConfig) : getApp();
    this.db = getFirestore(app);
  }

  private getBaseUrl(isSandbox: boolean): string {
    // Se estiver no navegador (localhost), usa o proxy. Se for app nativo, usa a URL real.
    const isLocal = window.location.hostname === 'localhost';
    if (isLocal) {
      return isSandbox ? this.proxySandboxUrl : this.proxyProductionUrl;
    }
    return isSandbox ? this.sandboxUrl : this.productionUrl;
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
    const url = `${this.getBaseUrl(config.isSandbox)}/api/v2/me`;
    return this.http.get<any>(url, { headers: this.getHeaders(config.accessToken) });
  }

  private getHeaders(token: string) {
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    });
  }

  getQuotes(config: MelhorEnvioConfig, zipTo: string, products: any[]): Observable<ShippingQuote[]> {
    const url = `${this.getBaseUrl(config.isSandbox)}/api/v2/me/shipment/calculate`;
    const payload = {
      from: { postal_code: config.address.zipCode },
      to: { postal_code: zipTo },
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

    return this.http.post<any[]>(url, payload, { headers: this.getHeaders(config.accessToken) }).pipe(
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
    const url = `${this.getBaseUrl(config.isSandbox)}/api/v2/me/cart`;
    const payload = {
      service: order.shippingInfo?.serviceId,
      agency: 1, // Algumas transportadoras exigem agência, padronizamos 1 ou pegamos da config
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
        non_commercial: true // Usando declaração de conteúdo em vez de NF
      }
    };

    return this.http.post<any>(url, payload, { headers: this.getHeaders(config.accessToken) });
  }

  checkout(config: MelhorEnvioConfig, shipmentIds: string[]): Observable<any> {
    const url = `${this.getBaseUrl(config.isSandbox)}/api/v2/me/shipment/checkout`;
    return this.http.post<any>(url, { orders: shipmentIds }, { headers: this.getHeaders(config.accessToken) });
  }

  generateLabel(config: MelhorEnvioConfig, shipmentIds: string[]): Observable<any> {
    const url = `${this.getBaseUrl(config.isSandbox)}/api/v2/me/shipment/generate`;
    return this.http.post<any>(url, { orders: shipmentIds }, { headers: this.getHeaders(config.accessToken) });
  }

  getLabelUrl(config: MelhorEnvioConfig, shipmentIds: string[]): Observable<any> {
    const url = `${this.getBaseUrl(config.isSandbox)}/api/v2/me/shipment/print`;
    return this.http.post<any>(url, { orders: shipmentIds }, { headers: this.getHeaders(config.accessToken) });
  }

  getTracking(config: MelhorEnvioConfig, shipmentId: string): Observable<any> {
    const url = `${this.getBaseUrl(config.isSandbox)}/api/v2/me/shipment/tracking`;
    return this.http.post<any>(url, { orders: [shipmentId] }, { headers: this.getHeaders(config.accessToken) });
  }

  getAnalysis(config: MelhorEnvioConfig): Observable<ShippingAnalysis> {
    const url = `${this.getBaseUrl(config.isSandbox)}/api/v2/me/shipment/list`;
    
    return this.http.get<any>(url, { headers: this.getHeaders(config.accessToken) }).pipe(
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
