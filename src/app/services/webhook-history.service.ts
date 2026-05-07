import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  onSnapshot,
  addDoc,
  query,
  orderBy,
  Firestore,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { Observable } from 'rxjs';

export interface WebhookEvent {
  id?: string;
  eventType: string;
  eventLabel: string;
  status: string;
  payload: any;
  response: string;
  success: boolean;
  createdAt: any;
}

const firebaseConfig = {
  apiKey: "AIzaSyBD5AH1b1_p6AghhPx3Nr0fBVab8djRbkI",
  authDomain: "compraki-mcu.firebaseapp.com",
  databaseURL: "https://compraki-mcu-default-rtdb.firebaseio.com",
  projectId: "compraki-mcu",
  storageBucket: "compraki-mcu.firebasestorage.app",
  messagingSenderId: "2028715763",
  appId: "1:2028715763:web:5507a8b12473bfc6e50186",
  measurementId: "G-92Q7R0CQR0"
};

@Injectable({
  providedIn: 'root'
})
export class WebhookHistoryService {
  private db: Firestore;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
  }

  private getCollection() {
    return collection(this.db, 'webhook_history');
  }

  async saveEvent(event: Omit<WebhookEvent, 'id' | 'createdAt'>): Promise<void> {
    await addDoc(this.getCollection(), {
      ...event,
      createdAt: serverTimestamp()
    });
  }

  getHistory(): Observable<WebhookEvent[]> {
    return new Observable<WebhookEvent[]>(subscriber => {
      const q = query(this.getCollection(), orderBy('createdAt', 'desc'));
      const unsub = onSnapshot(q, (snapshot) => {
        const events = snapshot.docs.map(d => {
          const data = d.data();
          return {
            ...data,
            id: d.id,
            createdAt: data['createdAt'] instanceof Timestamp
              ? data['createdAt'].toDate()
              : new Date()
          } as WebhookEvent;
        });
        subscriber.next(events);
      }, (err) => subscriber.error(err));

      return () => unsub();
    });
  }
}
