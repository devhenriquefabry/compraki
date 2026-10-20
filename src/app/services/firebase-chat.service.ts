import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore, collection, doc, query, where, getDoc,
  getDocs, addDoc, onSnapshot, serverTimestamp, writeBatch, orderBy, updateDoc, Firestore,
  deleteDoc, collectionGroup, getCountFromServer, increment
} from 'firebase/firestore';
import { getAuth, Auth, User } from 'firebase/auth';
import { getDownloadURL, ref, getStorage, uploadBytes, FirebaseStorage } from 'firebase/storage';
import { Observable } from 'rxjs';
import { ChatRoom, ChatMessage, ChatParticipant, ChatReport } from '../interfaces/chat';
import { AppUser } from '../interfaces/app-user';
import { WhatsappInstancesService } from './whatsapp-instances.service';

import { environment } from '../../environments/environment';
const firebaseConfig = environment.firebase;

@Injectable({
  providedIn: 'root'
})
export class FirebaseChatService {
  private db: Firestore;
  private authenticator: Auth;
  private storage: FirebaseStorage;

  constructor(private whatsappService: WhatsappInstancesService) {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.authenticator = getAuth(app);
    this.storage = getStorage(app);
  }

  getCurrentUser(): User | null {
    return this.authenticator.currentUser;
  }

  waitForUser(): Promise<User | null> {
    return new Promise((resolve) => {
      const user = this.authenticator.currentUser;
      if (user) return resolve(user);
      
      const unsubscribe = this.authenticator.onAuthStateChanged(u => {
        unsubscribe(); // Só queremos a primeira resposta
        resolve(u);
      });
    });
  }

  async uploadFile(blob: Blob, path: string): Promise<string> {
    const fileRef = ref(this.storage, path);
    await uploadBytes(fileRef, blob);
    return getDownloadURL(fileRef);
  }

  /**
   * Abre a conversa com a outra conta — ou devolve a que já existe para o
   * mesmo anúncio. Sem anúncio (página da loja, pedido), reaproveita a conversa
   * direta com ela ou, na falta, a mais recente.
   *
   * @param otherIsSeller o outro lado é a loja (anúncio, vitrine, pedido). Só
   *   a conversa direta do admin passa `false`.
   */
  async startChat(
    otherParticipant: ChatParticipant,
    productContext?: { id: string, name: string, photo?: string },
    otherIsSeller = true
  ): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error("Usuário não autenticado");
    if (otherParticipant.uid === user.uid) {
      throw new Error('Este anúncio é seu. As perguntas dos clientes chegam em Mensagens.');
    }

    // Validação de Banimento
    const userDocRef = doc(this.db, 'users', user.uid);
    const userSnap = await getDoc(userDocRef);
    const myData = userSnap.exists() ? (userSnap.data() as AppUser) : undefined;
    if (myData?.isChatBanned) {
      throw new Error("Você está temporariamente impedido de iniciar novas conversas.");
    }

    const chatsCol = collection(this.db, 'chats');
    const q = query(chatsCol, where('participantIds', 'array-contains', user.uid));
    const snapshot = await getDocs(q);

    const withOther = snapshot.docs
      .map(d => ({ id: d.id, data: d.data() as ChatRoom }))
      .filter(c => c.data.participantIds?.includes(otherParticipant.uid))
      .sort((a, b) => (b.data.lastMessageAt?.seconds || 0) - (a.data.lastMessageAt?.seconds || 0));
    const existing = productContext
      ? withOther.find(c => c.data.productId === productContext.id)
      : withOther.find(c => !c.data.productId) ?? withOther[0];
    if (existing) return existing.id;

    // O nome de quem abre vem do cadastro: o `displayName` do Auth pode estar
    // vazio, e as conversas antigas gravavam "Você" — que o outro lado via.
    const me: ChatParticipant = {
      uid: user.uid,
      name: myData?.displayName || user.displayName || 'Cliente Vineon'
    };
    const myPhoto = myData?.photoURL || user.photoURL;
    if (myPhoto) me.photoUrl = myPhoto;

    const cleanOther: ChatParticipant = {
      uid: otherParticipant.uid,
      name: otherParticipant.name || 'Usuário'
    };
    if (otherParticipant.photoUrl) cleanOther.photoUrl = otherParticipant.photoUrl;

    const newChat: ChatRoom = {
      participantIds: [me.uid, cleanOther.uid],
      participants: [me, cleanOther],
      createdBy: me.uid,
      createdAt: serverTimestamp(),
      lastMessage: '',
      lastMessageAt: serverTimestamp(),
      source: 'marketplace',
      unread: {}
    };
    if (otherIsSeller) {
      newChat.buyerId = me.uid;
      newChat.sellerId = cleanOther.uid;
    }

    if (productContext) {
      newChat.productId = productContext.id;
      newChat.productName = productContext.name;
      if (productContext.photo) newChat.productPhoto = productContext.photo;
    }

    const docRef = await addDoc(chatsCol, newChat);
    void this.dispatchNewConversationTrigger(docRef.id, me, cleanOther, productContext);
    return docRef.id;
  }

  /** A conversa em tempo real — status, quem leu, não lidas. */
  watchChat(chatId: string): Observable<ChatRoom | undefined> {
    return new Observable(observer => onSnapshot(
      doc(this.db, 'chats', chatId),
      snap => observer.next(snap.exists() ? ({ id: snap.id, ...snap.data() } as ChatRoom) : undefined),
      err => observer.error(err)
    ));
  }

  /** Zera as não lidas da conta e registra quando ela leu. */
  async markRead(chatId: string): Promise<void> {
    const uid = this.getCurrentUser()?.uid;
    if (!uid) return;
    await updateDoc(doc(this.db, 'chats', chatId), {
      [`unread.${uid}`]: 0,
      [`readAt.${uid}`]: serverTimestamp()
    });
  }

  /**
   * Puxa em tempo real a Inbox (caixa de mensagens) do usuário.
   */
  getMyChats(): Observable<ChatRoom[]> {
    return new Observable(observer => {
      // Usamos onAuthStateChanged para garantir que a consulta só comece quando o usuário estiver pronto
      return this.authenticator.onAuthStateChanged((user) => {
        if (!user) {
          observer.next([]);
          return;
        }

        const chatsCol = collection(this.db, 'chats');
        const q = query(chatsCol, where('participantIds', 'array-contains', user.uid));
        
        const unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
          const chats: ChatRoom[] = [];
          snapshot.forEach(d => {
            chats.push({ id: d.id, ...d.data() } as ChatRoom);
          });

          // Ordenação Tardia Local (Garante que chats com serverTimestamp() pendente fiquem no topo)
          chats.sort((a,b) => {
            const tA = a.lastMessageAt?.seconds || Date.now() / 1000 + 10000;
            const tB = b.lastMessageAt?.seconds || Date.now() / 1000 + 10000;
            return tB - tA;
          });

          observer.next(chats);
        }, (err) => {
          console.error("Erro no Snapshopt da Inbox:", err);
          observer.error(err);
        });

        // Retornamos a função de limpeza do onSnapshot se o usuário deslogar ou a sub terminar
        return () => unsubscribeSnapshot();
      });
    });
  }

  async getChatDetails(chatId: string): Promise<ChatRoom | undefined> {
     const docRef = doc(this.db, 'chats', chatId);
     const snap = await getDoc(docRef);
     if (snap.exists()) {
         return { id: snap.id, ...snap.data() } as ChatRoom;
     }
     return undefined;
  }

  getMessages(chatId: string, limitCount: number = 20): Observable<ChatMessage[]> {
    return new Observable(observer => {
        const messagesCol = collection(this.db, `chats/${chatId}/messages`);
        const q = query(messagesCol, orderBy('createdAt', 'desc')); // Descendente para facilitar infinite scroll reverso

        return onSnapshot(q, (snapshot) => {
            const msgs: ChatMessage[] = [];
            // `estimate`: a mensagem recém-enviada aparece na hora, com o
            // relógio local, em vez de esperar o horário do servidor.
            snapshot.forEach(d => {
                msgs.push({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as ChatMessage);
            });
            // Revertemos para exibir cronológico na UI
            observer.next(msgs.reverse());
        }, (err) => {
            observer.error(err);
        });
    });
  }

  /**
   * @param recipientIds quem recebe (soma 1 nas não lidas dessas contas). Sem
   *   isso, lê a conversa para descobrir.
   */
  async sendMessage(
    chatId: string,
    content: { text: string, type: 'text' | 'image' | 'audio', mediaUrl?: string, clientId?: string },
    recipientIds?: string[]
  ): Promise<void> {
     const user = this.getCurrentUser();
     if (!user) throw new Error("Usuário não autenticado");

     // Validação de Banimento
     const userDocRef = doc(this.db, 'users', user.uid);
     const [userSnap, recipients] = await Promise.all([
       getDoc(userDocRef),
       recipientIds
         ? Promise.resolve(recipientIds)
         : this.getChatDetails(chatId).then(c => c?.participantIds ?? [])
     ]);
     if (userSnap.exists() && (userSnap.data() as AppUser).isChatBanned) {
       throw new Error("Sua conta possui restrições para envio de mensagens.");
     }

     const batch = writeBatch(this.db);
     
     const messagesCol = collection(this.db, `chats/${chatId}/messages`);
     const newMsgRef = doc(messagesCol);
     
     const messageData: any = {
        senderId: user.uid,
        text: content.text,
        type: content.type,
        createdAt: serverTimestamp()
     };
     if (content.mediaUrl) messageData.mediaUrl = content.mediaUrl;
     if (content.clientId) messageData.clientId = content.clientId;

     batch.set(newMsgRef, messageData);

     const chatRef = doc(this.db, 'chats', chatId);
     let lastText = content.text;
     if (content.type === 'image') lastText = '📷 Foto';
     if (content.type === 'audio') lastText = '🎤 Áudio';

     const chatUpdate: Record<string, any> = {
        lastMessage: lastText,
        lastMessageAt: serverTimestamp(),
        lastSenderId: user.uid,
        // Quem escreve está com a conversa aberta: o que veio antes já foi lido.
        [`unread.${user.uid}`]: 0,
        [`readAt.${user.uid}`]: serverTimestamp()
     };
     recipients.filter(id => id && id !== user.uid).forEach(id => {
        chatUpdate[`unread.${id}`] = increment(1);
     });
     batch.update(chatRef, chatUpdate);

     await batch.commit();
  }

  async sendSystemMessage(chatId: string, senderId: string, text: string): Promise<void> {
     const batch = writeBatch(this.db);
     
     const messagesCol = collection(this.db, `chats/${chatId}/messages`);
     const newMsgRef = doc(messagesCol);
     
     const messageData: any = {
        senderId: senderId,
        text: text,
        type: 'text',
        createdAt: serverTimestamp(),
        isAiGenerated: true
     };

     batch.set(newMsgRef, messageData);

     const chatRef = doc(this.db, 'chats', chatId);
     batch.update(chatRef, {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        lastSenderId: senderId
     });

     await batch.commit();
  }

  /**
   * Finaliza uma conversa, marcando como 'closed'.
   */
  async closeChat(chatId: string): Promise<void> {
    const chatRef = doc(this.db, 'chats', chatId);
    await updateDoc(chatRef, {
      status: 'closed',
      closedAt: serverTimestamp()
    });
  }

  /**
   * Deleta múltiplas conversas de uma só vez permanentemente.
   * Nota: Isso deleta apenas o documento principal da conversa.
   */
  async deleteChatsBulk(chatIds: string[]): Promise<void> {
    const batch = writeBatch(this.db);
    
    chatIds.forEach(id => {
      const docRef = doc(this.db, 'chats', id);
      batch.delete(docRef);
    });

    await batch.commit();
  }

  /** MODERAÇÃO E ADMINISTRAÇÃO **/

  /**
   * Puxa todas as conversas do sistema (apenas para Admin)
   */
  getAllChatsAdmin(): Observable<ChatRoom[]> {
    return new Observable(observer => {
      const chatsCol = collection(this.db, 'chats');
      const q = query(chatsCol, orderBy('lastMessageAt', 'desc'));

      return onSnapshot(q, (snapshot) => {
        const chats: ChatRoom[] = [];
        snapshot.forEach(d => {
          chats.push({ id: d.id, ...d.data() } as ChatRoom);
        });
        observer.next(chats);
      });
    });
  }

  /**
   * Envia uma denúncia sobre um usuário em um chat
   */
  async reportUser(report: Omit<ChatReport, 'createdAt' | 'status'>): Promise<void> {
    const reportsCol = collection(this.db, 'reports');
    const newReport: ChatReport = {
      ...report,
      createdAt: serverTimestamp(),
      status: 'pending'
    };
    await addDoc(reportsCol, newReport);
  }

  /**
   * Puxa todas as denúncias (apenas para Admin)
   */
  getReports(): Observable<ChatReport[]> {
    return new Observable(observer => {
      const reportsCol = collection(this.db, 'reports');
      const q = query(reportsCol, orderBy('createdAt', 'desc'));

      return onSnapshot(q, (snapshot) => {
        const reports: ChatReport[] = [];
        snapshot.forEach(d => {
          reports.push({ id: d.id, ...d.data() } as ChatReport);
        });
        observer.next(reports);
      });
    });
  }

  /**
   * Bane ou desbane o usuário do sistema de chat
   */
  async toggleUserChatBan(userId: string, isBanned: boolean): Promise<void> {
    const userRef = doc(this.db, 'users', userId);
    await updateDoc(userRef, {
      isChatBanned: isBanned
    });
  }

  /**
   * Obtém a contagem total de mensagens enviadas em todos os chats (Usa Collection Group)
   */
  async getTotalMessagesCount(): Promise<number> {
    const messagesQuery = collectionGroup(this.db, 'messages');
    const snapshot = await getCountFromServer(messagesQuery);
    return snapshot.data().count;
  }

  /**
   * Obtém a contagem total de mensagens de um tipo específico (Usa Collection Group)
   */
  async getTotalMediaCount(type: 'text' | 'image' | 'audio'): Promise<number> {
    const messagesQuery = query(collectionGroup(this.db, 'messages'), where('type', '==', type));
    const snapshot = await getCountFromServer(messagesQuery);
    return snapshot.data().count;
  }

  /**
   * Converte um timestamp do Firebase (ou Date) em objeto Date JS
   */
  convertTimestampToDate(timestamp: any): Date {
    if (!timestamp) return new Date();
    if (timestamp instanceof Date) return timestamp;
    if (typeof timestamp.toDate === 'function') return timestamp.toDate();
    if (typeof timestamp === 'number') return new Date(timestamp);
    if (timestamp.seconds !== undefined) return new Date(timestamp.seconds * 1000);
    return new Date(timestamp);
  }

  private async dispatchNewConversationTrigger(
    chatId: string,
    starter: ChatParticipant,
    recipient: ChatParticipant,
    productContext?: { id: string, name: string, photo?: string }
  ): Promise<void> {
    try {
      await this.whatsappService.dispatchTrigger({
        eventType: 'new_conversation',
        data: {
          chat: chatId,
          nome: starter.name,
          cliente: starter.name,
          vendedor: recipient.name,
          produto: productContext?.name || 'Conversa direta',
          produtoId: productContext?.id || ''
        }
      });
    } catch (error) {
      console.warn('Falha ao disparar gatilho de nova conversa:', error);
    }
  }
}
