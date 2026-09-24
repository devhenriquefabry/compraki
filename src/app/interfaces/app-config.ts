/**
 * Configuração da loja que o admin muda pelo painel (aba "Ajustes") e que vale
 * na hora para todo mundo: `appConfig/storefront` no Firestore, leitura
 * pública, escrita só de admin (firestore.rules).
 *
 * Nada de segredo aqui — o documento é lido por qualquer visitante. Credencial
 * de integração continua em `settings/`, que o cliente não alcança.
 */

export interface FreeShippingRule {
  /** Liga/desliga a regra sem perder o valor configurado. */
  enabled: boolean;
  /** Produto com preço cobrado a partir deste valor sai com frete grátis. */
  minValue: number;
}

export type SocialNetwork = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'whatsapp' | 'x';

export type SocialLinks = Partial<Record<SocialNetwork, string>>;

export interface StorefrontConfig {
  freeShipping: FreeShippingRule;
  socialLinks: SocialLinks;
  /**
   * Termos que não podem aparecer no título de um anúncio. Comparação sem
   * acento e sem caixa, palavra inteira; `*` no fim vale como prefixo
   * ("arma*" pega "armas", "armamento"). Ver core/product-moderation.ts.
   */
  blockedWords: string[];
  updatedAt?: any;
  updatedBy?: string;
}

export const DEFAULT_STOREFRONT_CONFIG: StorefrontConfig = {
  freeShipping: { enabled: false, minValue: 200 },
  socialLinks: {},
  blockedWords: [],
};

export const SOCIAL_NETWORKS: { id: SocialNetwork; label: string; icon: string; placeholder: string }[] = [
  { id: 'instagram', label: 'Instagram', icon: 'logo-instagram', placeholder: 'https://instagram.com/vineon' },
  { id: 'facebook', label: 'Facebook', icon: 'logo-facebook', placeholder: 'https://facebook.com/vineon' },
  { id: 'tiktok', label: 'TikTok', icon: 'logo-tiktok', placeholder: 'https://tiktok.com/@vineon' },
  { id: 'youtube', label: 'YouTube', icon: 'logo-youtube', placeholder: 'https://youtube.com/@vineon' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp', placeholder: 'https://wa.me/5511999999999' },
  { id: 'x', label: 'X (Twitter)', icon: 'logo-x', placeholder: 'https://x.com/vineon' },
];
