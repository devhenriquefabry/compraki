import { environment } from '../../environments/environment';
import { CatalogProduct } from '../interfaces/catalog';
import { catalogPhotos, normalizeText } from './catalog';

/**
 * Imagens ilustrativas do catálogo (src/assets/catalogo/ilustracoes, geradas
 * por functions/scripts/catalog-illustrations.mjs). Desenhos próprios da
 * Vineon, um por tipo de produto, usados quando a ficha não tem foto oficial.
 * O vendedor é orientado a trocar pela foto real ao anunciar.
 */

const FOLDER = '/assets/catalogo/ilustracoes/';

/** Primeira regra que casa com nome/modelo/linha decide o desenho. A ordem importa. */
const BY_NAME: [RegExp, string][] = [
  [/\b(controle|dualsense|dualshock|joystick|gamepad)\b/, 'controle'],
  [/(smartwatch|apple watch|galaxy watch|smart band|mi band|relogio inteligente)/, 'smartwatch'],
  [/\b(ipad|tablet|galaxy tab|kindle)\b/, 'tablet'],
  [/\b(drone|dji)\b/, 'drone'],
  [/\bprojetor\b/, 'projetor'],
  [/\bmicro ?ondas\b/, 'micro-ondas'],
  [/\b(panelas?|frigideira|cacarola)\b/, 'panela'],
  [/(copo termico|garrafa termica|stanley|quencher|squeeze)/, 'copo-termico'],
  [/\b(racao|sache|petisco|areia para gatos)\b/, 'racao'],
  [/\b(iphone|galaxy [asmz]\d|moto g|smartphone|celular|redmi (note )?\d|poco [a-z]\d|xiaomi \d)/, 'celular'],
  [/\b(airpods|buds|soundcore|earbuds?|tws)\b/, 'earbuds'],
  [/\b(echo|alexa|smart speaker)\b/, 'smart-speaker'],
  [/\b(headset|headphone|fone)\b/, 'headphone'],
  [/(caixa de som|jbl (go|flip|charge|boombox|partybox))/, 'caixa-som'],
  [/\b(tv|televis\w*|roku|chromecast|fire tv)\b/, 'tv'],
  [/\bswitch\b/, 'console-portatil'],
  [/\b(console|playstation|xbox)\b/, 'console'],
  [/\b(ssd|nvme|hd externo)\b/, 'ssd'],
  [/\b(mouse|teclado)\b/, 'periferico'],
  [/\b(starlink|antena)\b/, 'antena'],
  [/(air ?fryer|fritadeira)/, 'air-fryer'],
  [/\bliquidificador\b/, 'liquidificador'],
  [/\bbatedeira\b/, 'batedeira'],
  [/\bcafeteira\b/, 'cafeteira'],
  [/\bventilador\b/, 'ventilador'],
  [/aspirador.*vertical|vertical.*aspirador/, 'aspirador-vertical'],
  [/\baspirador\b/, 'aspirador'],
  [/(alta pressao|lava jato|lavajato)/, 'lavadora-pressao'],
  [/\b(serra|furadeira|parafusadeira|esmerilhadeira|lixadeira|tupia)\b/, 'ferramenta-eletrica'],
  [/\b(chaves?|estilete|alicate|martelo|soquetes?)\b/, 'ferramenta-manual'],
  [/\b(escova|secador|chapinha|prancha|modelador)\b/, 'escova-cabelo'],
  [/\b(perfume|colonia|eau de)/, 'perfume'],
  [/\b(whey|creatina|suplemento|proteina|vitamina|pre treino)\b/, 'suplemento'],
  [/\b(chinelo|havaianas|sandalia|rasteira)\b/, 'chinelo'],
  [/\b(hidratante|protetor solar|shampoo|condicionador|oleo|creme|locao|baume|serum|sabonete)\b/, 'cosmetico'],
];

/** Sem pista no nome: vale a subcategoria (ids do banco de produção). */
const BY_SUBCATEGORY: Record<string, string> = {
  'cat_eletronicos-celulares': 'celular',
  'cat_eletronicos-audio': 'headphone',
  'cat_eletronicos-tv-video': 'tv',
  'cat_eletronicos-games': 'controle',
  'cat_brinquedos-videogames': 'controle',
  'cat_eletronicos-informatica': 'periferico',
  'cat_eletrodomesticos-climatizacao': 'ventilador',
  'cat_eletrodomesticos-aspiradores': 'aspirador',
  'cat_ferramentas-ferramentas-eletricas': 'ferramenta-eletrica',
  'cat_ferramentas-ferramentas-manuais': 'ferramenta-manual',
  'cat_beleza-pele': 'cosmetico',
  'cat_beleza-cabelos': 'cosmetico',
  'cat_beleza-perfumaria': 'perfume',
  'cat_saude-suplementos': 'suplemento',
  'cat_moda-calcados': 'chinelo',
  'cat_eletronicos-cameras': 'drone',
  'cat_eletrodomesticos-cozinha': 'micro-ondas',
  'cat_casa-cozinha': 'panela',
  'cat_petshop-racao': 'racao',
  'cat_moda-relogios-joias': 'smartwatch',
};

export function illustrationKey(product: Pick<CatalogProduct, 'title' | 'model' | 'line' | 'subcategoryId'>): string {
  const text = normalizeText(`${product.title} ${product.model} ${product.line ?? ''}`);
  const hit = BY_NAME.find(([rule]) => rule.test(text));
  if (hit) return hit[1];
  return BY_SUBCATEGORY[product.subcategoryId ?? ''] ?? 'produto';
}

/**
 * URL absoluta: o anúncio publicado guarda o endereço, e ele precisa abrir no
 * site, no app e em qualquer lugar que mostre a foto do anúncio.
 */
export function illustrationUrl(product: Pick<CatalogProduct, 'title' | 'model' | 'line' | 'subcategoryId'>): string {
  const origin = environment.production
    ? 'https://www.vineonsite.com.br'
    : (typeof location !== 'undefined' ? location.origin : '');
  return `${origin}${FOLDER}${illustrationKey(product)}.png`;
}

export function isIllustration(url: string | null | undefined): boolean {
  return !!url && url.includes(FOLDER);
}

/** Capa para mostrar: a primeira foto oficial ou, sem ela, a ilustração. */
export function catalogCover(product: CatalogProduct): string {
  return catalogPhotos(product)[0] || illustrationUrl(product);
}
