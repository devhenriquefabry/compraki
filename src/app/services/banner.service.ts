import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  Firestore,
  query,
  orderBy,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Observable } from 'rxjs';
import { Banner } from '../interfaces/banner';

const firebaseConfig = {
  apiKey: "AIzaSyDD50YO6EznucB9D1yx6ujwjdD3v-ZCfyg",
  authDomain: "compraki-mcu.firebaseapp.com",
  projectId: "compraki-mcu",
  storageBucket: "compraki-mcu.firebasestorage.app",
  messagingSenderId: "2028715763",
  appId: "1:2028715763:web:5507a8b12473bfc6e50186",
};

@Injectable({
  providedIn: 'root'
})
export class BannerService {
  private db: Firestore;
  private storage;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.storage = getStorage(app);
  }

  /**
   * Retorna todos os banners em tempo real, ordenados por 'order'
   */
  getAll(): Observable<Banner[]> {
    return new Observable<Banner[]>(observer => {
      const bannersCol = collection(this.db, 'banners');
      const q = query(bannersCol, orderBy('order', 'asc'));

      return onSnapshot(q, (snapshot) => {
        const banners = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data()
        } as Banner));
        observer.next(banners);
      }, err => observer.error(err));
    });
  }

  /**
   * Retorna apenas banners visíveis no momento atual (ativo ou agendado dentro do prazo)
   */
  getActiveBanners(): Observable<Banner[]> {
    return new Observable<Banner[]>(observer => {
      this.getAll().subscribe(banners => {
        const now = new Date();
        const active = banners.filter(b => {
          if (b.status === 'active') return true;
          if (b.status === 'scheduled') {
            const start = b.scheduledStart ? new Date(b.scheduledStart) : null;
            const end = b.scheduledEnd ? new Date(b.scheduledEnd) : null;
            if (start && now < start) return false;
            if (end && now > end) return false;
            return start !== null;
          }
          return false;
        });
        observer.next(active);
      });
    });
  }

  /**
   * Cria um novo banner
   */
  async create(banner: Omit<Banner, 'id'>): Promise<string> {
    const bannersCol = collection(this.db, 'banners');
    const docRef = await addDoc(bannersCol, {
      ...banner,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  }

  /**
   * Atualiza um banner existente
   */
  async update(id: string, data: Partial<Banner>): Promise<void> {
    const bannerRef = doc(this.db, 'banners', id);
    await updateDoc(bannerRef, { ...data, updatedAt: serverTimestamp() });
  }

  /**
   * Remove um banner
   */
  async delete(id: string): Promise<void> {
    await deleteDoc(doc(this.db, 'banners', id));
  }

  /**
   * Faz upload de imagem de banner para o Storage
   */
  async uploadBannerImage(file: File): Promise<string> {
    const filePath = `banners/${Date.now()}_${file.name}`;
    const storageRef = ref(this.storage, filePath);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }
}
