import { Injectable, inject } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  Firestore, Timestamp, collection, deleteDoc, doc, documentId, getDocs, getFirestore, onSnapshot,
  query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { describeRates, formatRate, rateAt, roundCents } from '../core/commission';
import { isPaid, paidUnitPrice, productIdOf, sellerItems, toDate } from '../core/order-stage';
import { AppUser } from '../interfaces/app-user';
import { Order } from '../interfaces/order';
import { SellerInvoice, SellerInvoiceSummary, invoiceId } from '../interfaces/seller-invoice';
import { AppConfigService } from './app-config.service';

/** Um produto vendido pela loja no mês. */
export interface SellerProductSale {
  productId: string;
  name: string;
  image: string | null;
  quantity: number;
  revenue: number;
}

/** Uma loja no mês escolhido. */
export interface SellerMonthRow {
  sellerId: string;
  name: string;
  shopName: string | null;
  email: string | null;
  photoURL: string | null;
  /** Anúncios da loja hoje (qualquer situação). */
  listings: number;
  orderCount: number;
  itemCount: number;
  grossRevenue: number;
  platformFee: number;
  netAmount: number;
  /** Taxa(s) aplicada(s) no mês: "8%" ou "5% e 8%" se mudou no meio. */
  rateLabel: string;
  products: SellerProductSale[];
}

export interface SellersMonthReport {
  period: string;
  /** Taxa(s) do mês inteiro, para o título do indicador. */
  rateLabel: string;
  rows: SellerMonthRow[];
  totals: {
    grossRevenue: number;
    platformFee: number;
    netAmount: number;
    orderCount: number;
    sellersWithSales: number;
  };
}

/** Pedido pago no fim do mês anterior pode ter sido criado até alguns dias antes. */
const CREATED_LOOKBACK_DAYS = 10;
/** PDF, XML da NF-e ou foto. Mesmo limite do storage.rules. */
export const INVOICE_ACCEPT = 'application/pdf,text/xml,application/xml,image/jpeg,image/png,image/webp';
export const INVOICE_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Aba Vendedores do admin e "Notas fiscais" do vendedor.
 *
 * Receita de uma loja = soma dos itens dela nos pedidos pagos (sem frete),
 * com o mês contado pela data do pagamento (`paymentConfirmedAt`, ou a
 * criação do pedido quando ela não existe). Taxa Vineon = 10% disso.
 */
@Injectable({ providedIn: 'root' })
export class SellerInvoicesService {
  private readonly db: Firestore;
  private readonly appConfig = inject(AppConfigService);

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
  }

  // ------------------------------------------------------------------ admin

  async loadMonthReport(period: string): Promise<SellersMonthReport> {
    await this.appConfig.whenLoaded();
    const commission = this.appConfig.config().commission;
    const { start, end } = monthRange(period);
    const createdFrom = new Date(start);
    createdFrom.setDate(createdFrom.getDate() - CREATED_LOOKBACK_DAYS);

    // Todo usuário nasce com `isSeller: true` (vendedor em potencial), então
    // "vendedor" aqui é quem tem anúncio ou vendeu no mês.
    const [productSnap, orderSnap] = await Promise.all([
      getDocs(collection(this.db, 'products')),
      getDocs(query(
        collection(this.db, 'orders'),
        where('createdAt', '>=', Timestamp.fromDate(createdFrom)),
        where('createdAt', '<', Timestamp.fromDate(end)),
      )),
    ]);

    const rows = new Map<string, SellerMonthRow>();
    const productMaps = new Map<string, Map<string, SellerProductSale>>();
    const orderIds = new Map<string, Set<string>>();
    const ratesBySeller = new Map<string, Set<number>>();
    const monthRates = new Set<number>();

    const ensureRow = (sellerId: string): SellerMonthRow => {
      let row = rows.get(sellerId);
      if (!row) {
        row = {
          sellerId,
          name: 'Vendedor sem nome',
          shopName: null,
          email: null,
          photoURL: null,
          listings: 0,
          orderCount: 0, itemCount: 0, grossRevenue: 0, platformFee: 0, netAmount: 0,
          rateLabel: '',
          products: [],
        };
        rows.set(sellerId, row);
      }
      return row;
    };

    for (const snap of productSnap.docs) {
      const sellerId = snap.get('sellerId');
      if (typeof sellerId === 'string' && sellerId) ensureRow(sellerId).listings += 1;
    }

    for (const snap of orderSnap.docs) {
      const order = { ...snap.data(), id: snap.id } as Order;
      if (!isPaid(order)) continue;
      const paidAt = toDate(order.paymentConfirmedAt) ?? toDate(order.createdAt);
      if (!paidAt || paidAt < start || paidAt >= end) continue;
      // Taxa em vigor no dia do pagamento (Ajustes guarda o histórico).
      const rate = rateAt(commission, paidAt);

      for (const sellerId of order.sellerIds || []) {
        const items = sellerItems(order, sellerId);
        if (!items.length) continue;
        const row = ensureRow(sellerId);
        const products = productMaps.get(sellerId) ?? new Map<string, SellerProductSale>();
        productMaps.set(sellerId, products);
        const orders = orderIds.get(sellerId) ?? new Set<string>();
        orderIds.set(sellerId, orders);
        orders.add(order.id!);
        const sellerRates = ratesBySeller.get(sellerId) ?? new Set<number>();
        sellerRates.add(rate);
        ratesBySeller.set(sellerId, sellerRates);
        monthRates.add(rate);

        for (const item of items) {
          const quantity = item.quantity || 0;
          const revenue = paidUnitPrice(item) * quantity;
          const key = productIdOf(item) || item.productData?.name || 'produto';
          const current = products.get(key) ?? {
            productId: key,
            name: item.productData?.name || 'Produto',
            image: firstPhoto(item.productData?.photoURL),
            quantity: 0,
            revenue: 0,
          };
          current.quantity += quantity;
          current.revenue += revenue;
          products.set(key, current);
          row.itemCount += quantity;
          row.grossRevenue += revenue;
          row.platformFee += revenue * rate;
        }
      }
    }

    // Nome, e-mail e foto: `users/` em lotes de 30 (limite do `in`).
    const ids = [...rows.keys()];
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const snap = await getDocs(query(collection(this.db, 'users'), where(documentId(), 'in', chunk))).catch(() => null);
      snap?.docs.forEach(d => {
        const user = d.data() as AppUser;
        const row = rows.get(d.id)!;
        row.name = user.shopName || user.displayName || user.email || row.name;
        row.shopName = user.shopName || null;
        row.email = user.email || null;
        row.photoURL = user.photoURL || null;
      });
    }

    const currentRate = formatRate(rateAt(commission, new Date(Math.min(Date.now(), end.getTime() - 1))));
    const list = [...rows.values()].map(row => {
      const gross = roundCents(row.grossRevenue);
      const fee = roundCents(row.platformFee);
      return {
        ...row,
        grossRevenue: gross,
        platformFee: fee,
        netAmount: roundCents(gross - fee),
        rateLabel: describeRates(ratesBySeller.get(row.sellerId) ?? []) || currentRate,
        orderCount: orderIds.get(row.sellerId)?.size ?? 0,
        products: [...(productMaps.get(row.sellerId)?.values() ?? [])]
          .map(p => ({ ...p, revenue: roundCents(p.revenue) }))
          .sort((a, b) => b.revenue - a.revenue),
      };
    }).sort((a, b) => b.grossRevenue - a.grossRevenue || a.name.localeCompare(b.name, 'pt-BR'));

    const withSales = list.filter(r => r.grossRevenue > 0);
    const gross = roundCents(withSales.reduce((sum, r) => sum + r.grossRevenue, 0));
    const fee = roundCents(withSales.reduce((sum, r) => sum + r.platformFee, 0));

    return {
      period,
      rateLabel: describeRates(monthRates) || currentRate,
      rows: list,
      totals: {
        grossRevenue: gross,
        platformFee: fee,
        netAmount: roundCents(gross - fee),
        orderCount: withSales.reduce((sum, r) => sum + r.orderCount, 0),
        sellersWithSales: withSales.length,
      },
    };
  }

  /** Notas do mês, ao vivo — o status do e-mail muda enquanto a tela está aberta. */
  watchPeriodInvoices(period: string): Observable<SellerInvoice[]> {
    return new Observable<SellerInvoice[]>(subscriber => onSnapshot(
      query(collection(this.db, 'sellerInvoices'), where('period', '==', period)),
      snap => subscriber.next(snap.docs.map(d => ({ ...d.data(), id: d.id } as SellerInvoice))),
      error => subscriber.error(error),
    ));
  }

  /**
   * Anexa (ou troca) a nota do mês e pede o envio por e-mail. O arquivo
   * anterior é apagado só depois que o novo está gravado.
   */
  async attachInvoice(row: SellerMonthRow, period: string, file: File, previous?: SellerInvoice | null): Promise<void> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) throw new Error('Sessão expirada. Entre de novo.');
    if (file.size > INVOICE_MAX_BYTES) throw new Error('Arquivo acima de 15 MB.');

    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `sellerInvoices/${row.sellerId}/${period}/${Date.now()}_${safeName}`;
    const storageRef = ref(getStorage(), path);
    const contentType = file.type || guessContentType(file.name);
    await uploadBytes(storageRef, file, { contentType });
    const url = await getDownloadURL(storageRef);

    const summary: SellerInvoiceSummary = {
      grossRevenue: row.grossRevenue,
      platformFee: row.platformFee,
      netAmount: row.netAmount,
      orderCount: row.orderCount,
      itemCount: row.itemCount,
      // Taxa efetiva do mês (se mudou no meio, a média ponderada) + o rótulo.
      commissionRate: row.grossRevenue > 0 ? Math.round((row.platformFee / row.grossRevenue) * 10000) / 10000 : 0,
      commissionLabel: row.rateLabel,
    };

    const invoice: Omit<SellerInvoice, 'id'> = {
      sellerId: row.sellerId,
      period,
      file: { name: file.name, path, url, contentType, size: file.size },
      summary,
      uploadedAt: serverTimestamp(),
      uploadedBy: uid,
      emailRequestedAt: serverTimestamp(),
      email: { status: 'sending', to: null, at: null, error: null },
    };
    await setDoc(doc(this.db, 'sellerInvoices', invoiceId(row.sellerId, period)), invoice);

    if (previous?.file?.path && previous.file.path !== path) {
      await deleteObject(ref(getStorage(), previous.file.path)).catch(() => undefined);
    }
  }

  async resendEmail(invoice: SellerInvoice): Promise<void> {
    await updateDoc(doc(this.db, 'sellerInvoices', invoice.id!), {
      emailRequestedAt: serverTimestamp(),
      email: { status: 'sending', to: null, at: null, error: null },
    });
  }

  async removeInvoice(invoice: SellerInvoice): Promise<void> {
    await deleteDoc(doc(this.db, 'sellerInvoices', invoice.id!));
    await deleteObject(ref(getStorage(), invoice.file.path)).catch(() => undefined);
  }

  // ------------------------------------------------------------- vendedor

  watchMyInvoices(sellerId: string): Observable<SellerInvoice[]> {
    return new Observable<SellerInvoice[]>(subscriber => onSnapshot(
      query(collection(this.db, 'sellerInvoices'), where('sellerId', '==', sellerId)),
      snap => subscriber.next(
        snap.docs
          .map(d => ({ ...d.data(), id: d.id } as SellerInvoice))
          .sort((a, b) => b.period.localeCompare(a.period)),
      ),
      error => subscriber.error(error),
    ));
  }

  async markSeen(invoice: SellerInvoice): Promise<void> {
    if (invoice.seenAt || !invoice.id) return;
    await updateDoc(doc(this.db, 'sellerInvoices', invoice.id), { seenAt: serverTimestamp() }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ meses

export function currentPeriod(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  return currentPeriod(new Date(year, month - 1 + delta, 1));
}

export function monthRange(period: string): { start: Date; end: Date } {
  const [year, month] = period.split('-').map(Number);
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
}

/** "setembro de 2026". */
export function periodLabel(period: string): string {
  const { start } = monthRange(period);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(start);
}

/** "Setembro de 2026" — só a primeira letra (o `capitalize` do CSS pegaria o "de"). */
export function periodTitle(period: string): string {
  const label = periodLabel(period);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function firstPhoto(photo: unknown): string | null {
  if (Array.isArray(photo)) return (photo[0] as string) || null;
  return typeof photo === 'string' && photo ? photo : null;
}

function guessContentType(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'xml') return 'application/xml';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}
