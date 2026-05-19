import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  Firestore,
  DocumentData
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { Category, Subcategory } from '../interfaces/category';

import { environment } from '../../environments/environment';

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
}
