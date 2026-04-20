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

