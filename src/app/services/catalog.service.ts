import { Injectable } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  DocumentData, Firestore, addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore,
  limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore';
import { FirebaseStorage, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { getCurrentUser } from '../core/auth-state';
import {
  catalogKeywords, cleanCatalogSpecs, isValidGtin, matchScore, matchesTokens, onlyDigits, pivotToken, queryTokens,
} from '../core/catalog';
import { cleanVariantPhotos, mainOptionImages } from '../core/product-variants';
import { isProductHidden } from '../core/product-moderation';
import { CatalogCompetition, CatalogProduct } from '../interfaces/catalog';
import { Product } from '../interfaces/product';

const COLLECTION = 'catalogProducts';
/** Quantos documentos a busca traz do Firestore antes do filtro fino. */
const SEARCH_FETCH = 60;
const SEARCH_CACHE_MS = 60_000;

/**
 * Catálogo Vineon (`catalogProducts`).
 *
 * Leitura aberta (o vendedor busca, o anúncio mostra o selo); escrita só de
 * admin, garantida pelas regras do Firestore e do Storage.
 *
 * A busca usa `keywords` (palavras + prefixos, ver `core/catalog.ts`): uma
 * consulta `array-contains` com a palavra mais seletiva e o resto do filtro
 * aqui no cliente. Não precisa de índice composto.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly db: Firestore;
  private readonly storage: FirebaseStorage;
  private readonly searchCache = new Map<string, { at: number; items: CatalogProduct[] }>();

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
    this.storage = getStorage(app);
  }

  // ------------------------------------------------------------ leitura

  /** Catálogo inteiro em tempo real (aba do admin), mais recente primeiro. */
  watchAll(): Observable<CatalogProduct[]> {
    return new Observable<CatalogProduct[]>(subscriber => {
      const stop = onSnapshot(
        collection(this.db, COLLECTION),
        snap => {
          const items = snap.docs.map(d => fromDoc(d.id, d.data()));
          items.sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt));
          subscriber.next(items);
        },
        err => subscriber.error(err),
      );
      return () => stop();
    });
  }

  async getById(id: string): Promise<CatalogProduct | null> {
    const snap = await getDoc(doc(this.db, COLLECTION, id));
    return snap.exists() ? fromDoc(snap.id, snap.data()) : null;
  }

  /**
   * Busca por nome, marca, modelo, sinônimo ou código digitado como texto.
   * Só produtos ativos, ordenados pela relevância.
   */
  async search(term: string): Promise<CatalogProduct[]> {
    const tokens = queryTokens(term);
    const pivot = pivotToken(tokens);
    if (!pivot) return [];

    const cached = this.searchCache.get(pivot);
    let pool: CatalogProduct[];
    if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) {
      pool = cached.items;
    } else {
      const snap = await getDocs(query(
        collection(this.db, COLLECTION),
        where('keywords', 'array-contains', pivot),
        limit(SEARCH_FETCH),
      ));
      pool = snap.docs.map(d => fromDoc(d.id, d.data()));
      this.searchCache.set(pivot, { at: Date.now(), items: pool });
    }

    return pool
      .filter(item => item.status === 'active' && matchesTokens(item, tokens))
      .sort((a, b) => matchScore(b, tokens) - matchScore(a, tokens));
  }

  /** Busca exata pelo código de barras (EAN/GTIN). */
  async findByGtin(code: string): Promise<CatalogProduct[]> {
    const digits = onlyDigits(code);
    if (digits.length < 8) return [];
    const snap = await getDocs(query(
      collection(this.db, COLLECTION),
      where('gtins', 'array-contains', digits),
      limit(10),
    ));
    return snap.docs.map(d => fromDoc(d.id, d.data())).filter(item => item.status === 'active');
  }

  /** Fichas (ativas ou rascunho) que já usam um código de barras — evita duplicar produto. */
  async gtinOwners(code: string): Promise<CatalogProduct[]> {
    const digits = onlyDigits(code);
    if (!digits) return [];
    const snap = await getDocs(query(collection(this.db, COLLECTION), where('gtins', 'array-contains', digits), limit(5)));
    return snap.docs.map(d => fromDoc(d.id, d.data()));
  }

  /** Produtos ativos de uma categoria, para navegar sem digitar. */
  async listByCategory(categoryId: string): Promise<CatalogProduct[]> {
    const snap = await getDocs(query(
      collection(this.db, COLLECTION),
      where('categoryId', '==', categoryId),
      limit(80),
    ));
    return snap.docs
      .map(d => fromDoc(d.id, d.data()))
      .filter(item => item.status === 'active')
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  }

  /** Últimos produtos atualizados, para a vitrine inicial do "Anunciar". */
  async listRecent(max = 12): Promise<CatalogProduct[]> {
    const snap = await getDocs(query(collection(this.db, COLLECTION), orderBy('updatedAt', 'desc'), limit(max * 2)));
    return snap.docs.map(d => fromDoc(d.id, d.data())).filter(item => item.status === 'active').slice(0, max);
  }

  /**
   * Quantas lojas já vendem este produto e o menor preço, para o vendedor
   * decidir o dele. Anúncios fora do ar ou sem estoque não contam no preço.
   */
  async competition(catalogId: string, excludeSellerId?: string | null): Promise<CatalogCompetition> {
    const snap = await getDocs(query(collection(this.db, 'products'), where('catalogId', '==', catalogId), limit(60)));
    const listings = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as Product) }))
      .filter(p => !isProductHidden(p) && p.sellerId !== excludeSellerId);
    const prices = listings
      .filter(p => (p.stock ?? 0) > 0)
      .map(p => (p.priceDiscounted && p.priceDiscounted < p.price ? p.priceDiscounted : p.price))
      .filter(price => typeof price === 'number' && price > 0);
    return {
      listings: listings.length,
      sellers: new Set(listings.map(p => p.sellerId)).size,
      lowestPrice: prices.length ? Math.min(...prices) : null,
    };
  }

  /** Anúncios vinculados por produto do catálogo (contagem da aba do admin). */
  async listingCounts(): Promise<Map<string, number>> {
    const snap = await getDocs(query(collection(this.db, 'products'), where('catalogId', '>', ''), limit(2000)));
    const counts = new Map<string, number>();
    snap.forEach(d => {
      const id = (d.data() as Product).catalogId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    });
    return counts;
  }

  // ------------------------------------------------------------ escrita (admin)

  /** Cria (sem `id`) ou atualiza. Devolve o id gravado. */
  async save(product: CatalogProduct): Promise<string> {
    const uid = getCurrentUser()?.uid ?? null;
    const data = toDoc(product);
    const stamp = { ...data, updatedAt: serverTimestamp(), updatedBy: uid };

    this.searchCache.clear();
    if (product.id) {
      await setDoc(doc(this.db, COLLECTION, product.id), stamp, { merge: true });
      return product.id;
    }
    const created = await addDoc(collection(this.db, COLLECTION), { ...stamp, createdAt: serverTimestamp(), createdBy: uid });
    return created.id;
  }

  async setStatus(id: string, status: CatalogProduct['status']): Promise<void> {
    this.searchCache.clear();
    await setDoc(doc(this.db, COLLECTION, id), { status, updatedAt: serverTimestamp() }, { merge: true });
  }

  /**
   * Apaga só o documento. As fotos ficam no Storage de propósito: anúncios já
   * publicados copiaram as URLs e continuariam apontando para elas.
   */
  async remove(id: string): Promise<void> {
    this.searchCache.clear();
    await deleteDoc(doc(this.db, COLLECTION, id));
  }

  async uploadPhoto(file: File): Promise<string> {
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-60);
    const storageRef = ref(this.storage, `catalog/${Date.now()}_${safeName}`);
    await uploadBytes(storageRef, file, { contentType: file.type, cacheControl: 'public,max-age=31536000' });
    return getDownloadURL(storageRef);
  }
}

// ---------------------------------------------------------------- conversão

function millis(value: unknown): number {
  const v = value as { toMillis?: () => number } | Date | null | undefined;
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  return typeof v.toMillis === 'function' ? v.toMillis() : 0;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fromDoc(id: string, data: DocumentData): CatalogProduct {
  return {
    id,
    title: data['title'] || '',
    brand: data['brand'] || '',
    model: data['model'] || '',
    line: data['line'] || '',
    categoryId: data['categoryId'] || '',
    subcategoryId: data['subcategoryId'] || null,
    photos: Array.isArray(data['photos']) ? data['photos'] : [],
    specs: Array.isArray(data['specs']) ? data['specs'] : [],
    gtins: Array.isArray(data['gtins']) ? data['gtins'] : [],
    aliases: Array.isArray(data['aliases']) ? data['aliases'] : [],
    variantAttributes: Array.isArray(data['variantAttributes']) ? data['variantAttributes'] : [],
    variantImages: data['variantImages'] || {},
    variantPhotos: data['variantPhotos'] || {},
    weight: numberOrNull(data['weight']),
    width: numberOrNull(data['width']),
    height: numberOrNull(data['height']),
    length: numberOrNull(data['length']),
    description: data['description'] || '',
    referencePrice: numberOrNull(data['referencePrice']),
    status: data['status'] === 'active' ? 'active' : 'draft',
    createdAt: data['createdAt'],
    updatedAt: data['updatedAt'],
    createdBy: data['createdBy'],
    updatedBy: data['updatedBy'],
  };
}

/** Limpa tudo antes de gravar e recalcula `keywords`. */
function toDoc(product: CatalogProduct): Omit<CatalogProduct, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> {
  const variantAttributes = (product.variantAttributes || [])
    .map(attr => ({
      name: (attr.name || '').trim().slice(0, 30),
      values: Array.from(new Set((attr.values || []).map(v => v.trim()).filter(Boolean))).slice(0, 30),
    }))
    .filter(attr => attr.name && attr.values.length)
    .slice(0, 2);

  const clean: Omit<CatalogProduct, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
    title: product.title.trim().slice(0, 120),
    brand: product.brand.trim().slice(0, 60),
    model: product.model.trim().slice(0, 60),
    line: (product.line || '').trim().slice(0, 60),
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId || null,
    photos: product.photos.slice(0, 10),
    specs: cleanCatalogSpecs(product.specs),
    gtins: Array.from(new Set(product.gtins.map(onlyDigits).filter(isValidGtin))),
    aliases: Array.from(new Set(product.aliases.map(a => a.trim()).filter(Boolean))).slice(0, 12),
    variantAttributes,
    variantImages: mainOptionImages(variantAttributes, product.variantImages, product.variantPhotos),
    variantPhotos: cleanVariantPhotos(variantAttributes, product.variantPhotos),
    weight: numberOrNull(product.weight),
    width: numberOrNull(product.width),
    height: numberOrNull(product.height),
    length: numberOrNull(product.length),
    description: (product.description || '').trim().slice(0, 5000),
    referencePrice: numberOrNull(product.referencePrice),
    status: product.status,
  };
  return { ...clean, keywords: catalogKeywords(clean) };
}
