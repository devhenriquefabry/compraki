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

import { environment } from '../../environments/environment';
const firebaseConfig = environment.firebase;

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
        const todayKey = this.getLocalDateKey(now);
        const active = banners.filter(b => {
          if (b.status === 'active') return true;
          if (b.status === 'scheduled') {
            const start = b.scheduledStart ? new Date(b.scheduledStart) : null;
            const end = b.scheduledEnd ? new Date(b.scheduledEnd) : null;
            if (start && now < start) return false;
            if (end && now > end) return false;

            if (b.scheduledDates && b.scheduledDates.length > 0) {
              if (!b.scheduledDates.includes(todayKey)) return false;
              return this.isWithinDailySchedule(b, todayKey, now);
            }

            // Check specific days if defined
            if (b.scheduledDays && b.scheduledDays.length > 0) {
              const today = now.getDay(); // 0-6
              if (!b.scheduledDays.includes(today)) return false;
            }

            return this.isWithinDailySchedule(b, todayKey, now);
          }
          return false;
        }).sort((a, b) => this.getDailyOrder(a, todayKey) - this.getDailyOrder(b, todayKey));
        observer.next(active);
      });
    });
  }

  private isWithinDailySchedule(banner: Banner, dateKey: string, now: Date): boolean {
    const schedule = banner.dailySchedules?.[dateKey];
    if (!schedule) return true;

    const currentTime = this.getLocalTimeKey(now);
    if (schedule.startTime && currentTime < schedule.startTime) return false;
    if (schedule.endTime && currentTime > schedule.endTime) return false;
    return true;
  }

  private getDailyOrder(banner: Banner, dateKey: string): number {
    return Number(banner.dailySchedules?.[dateKey]?.order || banner.order || 999);
  }

  private getLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getLocalTimeKey(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
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
