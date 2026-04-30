export interface Product {
    id?: string;
    name : string;
    price : number;
    priceDiscounted? : number;
    description? : string;
    photoURL? : string[]; 
    condition: 'novo' | 'usado-como-novo' | 'usado-bom' | 'usado-aceitavel';
    stock: number;
    soldCount? : number;
    categoryIds: string[];
    subcategoryIds: string[];
    acceptOffers?: boolean;
    paymentMethods: ('PIX' | 'CARTÃO' | 'DINHEIRO')[];
    shipping: 'Frete Grátis' | 'A combinar' | 'Entrega Expressa';
    
    // Dimensões para Melhor Envio
    weight?: number; // em kg
    width?: number;  // em cm
    height?: number; // em cm
    length?: number; // em cm
    
    rating?: number;
    location?: string;
    sellerId?: string;
    createdAt?: any;
    updatedAt?: any;
}
