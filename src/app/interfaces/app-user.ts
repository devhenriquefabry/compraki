export interface AppAddress {
  cep: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
}

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  phoneNumber?: string | null;
  cpf?: string | null;
  isSeller: boolean; // Todo usuário é um vendedor potencial
  address?: AppAddress;
  createdAt?: any;
  lastLoginAt?: any;
  status?: 'online' | 'offline';
  lastActive?: any;
  isChatBanned?: boolean;
}
