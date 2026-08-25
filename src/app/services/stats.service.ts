import { Injectable, inject } from '@angular/core';
import { collection, doc, getDoc, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { Product } from '../interfaces/product';
import { Order } from '../interfaces/order';
import { FirebaseProducts } from './firebase-products';

import { environment } from '../../environments/environment';
const firebaseConfig = environment.firebase;

@Injectable({
  providedIn: 'root'
})
export class StatsService {
  private db;
  private fbProducts = inject(FirebaseProducts);

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
  }

  async getProductStats(productId: string) {
    // 1. Quantidade de Salvos (contador desnormalizado no produto)
    const savedCount = await this.countSaves(productId);

    // 2. Vendas Totais deste produto
    const sales = await this.getSalesData(productId);

    // 3. Tempo Médio de Venda
    const avgSellingTime = await this.calculateRealAvgSellingTime(productId, sales);

    return {
      savedCount,
      totalSales: sales.length,
      avgSellingTime
    };
  }

  /**
   * Lê o contador já pronto em `products/{id}.savedCount`.
   *
   * Antes isto varria `collectionGroup('savedProducts')` — os salvos de TODOS
   * os usuários — a cada abertura da tela, cobrado por documento lido. Agora é
   * uma leitura só, e o número é mantido na escrita pelos gatilhos
   * `onProductSaved` / `onProductUnsaved` (functions/src/counters.ts).
   */
  private async countSaves(productId: string): Promise<number> {
    try {
      const snap = await getDoc(doc(this.db, 'products', productId));
      return snap.exists() ? Number(snap.data()?.['savedCount'] ?? 0) : 0;
    } catch (err) {
      console.warn('Erro ao ler savedCount do produto:', err);
      return 0;
    }
  }

  private async getSalesData(productId: string): Promise<any[]> {
    // Escopo obrigatorio: as regras do Firestore so liberam pedidos em que o
    // usuario e comprador ou vendedor. Sem o `array-contains` a consulta
    // inteira e negada — e, mesmo liberada, varreria a colecao toda.
    const uid = this.fbProducts.getUser()?.uid;
    if (!uid) return [];

    const q = query(
      collection(this.db, 'orders'),
      where('sellerIds', 'array-contains', uid),
      where('status', '==', 'RECEIVED')
    );
    const snap = await getDocs(q);
    const sales: any[] = [];
    
    snap.forEach(doc => {
      const order = doc.data() as Order;
      const item = order.items.find(i => i.productData.id === productId);
      if (item) {
        sales.push({
          orderDate: order.createdAt?.toDate() || new Date(),
          quantity: item.quantity
        });
      }
    });

    return sales;
  }

  private async calculateRealAvgSellingTime(productId: string, sales: any[]): Promise<string> {
    if (sales.length === 0) return 'N/A';

    try {
      // Tenta pegar a data de criação do produto para ver quanto tempo levou a primeira venda
      // No Compraki, assumimos que o tempo de venda é a diferença entre criação e o recebimento das ordens
      // Para fins estatísticos simples, usaremos a média de dias desde a criação até cada venda.
      
      // Uma leitura do documento do produto. Antes isto baixava a colecao
      // `products` inteira via getAll() so para achar um item pelo id.
      const productSnap = await getDoc(doc(this.db, 'products', productId));
      const product = productSnap.exists() ? (productSnap.data() as Product) : null;
      if (!product || !product.createdAt) return '3 dias'; // Fallback simulado

      const prodCreation = product.createdAt.toDate ? product.createdAt.toDate() : new Date(product.createdAt);
      
      let totalDays = 0;
      sales.forEach(sale => {
        const diffTime = Math.abs(sale.orderDate - prodCreation);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        totalDays += diffDays;
      });

      const avg = Math.round(totalDays / sales.length);
      return avg + (avg === 1 ? ' dia' : ' dias');

    } catch (err) {
      return 'Em análise';
    }
  }

  private calculateAvgSellingTime(sales: any[]): string {
    return 'Obsoleto';
  }
}
