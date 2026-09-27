import { ProductSpec, ProductVariantAttribute } from './product';

/**
 * Produto do catálogo Vineon (`catalogProducts/{id}`), montado pelo admin na
 * aba Catálogo do painel.
 *
 * É a "ficha pronta" de um produto novo: fotos, ficha técnica, variações,
 * medidas da embalagem e descrição sugerida. O vendedor encontra o produto,
 * confirma que é o que vende e só informa condição, preço, estoque e entrega.
 *
 * O anúncio (`products/{id}`) recebe uma CÓPIA desses dados e guarda
 * `catalogId`; mudar o catálogo depois não altera anúncios já publicados.
 */
export interface CatalogProduct {
  id?: string;
  /** Nome que o comprador vê, ex.: "Apple iPhone 15". Vira o título do anúncio. */
  title: string;
  brand: string;
  model: string;
  /** Linha/família, ex.: "iPhone 15", "Galaxy A". Opcional. */
  line?: string;
  categoryId: string;
  subcategoryId?: string | null;

  /** Fotos na ordem de exibição; a primeira é a capa. */
  photos: string[];
  /** Ficha técnica fixa: o vendedor não edita, só acrescenta extras. */
  specs: ProductSpec[];
  /** Códigos de barras (EAN/GTIN) aceitos na busca "por código". */
  gtins: string[];
  /** Outros nomes que o vendedor pode digitar, ex.: "ps5", "play 5". */
  aliases: string[];

  /** Até 2 atributos (ex.: Cor, Armazenamento) com as opções que existem. */
  variantAttributes: ProductVariantAttribute[];
  /** Foto de cada opção do 1º atributo (ex.: "Preto" -> URL). */
  variantImages: Record<string, string>;

  /** Embalagem, usada no cálculo do frete (kg / cm). */
  weight: number | null;
  width: number | null;
  height: number | null;
  length: number | null;

  /** Texto inicial da descrição; o vendedor pode completar. */
  description: string;
  /** Preço de referência mostrado ao vendedor (opcional, R$). */
  referencePrice?: number | null;

  /** Rascunho não aparece para o vendedor. */
  status: CatalogStatus;

  /**
   * Palavras e prefixos normalizados (sem acento, minúsculos) para a busca
   * com `array-contains`. Gerado por `catalogKeywords()`; nunca editar à mão.
   */
  keywords?: string[];

  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
  updatedBy?: string;
}

export type CatalogStatus = 'active' | 'draft';

/** Item da lista de verificação de qualidade (admin e prévia). */
export interface CatalogCheck {
  key: string;
  label: string;
  ok: boolean;
  /** Obrigatório para publicar no catálogo (status `active`). */
  required: boolean;
}

/** Resumo das lojas que já anunciam um produto do catálogo. */
export interface CatalogCompetition {
  sellers: number;
  listings: number;
  /** Menor preço à vista entre os anúncios com estoque; null sem anúncio. */
  lowestPrice: number | null;
}
