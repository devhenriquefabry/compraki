import { Product } from './product';

export interface CartItem {
  id?: string;
  productId: string;
  /** Id da combinação escolhida (ver `skuKey`), quando o produto tem variações. */
  skuId?: string | null;
  /** "Cor: Preto · Tamanho: M", pronto para exibir no carrinho/checkout/pedido. */
  variantLabel?: string | null;
  /** Um valor por atributo, ex: { Cor: "Preto", Tamanho: "M" }. */
  variantSelection?: Record<string, string> | null;
  quantity: number;
  addedAt: any; // Firestore Timestamp
  /**
   * Retrato do produto no momento em que foi adicionado. Quando há variação
   * escolhida, `price`/`priceDiscounted`/`stock` aqui já são os da
   * combinação (SKU), não os agregados do produto — o resto da UI do
   * carrinho lê estes campos direto, sem precisar saber de variações.
   */
  productData: Product;
}
