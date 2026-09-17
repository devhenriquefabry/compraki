/**
 * Formatos de banner — fonte única para o carrossel do site, o banner do app
 * e as orientações/validações de "Gestão de Banners".
 *
 * Por que duas artes: no celular o banner ocupa a largura da tela e precisa de
 * altura para o texto ser legível (2,7:1). No computador ele é uma faixa larga
 * acima das vitrines (4:1); a mesma arte ali ficaria alta demais e empurraria
 * os produtos para baixo da dobra. É o que Mercado Livre e Amazon fazem.
 *
 * Área segura: margem onde nada importante deve ficar.
 *  - Celular: cantos arredondados e o recuo lateral da tela comem as bordas.
 *  - Computador: as setas do carrossel (44 px) cobrem as laterais.
 */

export type BannerFormatKey = 'mobile' | 'desktop';

export interface BannerFormat {
  key: BannerFormatKey;
  label: string;
  width: number;
  height: number;
  ratioLabel: string;
  /** Margem segura em px da arte: [horizontal, vertical]. */
  safe: [number, number];
  /** Altura mínima de letra, em px da arte, para ficar legível na tela. */
  minTextPx: number;
  maxBytes: number;
  where: string;
}

export const BANNER_FORMATS: Record<BannerFormatKey, BannerFormat> = {
  mobile: {
    key: 'mobile',
    label: 'Celular',
    width: 1080,
    height: 400,
    ratioLabel: '2,7:1',
    safe: [60, 40],
    minTextPx: 40,
    maxBytes: 2 * 1024 * 1024,
    where: 'App e site em tela pequena',
  },
  desktop: {
    key: 'desktop',
    label: 'Computador',
    width: 1920,
    height: 480,
    ratioLabel: '4:1',
    safe: [120, 40],
    minTextPx: 32,
    maxBytes: 2 * 1024 * 1024,
    where: 'Home do site (vineonsite.com.br)',
  },
};

export function bannerRatio(format: BannerFormat): number {
  return format.width / format.height;
}

/** Área segura em porcentagem, para desenhar a moldura na prévia. */
export function safeInsetPercent(format: BannerFormat): { x: number; y: number } {
  return {
    x: (format.safe[0] / format.width) * 100,
    y: (format.safe[1] / format.height) * 100,
  };
}

export interface BannerImageCheck {
  width: number;
  height: number;
  /** Problemas que impedem o envio. */
  errors: string[];
  /** Avisos: dá para enviar, mas o resultado não fica bom. */
  warnings: string[];
}

const RATIO_TOLERANCE = 0.06;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Lê as dimensões do arquivo e compara com o formato esperado. */
export async function checkBannerImage(file: File, format: BannerFormat): Promise<BannerImageCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!ACCEPTED_TYPES.includes(file.type)) {
    errors.push('Use JPG, PNG ou WEBP.');
  }
  if (file.size > format.maxBytes) {
    errors.push(`O arquivo tem ${(file.size / 1024 / 1024).toFixed(1)} MB; o máximo é ${format.maxBytes / 1024 / 1024} MB. Exporte em JPG ou WEBP com qualidade 80%.`);
  }

  const { width, height } = await readImageSize(file).catch(() => ({ width: 0, height: 0 }));
  if (!width || !height) {
    errors.push('Não foi possível ler a imagem.');
    return { width, height, errors, warnings };
  }

  const expected = bannerRatio(format);
  const actual = width / height;
  if (Math.abs(actual - expected) / expected > RATIO_TOLERANCE) {
    const cut = actual < expected ? 'em cima e embaixo' : 'nas laterais';
    warnings.push(
      `A imagem tem ${width} × ${height} px (${actual.toFixed(1).replace('.', ',')}:1). ` +
      `O formato ${format.label.toLowerCase()} é ${format.ratioLabel}, então ela será cortada ${cut}.`
    );
  }
  if (width < format.width * 0.75) {
    warnings.push(`Resolução baixa (${width} px de largura). Use ${format.width} × ${format.height} px para não ficar borrada.`);
  }

  return { width, height, errors, warnings };
}

function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('imagem inválida'));
    };
    img.src = url;
  });
}
