/**
 * Imagens da página da loja: capa (banner) e foto/logo.
 * ----------------------------------------------------------------------------
 * Fonte única para a orientação que o vendedor lê em "Minha vitrine", para o
 * enquadramento que recorta a imagem antes do envio e para o CSS da página
 * pública (`seller-profile`), que usa as mesmas proporções.
 *
 * Capa 4:1, como a do Etsy e o banner de computador da home: no computador ela
 * aparece inteira numa faixa de até 1104 px; no celular ocupa a largura da tela
 * em 5:2, ou seja, só os 1200 px do meio da arte (62,5 %) ficam visíveis. Logo
 * e textos vão nessa faixa central.
 */

export type ShopMediaKind = 'banner' | 'photo';

export interface ShopMediaSpec {
  kind: ShopMediaKind;
  label: string;
  /** Tamanho em que a imagem é gravada (e o recomendado para a arte). */
  width: number;
  height: number;
  ratioLabel: string;
  /** Abaixo disso a imagem fica borrada na tela: o enquadramento avisa. */
  minWidth: number;
  shape: 'rect' | 'circle';
}

export const SHOP_MEDIA: Record<ShopMediaKind, ShopMediaSpec> = {
  banner: {
    kind: 'banner',
    label: 'Capa da loja',
    width: 1920,
    height: 480,
    ratioLabel: '4:1',
    minWidth: 1200,
    shape: 'rect',
  },
  photo: {
    kind: 'photo',
    label: 'Foto da loja',
    width: 800,
    height: 800,
    ratioLabel: '1:1',
    minWidth: 400,
    shape: 'circle',
  },
};

/** No celular a capa vira 5:2 e mostra só o meio da arte. */
export const BANNER_MOBILE_RATIO = 5 / 2;
export const BANNER_MOBILE_SAFE = Math.round(SHOP_MEDIA.banner.height * BANNER_MOBILE_RATIO); // 1200 px

export const SHOP_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const SHOP_IMAGE_MAX_BYTES = 15 * 1024 * 1024;

/** Motivo para recusar o arquivo antes de abrir o enquadramento, ou null. */
export function shopImageProblem(file: File): string | null {
  if (!SHOP_IMAGE_TYPES.includes(file.type)) {
    return 'Use uma imagem JPG, PNG ou WEBP.';
  }
  if (file.size > SHOP_IMAGE_MAX_BYTES) {
    return 'A imagem passa de 15 MB. Exporte em tamanho menor e tente de novo.';
  }
  return null;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível abrir a imagem.'));
    img.src = src;
  });
}

/**
 * Recorta `source` (em px da imagem original) e grava em JPEG no tamanho do
 * formato — sem ampliar: imagem menor que o formato sai do tamanho que tem.
 */
export async function renderCrop(
  img: HTMLImageElement,
  source: { x: number; y: number; width: number; height: number },
  spec: ShopMediaSpec,
): Promise<Blob> {
  const scale = Math.min(1, spec.width / source.width);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(width * spec.height / spec.width));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Seu navegador não conseguiu preparar a imagem.');

  // Fundo branco: logo em PNG transparente não vira preto no JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, source.x, source.y, source.width, source.height, 0, 0, width, height);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Seu navegador não conseguiu preparar a imagem.');
  return blob;
}
