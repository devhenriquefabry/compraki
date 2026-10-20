import { Product } from "./product";

export interface ChatParticipant {
  uid: string;
  name: string;
  photoUrl?: string;
}

export interface ChatRoom {
  id?: string;
  participantIds: string[]; // Usado para filtro rápido no Firestore
  participants: ChatParticipant[]; // Usado na interface para mostrar nome/foto do outro lado
  productId?: string; // Contexto de qual produto gerou o chat
  productName?: string;
  productPhoto?: string;
  lastMessage?: string;
  lastMessageAt?: any; // Firestore Timestamp
  createdAt?: any;
  source?: 'marketplace' | 'direct';
  status?: 'active' | 'closed';
  closedAt?: any; // Firestore Timestamp
  /** Quem abriu a conversa. Conversa sem mensagem não aparece para o outro lado. */
  createdBy?: string;
  /** Lados da conversa de anúncio/loja. Antigas não têm: ver `chatSellerId()`. */
  buyerId?: string;
  sellerId?: string;
  /** Quem mandou a última mensagem — "Você:" na lista. */
  lastSenderId?: string;
  /** Mensagens ainda não lidas, por conta. Quem envia soma 1 no outro lado. */
  unread?: Record<string, number>;
  /** Última vez que cada conta abriu a conversa — vira o "Lida" do outro lado. */
  readAt?: Record<string, any>;
}
 
export interface ChatMessage {
  id?: string;
  senderId: string;
  text: string;
  type: 'text' | 'image' | 'audio';
  mediaUrl?: string;
  createdAt: any; // Firestore Timestamp
  status?: 'sending' | 'error';
  clientId?: string; // ID único gerado pelo cliente para evitar duplicidade
}

export interface ChatReport {
  id?: string;
  senderId: string;
  senderName: string;
  reportedUserId: string;
  chatId: string;
  productName?: string;
  reason: 'spam' | 'abuse' | 'scam' | 'other';
  details?: string;
  createdAt: any;
  status: 'pending' | 'resolved' | 'ignored';
}

