export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  phoneNumber?: string | null;
  cpf?: string | null;
  isSeller: boolean; // Todo usuário é um vendedor potencial
  createdAt?: any;
  lastLoginAt?: any;
}
