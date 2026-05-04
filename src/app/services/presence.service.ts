import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getDatabase, ref, onValue, onDisconnect, set, Database } from 'firebase/database';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp, deleteField, Firestore } from 'firebase/firestore';
import { getAuth, Auth, onAuthStateChanged } from 'firebase/auth';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class PresenceService {
  private db: Firestore;
  private rtdb: Database;
  private auth: Auth;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
    this.rtdb = getDatabase(app);
    this.auth = getAuth(app);

    this.initPresence();
  }

  private initPresence() {
    onAuthStateChanged(this.auth, (user) => {
      if (user) {
        this.updatePresence(user.uid);
      }
    });
  }

  private async updatePresence(uid: string) {
    const userStatusDatabaseRef = ref(this.rtdb, `/status/${uid}`);
    const userFirestoreRef = doc(this.db, 'users', uid);

    const isOfflineForDatabase = {
        state: 'offline',
        last_changed: serverTimestamp(),
    };

    const isOnlineForDatabase = {
        state: 'online',
        last_changed: serverTimestamp(),
    };

    // Referência especial para verificar conexão
    const connectedRef = ref(this.rtdb, '.info/connected');

    onValue(connectedRef, (snapshot) => {
        if (snapshot.val() === false) {
            // Se perdemos conexão local, não fazemos nada, o onDisconnect do servidor cuidará
            return;
        }

        // Configura o comportamento ao desconectar (server-side)
        onDisconnect(userStatusDatabaseRef).set(isOfflineForDatabase).then(() => {
            // Define o estado inicial como online
            set(userStatusDatabaseRef, isOnlineForDatabase);

            // Atualiza o Firestore para 'online'
            this.setFirestorePresence(uid, 'online');
        });
    });

    // Monitora mudanças no estado no RTDB para sincronizar com o Firestore
    // Isso é útil para que outros clientes vejam o status via Firestore
    onValue(userStatusDatabaseRef, (snapshot) => {
      const status = snapshot.val();
      if (status) {
        this.setFirestorePresence(uid, status.state);
      }
    });
  }

  private async setFirestorePresence(uid: string, state: 'online' | 'offline') {
    try {
      const userRef = doc(this.db, 'users', uid);
      if (state === 'online') {
        const snap = await getDoc(userRef);
        const prev = snap.exists() ? snap.data() : {};
        const updates: Record<string, unknown> = {
          status: 'online',
          lastActive: serverTimestamp()
        };
        if (prev['status'] !== 'online') {
          updates['onlineSince'] = serverTimestamp();
        }
        await setDoc(userRef, updates, { merge: true });
      } else {
        await setDoc(
          userRef,
          {
            status: 'offline',
            lastActive: serverTimestamp(),
            onlineSince: deleteField()
          },
          { merge: true }
        );
      }
    } catch (e) {
      console.error('Erro ao sincronizar presença no Firestore:', e);
    }
  }
}
