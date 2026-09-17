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
    /**
     * Quantas pessoas salvaram este produto.
     * Mantido pelos gatilhos `onProductSaved`/`onProductUnsaved`. Nao escrever
     * pelo cliente: contar na leitura obrigava a varrer os salvos de todos os
     * usuarios a cada abertura de tela.
     */
    savedCount?: number;
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
    
    /** Ficha técnica livre (Marca, Modelo, Cor...), preenchida pelo vendedor. */
    specs?: ProductSpec[];

    /**
     * Nota média, total de avaliações e contagem por estrela (chaves '1'..'5').
     * Escritos só pela Cloud Function `onProductReviewWritten`; as regras do
     * Firestore barram o vendedor de mexer neles.
     */
    rating?: number;
    reviewCount?: number;
    ratingBreakdown?: Record<string, number>;
    location?: string;
    sellerId?: string;
    createdAt?: any;
    updatedAt?: any;
}

export interface ProductSpec {
    label: string;
    value: string;
}
