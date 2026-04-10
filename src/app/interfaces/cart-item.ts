import { Product } from './product';

export interface CartItem {
  id?: string;
  productId: string;
  quantity: number;
  addedAt: any; // Firestore Timestamp
  productData: Product;
}
