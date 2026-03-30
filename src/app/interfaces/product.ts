export interface Product {
    id?: string;
    name : string,
    price : number,
    priceDiscounted? : number,
    description? : string,
    photoURL? : string[], 
    isUsed : boolean,
    soldCount? : number;
    categories?: string[];
    acceptOffers?: boolean;
    inventory?: number;
    paymentMethod? : 'PIX' | 'CARTÃO';
    shipping?: 'Frete Grátis' | 'A combinar',
    rating?: number;

}
