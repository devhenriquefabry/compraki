import { Product } from './product';

export interface SavedItem {
  id?: string;
  productId: string;
  savedAt: any; // Firestore Timestamp
  productData: Product;
}
