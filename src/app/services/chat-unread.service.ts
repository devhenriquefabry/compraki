import { Injectable, signal } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { collection, getFirestore, onSnapshot, query, where } from 'firebase/firestore';

import { environment } from '../../environments/environment';
import { onAuthUserChanged } from '../core/auth-state';

/**
 * Quantas mensagens a conta ainda não leu, somando todas as conversas — o
 * número ao lado de "Mensagens" no topo do site e no menu do celular.
 *
 * Fica no bundle inicial: só Firestore, nada do serviço de chat (que puxa
 * Storage e WhatsApp). A consulta é a mesma da lista de Mensagens, e o SDK
 * divide um único listener entre as duas.
 */
@Injectable({ providedIn: 'root' })
export class ChatUnreadService {
  readonly total = signal(0);

  constructor() {
    const db = getFirestore(getApps().length ? getApp() : initializeApp(environment.firebase));
    let stop: (() => void) | undefined;
    onAuthUserChanged(user => {
      stop?.();
      stop = undefined;
      this.total.set(0);
      if (!user) return;
      const q = query(collection(db, 'chats'), where('participantIds', 'array-contains', user.uid));
      stop = onSnapshot(q, snap => {
        let sum = 0;
        snap.forEach(d => { sum += Math.max(0, Number(d.get(`unread.${user.uid}`)) || 0); });
        this.total.set(sum);
      }, err => console.warn('[mensagens] contador parou', err));
    });
  }
}
