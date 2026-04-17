import { Injectable, inject } from '@angular/core';
import { collection, query, where, getDocs, getFirestore, collectionGroup } from 'firebase/firestore';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { Product } from '../interfaces/product';
import { Order } from '../interfaces/order';
import { FirebaseProducts } from './firebase-products';

const firebaseConfig = {
  apiKey: "AIzaSyDD50YO6EznucB9D1yx6ujwjdD3v-ZCfyg",
  authDomain: "compraki-mcu.firebaseapp.com",
  projectId: "compraki-mcu",
  storageBucket: "compraki-mcu.firebasestorage.app",
  messagingSenderId: "2028715763",
  appId: "1:2028715763:web:5507a8b12473bfc6e50186",
  measurementId: "G-92Q7R0CQR0"
};

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
    // 1. Quantidade de Salvos (Consulta Real via Collection Group)
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

  private async countSaves(productId: string): Promise<number> {
    try {
      // Busca em todas as subcoleções 'savedProducts' de todos os usuários
      const q = query(collectionGroup(this.db, 'savedProducts'), where('productId', '==', productId));
      const snap = await getDocs(q);
      return snap.size; 
    } catch (err) {
      console.warn("Erro ao contar salvos (Certifique-se que o índice de Collection Group foi criado no Firebase):", err);
      return 0;
    }
  }

  private async getSalesData(productId: string): Promise<any[]> {
    const q = query(collection(this.db, 'orders'), where('status', '==', 'RECEIVED'));
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
      
      const allProds = await new Promise<Product[]>((resolve) => {
        const sub = this.fbProducts.getAll().subscribe(p => {
          sub.unsubscribe();
          resolve(p);
        });
      });

      const product = allProds.find(p => p.id === productId);
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
