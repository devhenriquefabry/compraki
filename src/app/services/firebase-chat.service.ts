import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore, collection, doc, query, where,
  getDocs, addDoc, onSnapshot, serverTimestamp, writeBatch, orderBy, Firestore
} from 'firebase/firestore';
import { getAuth, Auth, User } from 'firebase/auth';
import { Observable } from 'rxjs';
import { ChatRoom, ChatMessage, ChatParticipant } from '../interfaces/chat';

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
export class FirebaseChatService {
  private db: Firestore;
  private authenticator: Auth;

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.authenticator = getAuth(app);
  }

  getCurrentUser(): User | null {
    return this.authenticator.currentUser;
  }

  /**
   * Inicia um chat ou retorna um existente com o mesmo vendedor e mesmo produto (se especificado).
   */
  async startChat(otherParticipant: ChatParticipant, productContext?: { id: string, name: string, photo?: string }): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error("Usuário não autenticado");

    const chatsCol = collection(this.db, 'chats');
    
    // Procura chats onde eu estou participando
    const q = query(chatsCol, where('participantIds', 'array-contains', user.uid));
    const snapshot = await getDocs(q);
    
    let existingChatId: string | null = null;
    snapshot.docs.forEach(d => {
       const data = d.data() as ChatRoom;
       // Verifica se é o chat exato (mesmo vendedor e mesmo produto se aplicável)
       const isSameParticipant = data.participantIds.includes(otherParticipant.uid);
       const isSameContext = productContext ? data.productId === productContext.id : true;

       if (isSameParticipant && isSameContext) {
         existingChatId = d.id;
       }
    });

    if (existingChatId) {
       return existingChatId;
    }

    // Criar nova sala
    const me: ChatParticipant = {
      uid: user.uid,
      name: user.displayName || 'Você'
    };
    if (user.photoURL) me.photoUrl = user.photoURL;

    const cleanOther: ChatParticipant = {
      uid: otherParticipant.uid,
      name: otherParticipant.name || 'Usuário'
    };
    if (otherParticipant.photoUrl) cleanOther.photoUrl = otherParticipant.photoUrl;

    const newChat: ChatRoom = {
      participantIds: [me.uid, cleanOther.uid],
      participants: [me, cleanOther],
      createdAt: serverTimestamp(),
      lastMessage: 'Chat iniciado. Mande um oi!',
      lastMessageAt: serverTimestamp()
    };

    if (productContext) {
      newChat.productId = productContext.id;
      newChat.productName = productContext.name;
      if (productContext.photo) newChat.productPhoto = productContext.photo;
    }

    const docRef = await addDoc(chatsCol, newChat);
    return docRef.id;
  }

  /**
   * Puxa em tempo real a Inbox (caixa de mensagens) do usuário.
   */
  getMyChats(): Observable<ChatRoom[]> {
    return new Observable(observer => {
       const user = this.getCurrentUser();
       if (!user) {
         observer.next([]);
         return;
       }
       
       const chatsCol = collection(this.db, 'chats');
       // Não usamos orderBy('lastMessageAt') aqui para evitar o erro de 'Index Required' do Firestore em demonstrações.
       // Fazemos a ordenação localmente via JavaScript. Elevando a robustez.
       const q = query(chatsCol, where('participantIds', 'array-contains', user.uid));
       
       return onSnapshot(q, (snapshot) => {
          const chats: ChatRoom[] = [];
          snapshot.forEach(d => {
            chats.push({ id: d.id, ...d.data() } as ChatRoom);
          });

          // Ordenação Tardia Local
          chats.sort((a,b) => {
             const tA = a.lastMessageAt?.seconds || 0;
             const tB = b.lastMessageAt?.seconds || 0;
             return tB - tA;
          });

          observer.next(chats);
       }, (err) => {
           observer.error(err);
       });
    });
  }

  /**
   * Busca os metadados de uma sala específica (ideal para a página de detalhes).
   */
  async getChatDetails(chatId: string): Promise<ChatRoom | undefined> {
     const chatRef = doc(this.db, 'chats', chatId);
     const snap = await getDocs(query(collection(this.db, 'chats'), where('__name__', '==', chatId)));
     if (!snap.empty) {
         return { id: snap.docs[0].id, ...snap.docs[0].data() } as ChatRoom;
     }
     return undefined;
  }

  /**
   * Monitora em tempo real a timeline de mensagens de uma sala específica.
   */
  getMessages(chatId: string): Observable<ChatMessage[]> {
    return new Observable(observer => {
        const messagesCol = collection(this.db, `chats/${chatId}/messages`);
        const q = query(messagesCol, orderBy('createdAt', 'asc'));

        return onSnapshot(q, (snapshot) => {
            const msgs: ChatMessage[] = [];
            snapshot.forEach(d => {
                msgs.push({ id: d.id, ...d.data() } as ChatMessage);
            });
            observer.next(msgs);
        }, (err) => {
            observer.error(err);
        });
    });
  }

  /**
   * Envia uma mensagem em lote (Batch), salvando o texto na subcoleção e atualizando 
   * o ponteiro principal de lastMessage do chat de uma vez só. Operação Atômica e Profissional.
   */
  async sendMessage(chatId: string, text: string): Promise<void> {
     const user = this.getCurrentUser();
     if (!user) throw new Error("Usuário não autenticado");

     const batch = writeBatch(this.db);
     
     // 1. Gravar nova mensagem física na subcoleção isolada
     const messagesCol = collection(this.db, `chats/${chatId}/messages`);
     const newMsgRef = doc(messagesCol);
     batch.set(newMsgRef, {
        senderId: user.uid,
        text: text,
        createdAt: serverTimestamp()
     });

     // 2. Atualizar espelho de metadados na sala raiz (Chats)
     const chatRef = doc(this.db, 'chats', chatId);
     batch.update(chatRef, {
        lastMessage: text,
        lastMessageAt: serverTimestamp()
     });

     await batch.commit();
  }
}
