/**
 * Perfil público de vendedor — documento `sellers/{uid}`.
 *
 * Espelho somente-leitura de `users/{uid}`, mantido pela Cloud Function
 * `syncSellerProfile` (functions/src/seller-profile.ts). Leitura é pública,
 * por isso este tipo é a lista fechada do que pode aparecer aqui.
 *
 * NUNCA adicionar a este tipo: cpf, email, phoneNumber, address, isAdmin,
 * super_admin, role. Se um campo novo é dado pessoal, ele fica em `users/`.
 */
export interface PublicSellerProfile {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  username?: string | null;
  isSeller: boolean;

  /** Presença — usada para o selo "online" na vitrine. */
  status?: 'online' | 'offline';

  /** Customização da vitrine. */
  shopName?: string;
  shopDescription?: string;
  shopBanner?: string;
  shopPrimaryColor?: string;
  shopSecondaryColor?: string;
  shopFeaturedTitle?: string;

  /**
   * Contatos que o vendedor escolheu tornar públicos na vitrine.
   * Diferente de `phoneNumber` em `users/`, que é dado cadastral privado.
   */
  shopInstagram?: string;
  shopWhatsApp?: string;

  createdAt?: any;
  updatedAt?: any;
}

/** Campos espelhados de `users/{uid}` para `sellers/{uid}`. */
export const PUBLIC_SELLER_FIELDS = [
  'displayName',
  'photoURL',
  'username',
  'isSeller',
  'status',
  'shopName',
  'shopDescription',
  'shopBanner',
  'shopPrimaryColor',
  'shopSecondaryColor',
  'shopFeaturedTitle',
  'shopInstagram',
  'shopWhatsApp',
  'createdAt'
] as const;
