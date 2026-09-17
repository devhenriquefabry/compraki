import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  setDoc,
  writeBatch,
  Firestore,
  DocumentData
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { Category, Subcategory } from '../interfaces/category';
import { DefaultCategory } from '../core/default-categories';

import { environment } from '../../environments/environment';

/** Resumo do que `seedDefaults()` fez, para a tela mostrar ao admin. */
export interface SeedCategoriesResult {
  created: string[];
  updated: string[];
  unchanged: string[];
}

@Injectable({
  providedIn: 'root'
})
export class FirebaseCategories {
  private db: Firestore;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
  }

  getAll(): Observable<Category[]> {
    return new Observable<Category[]>(subscriber => {
      const q = query(collection(this.db, 'categories'), orderBy('name', 'asc'));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const categories = snapshot.docs.map(d => {
          const data = d.data() as any;
          return {
            ...data,
            id: d.id,
            name: data.name || data.nome || ''
          } as Category;
        });
        subscriber.next(categories);
      }, (error) => subscriber.error(error));

      return () => unsubscribe();
    });
  }

  async add(category: Partial<Category>): Promise<void> {
    await addDoc(collection(this.db, 'categories'), category);
  }

  async update(id: string, category: Partial<Category>): Promise<void> {
    const categoryDoc = doc(this.db, `categories/${id}`);
    await updateDoc(categoryDoc, category as DocumentData);
  }

  async delete(id: string): Promise<void> {
    const categoryDoc = doc(this.db, `categories/${id}`);
    await deleteDoc(categoryDoc);
  }

  /**
   * Importa o conjunto sugerido de categorias (`core/default-categories.ts`),
   * sem nunca duplicar nem apagar o que já existe. Seguro rodar mais de uma
   * vez — a segunda vez só preenche o que ainda estiver faltando.
   *
   * Para cada categoria sugerida:
   *  - Se o `id` já existe (ex.: `cat_eletronicos`, criada antes deste seed),
   *    completa o ícone se estiver vazio e ACRESCENTA as subcategorias
   *    sugeridas que ainda não existem lá (por nome) — nunca remove uma
   *    subcategoria que o admin já tinha criado.
   *  - Senão, se já existe outra categoria com o MESMO NOME (criada à mão,
   *    com outro id), enriquece essa em vez de criar uma parecida do lado.
   *  - Senão, cria uma categoria nova com o id sugerido.
   *
   * Nome só muda quando a sugestão tem `renameFrom` — e mesmo assim só se o
   * nome atual ainda for aquele valor antigo (se o admin já renomeou para
   * outra coisa, o seed respeita e não mexe).
   */
  async seedDefaults(defaults: DefaultCategory[]): Promise<SeedCategoriesResult> {
    const snapshot = await getDocs(collection(this.db, 'categories'));
    const existingById = new Map<string, Category>();
    const existingByName = new Map<string, Category>();
    snapshot.forEach(d => {
      const data = { ...(d.data() as any), id: d.id } as Category;
      existingById.set(d.id, data);
      existingByName.set((data.name || '').trim().toLowerCase(), data);
    });

    const batch = writeBatch(this.db);
    const result: SeedCategoriesResult = { created: [], updated: [], unchanged: [] };

    for (const suggestion of defaults) {
      const current = existingById.get(suggestion.id)
        ?? existingByName.get(suggestion.name.trim().toLowerCase());

      if (!current) {
        batch.set(doc(this.db, 'categories', suggestion.id), {
          name: suggestion.name,
          icon: suggestion.icon,
          subcategories: suggestion.subcategories,
        });
        result.created.push(suggestion.name);
        continue;
      }

      const targetId = current.id;
      const currentSubs = current.subcategories || [];
      const existingSubNames = new Set(currentSubs.map(s => (s.name || '').trim().toLowerCase()));
      const newSubs = suggestion.subcategories.filter(
        s => !existingSubNames.has(s.name.trim().toLowerCase())
      );

      const patch: Partial<Category> = {};
      if (!current.icon) patch.icon = suggestion.icon;
      if (newSubs.length) patch.subcategories = [...currentSubs, ...newSubs];
      if (suggestion.renameFrom && current.name?.trim() === suggestion.renameFrom.trim()) {
        patch.name = suggestion.name;
      }

      if (Object.keys(patch).length) {
        batch.update(doc(this.db, 'categories', targetId), patch as DocumentData);
        result.updated.push(patch.name ? `${current.name} → ${patch.name}` : (current.name || suggestion.name));
      } else {
        result.unchanged.push(current.name || suggestion.name);
      }
    }

    if (result.created.length || result.updated.length) {
      await batch.commit();
    }

    return result;
  }
}
