export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt?: any;
  lastLoginAt?: any;
}
