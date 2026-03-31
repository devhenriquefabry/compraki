export interface Subcategory {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  icon?: string;
  subcategories: Subcategory[];
}
