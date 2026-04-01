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
}

export interface ChatMessage {
  id?: string;
  senderId: string;
  text: string;
  createdAt: any; // Firestore Timestamp
}
