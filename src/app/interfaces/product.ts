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
     * Variações (cor, tamanho...), no molde Mercado Livre/Shopee.
     * Quando `hasVariants` é true, `price`/`stock` no topo viram valores
     * agregados: `stock` é a soma de todas as combinações (`skus`), e `price`
     * segue sendo o preço "a partir de" mostrado nas vitrines. O preço e o
     * estoque de cada combinação específica moram em `skus`.
     */
    hasVariants?: boolean;
    /** Até 2 atributos (ex: Cor, Tamanho), na ordem em que aparecem para o comprador. */
    variantAttributes?: ProductVariantAttribute[];
    /** Foto associada a cada valor do 1º atributo (ex: "Preto" -> URL da foto preta). */
    variantImages?: Record<string, string>;
    /**
     * Galeria de cada valor do 1º atributo (ex: "Preto" -> 5 fotos do preto).
     * Quando existe, a página do produto mostra essas fotos ao escolher a opção.
     * As fotos também estão em `photoURL`, para capa e vitrines.
     */
    variantPhotos?: Record<string, string[]>;
    /**
     * Quantas fotos do começo de `photoURL` são gerais (valem para todas as
     * opções); o resto são fotos só das galerias. Sem o campo (anúncio antigo),
     * geral é toda foto que não está em galeria nenhuma.
     */
    generalPhotoCount?: number;
    /** Uma combinação por chave (ver `skuKey` em `core/product-variants.ts`). */
    skus?: Record<string, ProductSku>;

    /**
     * Nota média, total de avaliações e contagem por estrela (chaves '1'..'5').
     * Escritos só pela Cloud Function `onProductReviewWritten`; as regras do
     * Firestore barram o vendedor de mexer neles.
     */
    rating?: number;
    reviewCount?: number;
    ratingBreakdown?: Record<string, number>;
    /** Quantas avaliações têm foto (função `onProductReviewWritten`). */
    reviewPhotoCount?: number;
    /** Respostas a "o produto é como no anúncio?" (função `onProductReviewWritten`). */
    listingMatch?: { yes?: number; partly?: number; no?: number };
    location?: string;
    sellerId?: string;

    /**
     * Produto do catálogo Vineon usado como base (`catalogProducts/{id}`).
     * O anúncio guarda uma cópia de título, fotos e ficha técnica; o catálogo
     * mudar depois não altera o anúncio.
     */
    catalogId?: string | null;
    /** Código de barras herdado do catálogo, quando houver. */
    gtin?: string | null;
    createdAt?: any;
    updatedAt?: any;

    /**
     * Anúncio fora do ar por moderação. Só admin e Cloud Function escrevem
     * (firestore.rules): o vendedor não consegue se "desbloquear".
     */
    moderation?: ProductModeration;
}

export type ProductModerationReason =
    /** Título com termo da lista de proibidos (função `moderateProductName`). */
    | 'blocked_word'
    /** Conta do vendedor suspensa (função `setAccountSuspension`). */
    | 'account_suspended'
    /** Admin tirou do ar pela aba Denúncias. */
    | 'removed_by_admin';

export interface ProductModeration {
    hidden: boolean;
    reason: ProductModerationReason;
    /** Termo que bloqueou, quando `reason` é `blocked_word`. */
    term?: string;
    note?: string;
    at?: any;
    by?: string;
}

export interface ProductSpec {
    label: string;
    value: string;
}

export interface ProductVariantAttribute {
    /** Ex: "Cor", "Tamanho". */
    name: string;
    /** Ex: ["Preto", "Branco"]. Sem duplicatas. */
    values: string[];
}

export interface ProductSku {
    /** Chave estável derivada dos valores selecionados — ver `skuKey`. */
    id: string;
    /** Um valor por atributo do produto, ex: { Cor: "Preto", Tamanho: "M" }. */
    attributes: Record<string, string>;
    /** Sobrescreve o preço do produto para esta combinação; null usa o preço base. */
    price?: number | null;
    stock: number;
}
