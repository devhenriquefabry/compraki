/**
 * Cor da loja (a que o vendedor escolhe em "Minha vitrine").
 *
 * A cor vira fundo de botão na página pública da loja. Como o vendedor pode
 * escolher qualquer tom — inclusive o lima da Vineon —, o texto em cima não
 * pode ser sempre branco: aqui se escolhe entre azul-noite e branco o que
 * tiver mais contraste (WCAG), e a prévia da vitrine usa a mesma conta.
 */

export const SHOP_COLOR_DEFAULT = '#D8F51F';

const NAVY = '#0B1623';
const WHITE = '#FFFFFF';

/** Tons sugeridos na vitrine: todos com contraste AA para algum texto em cima. */
export const SHOP_COLOR_SWATCHES: { hex: string; name: string }[] = [
  { hex: '#D8F51F', name: 'Lima Vineon' },
  { hex: '#0B1623', name: 'Azul-noite' },
  { hex: '#1D4ED8', name: 'Azul' },
  { hex: '#0F766E', name: 'Petróleo' },
  { hex: '#15803D', name: 'Verde' },
  { hex: '#6D28D9', name: 'Roxo' },
  { hex: '#BE185D', name: 'Rosa' },
  { hex: '#B91C1C', name: 'Vermelho' },
  { hex: '#C2410C', name: 'Laranja' },
  { hex: '#78350F', name: 'Café' },
];

export function normalizeHex(value: string | null | undefined): string | null {
  const raw = (value || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return '#' + raw.split('').map(c => c + c).join('').toUpperCase();
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? '#' + raw.toUpperCase() : null;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Azul-noite ou branco: o que se lê melhor em cima da cor da loja. */
export function textOnShopColor(color: string | null | undefined): string {
  const hex = normalizeHex(color) || SHOP_COLOR_DEFAULT;
  return contrastRatio(hex, NAVY) >= contrastRatio(hex, WHITE) ? NAVY : WHITE;
}
