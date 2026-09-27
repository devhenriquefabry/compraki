import { CatalogCheck, CatalogProduct } from '../interfaces/catalog';
import { ProductSpec, ProductVariantAttribute } from '../interfaces/product';

/**
 * Regras do catálogo Vineon que não dependem do Firestore: busca por
 * palavras, código de barras, lista de qualidade e textos de resumo.
 * Usado pela aba Catálogo do admin e pelo fluxo de anunciar do vendedor.
 */

/** Tamanho máximo de um prefixo guardado em `keywords`. */
const MAX_PREFIX = 20;
const MAX_KEYWORDS = 400;

export const MAX_CATALOG_PHOTOS = 10;
export const MAX_CATALOG_SPECS = 30;
export const MIN_GOOD_PHOTOS = 3;
export const MIN_GOOD_SPECS = 5;
export const MIN_GOOD_DESCRIPTION = 80;

/** Atalhos de atributo de variação no editor do admin. */
export const CATALOG_ATTRIBUTE_SUGGESTIONS = ['Cor', 'Armazenamento', 'Tamanho', 'Voltagem', 'Capacidade'];

// ------------------------------------------------------------------ texto

/** Sem acento, minúsculo, sem espaços nas pontas: "Câmera" -> "camera". */
export function normalizeText(text: string | null | undefined): string {
  return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Palavras normalizadas (só letras e números). */
export function splitWords(text: string | null | undefined): string[] {
  return normalizeText(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Tudo em que a busca do vendedor pode bater. */
export function catalogWords(product: Partial<CatalogProduct>): string[] {
  const sources = [
    product.title,
    product.brand,
    product.model,
    product.line,
    ...(product.aliases || []),
    ...(product.gtins || []),
    ...(product.variantAttributes || []).flatMap(attr => attr.values),
  ];
  return Array.from(new Set(sources.flatMap(splitWords)));
}

/**
 * Palavras + prefixos de cada palavra ("iphone" -> "ip", "iph", ... "iphone"),
 * para autocompletar com uma única consulta `array-contains`.
 */
export function catalogKeywords(product: Partial<CatalogProduct>): string[] {
  const keys = new Set<string>();
  for (const word of catalogWords(product)) {
    const top = Math.min(word.length, MAX_PREFIX);
    if (word.length === 1) keys.add(word);
    for (let size = 2; size <= top; size++) keys.add(word.slice(0, size));
    keys.add(word);
  }
  return Array.from(keys).slice(0, MAX_KEYWORDS);
}

/** Palavras que o vendedor digitou, na forma usada na busca. */
export function queryTokens(term: string): string[] {
  return Array.from(new Set(splitWords(term)));
}

/**
 * A palavra que vai para o Firestore: a mais longa (mais seletiva), cortada no
 * tamanho máximo de prefixo guardado. Null quando só há letras soltas.
 */
export function pivotToken(tokens: string[]): string | null {
  const candidates = tokens.filter(t => t.length >= 2);
  if (!candidates.length) return null;
  const longest = candidates.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.slice(0, MAX_PREFIX);
}

/** Cada palavra digitada precisa ser começo de alguma palavra do produto. */
export function matchesTokens(product: Partial<CatalogProduct>, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const words = catalogWords(product);
  return tokens.every(token => words.some(word => word.startsWith(token)));
}

/** Pontuação para ordenar resultados: título e marca pesam mais. */
export function matchScore(product: Partial<CatalogProduct>, tokens: string[]): number {
  const title = splitWords(product.title);
  const head = [...splitWords(product.brand), ...splitWords(product.model)];
  let score = 0;
  for (const token of tokens) {
    if (title.some(w => w === token)) score += 4;
    else if (title.some(w => w.startsWith(token))) score += 3;
    if (head.some(w => w.startsWith(token))) score += 2;
  }
  // Nomes mais curtos (o modelo "puro") antes das versões compridas.
  return score - (product.title || '').length / 100;
}

// -------------------------------------------------------------- código

export function onlyDigits(text: string | null | undefined): string {
  return (text || '').replace(/\D/g, '');
}

/**
 * Código de barras GTIN (EAN-8, UPC-A de 12, EAN-13, GTIN-14) com dígito
 * verificador conferido. Evita cadastrar número digitado errado.
 */
export function isValidGtin(code: string): boolean {
  const digits = onlyDigits(code);
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1).split('').map(Number);
  const sum = body.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[digits.length - 1]);
}

/**
 * Código curto exibido ao vendedor e ao admin, ex.: "VN-7K2P9QXA". Vem de um
 * hash do id do documento: estável e sem depender do formato do id.
 */
export function catalogCode(id: string | null | undefined): string {
  if (!id) return 'VN-NOVO';
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let second = hash;
  for (let i = id.length - 1; i >= 0; i--) {
    second ^= id.charCodeAt(i);
    second = Math.imul(second, 0x01000193) >>> 0;
  }
  const code = (hash.toString(36) + second.toString(36)).toUpperCase().padStart(8, '0');
  return `VN-${code.slice(0, 8)}`;
}

// ------------------------------------------------------------- resumo

/** "Cor" -> "cores", "Voltagem" -> "voltagens", "Tamanho" -> "tamanhos". */
function plural(name: string): string {
  const lower = name.trim().toLowerCase();
  if (!lower) return 'opções';
  if (/(s|x)$/.test(lower)) return lower;
  if (/[rz]$/.test(lower)) return `${lower}es`;
  if (/m$/.test(lower)) return `${lower.slice(0, -1)}ns`;
  if (/al$/.test(lower)) return `${lower.slice(0, -2)}ais`;
  if (/ão$/.test(lower)) return `${lower.slice(0, -2)}ões`;
  return `${lower}s`;
}

/** "5 cores · 3 armazenamentos". Vazio quando não há variação. */
export function variantSummary(attributes: ProductVariantAttribute[] | null | undefined): string {
  return (attributes || [])
    .filter(attr => attr.name && attr.values?.length)
    .map(attr => attr.values.length === 1
      ? `${attr.name}: ${attr.values[0]}`
      : `${attr.values.length} ${plural(attr.name)}`)
    .join(' · ');
}

/** "0,2 kg · 16 × 8 × 4 cm", ou vazio sem medidas. */
export function packageSummary(product: Pick<CatalogProduct, 'weight' | 'width' | 'height' | 'length'>): string {
  const parts: string[] = [];
  if (product.weight) {
    parts.push(product.weight < 1
      ? `${Math.round(product.weight * 1000)} g`
      : `${product.weight.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`);
  }
  if (product.width && product.height && product.length) {
    parts.push(`${product.length} × ${product.width} × ${product.height} cm`);
  }
  return parts.join(' · ');
}

// ------------------------------------------------------------ qualidade

function filled(text: string | null | undefined): boolean {
  return !!text && text.trim().length > 0;
}

function hasPackage(product: Partial<CatalogProduct>): boolean {
  return [product.weight, product.width, product.height, product.length]
    .every(value => typeof value === 'number' && value > 0);
}

/**
 * O que falta para a ficha ficar boa. `required` bloqueia a publicação no
 * catálogo; o resto só baixa a nota de qualidade.
 */
export function catalogChecks(product: Partial<CatalogProduct>): CatalogCheck[] {
  const specs = cleanCatalogSpecs(product.specs);
  const photos = product.photos || [];
  return [
    { key: 'title', label: 'Nome do produto', ok: filled(product.title) && product.title!.trim().length >= 4, required: true },
    { key: 'brand', label: 'Marca e modelo', ok: filled(product.brand) && filled(product.model), required: true },
    { key: 'category', label: 'Categoria', ok: filled(product.categoryId), required: true },
    { key: 'photo', label: 'Foto de capa', ok: photos.length >= 1, required: true },
    { key: 'package', label: 'Medidas e peso da embalagem', ok: hasPackage(product), required: true },
    { key: 'photos', label: `${MIN_GOOD_PHOTOS} fotos ou mais`, ok: photos.length >= MIN_GOOD_PHOTOS, required: false },
    { key: 'specs', label: `${MIN_GOOD_SPECS} características ou mais`, ok: specs.length >= MIN_GOOD_SPECS, required: false },
    { key: 'gtin', label: 'Código de barras (EAN)', ok: (product.gtins || []).length > 0, required: false },
    { key: 'description', label: 'Descrição com detalhes', ok: (product.description || '').trim().length >= MIN_GOOD_DESCRIPTION, required: false },
  ];
}

/** 0 a 100: obrigatórios valem o dobro. */
export function qualityScore(product: Partial<CatalogProduct>): number {
  const checks = catalogChecks(product);
  const total = checks.reduce((sum, c) => sum + (c.required ? 2 : 1), 0);
  const done = checks.reduce((sum, c) => sum + (c.ok ? (c.required ? 2 : 1) : 0), 0);
  return Math.round((done / total) * 100);
}

export function canActivate(product: Partial<CatalogProduct>): boolean {
  return catalogChecks(product).every(check => check.ok || !check.required);
}

export function cleanCatalogSpecs(specs: ProductSpec[] | null | undefined): ProductSpec[] {
  return (specs || [])
    .map(s => ({ label: (s.label || '').trim(), value: (s.value || '').trim() }))
    .filter(s => s.label && s.value)
    .slice(0, MAX_CATALOG_SPECS);
}

export function emptyCatalogProduct(): CatalogProduct {
  return {
    title: '',
    brand: '',
    model: '',
    line: '',
    categoryId: '',
    subcategoryId: null,
    photos: [],
    specs: [],
    gtins: [],
    aliases: [],
    variantAttributes: [],
    variantImages: {},
    weight: null,
    width: null,
    height: null,
    length: null,
    description: '',
    referencePrice: null,
    status: 'draft',
  };
}

// ------------------------------------------------------ ficha sugerida

interface SpecTemplate {
  match: RegExp;
  label: string;
  fields: string[];
}

/**
 * Características que costumam aparecer em cada tipo de produto. O admin
 * adiciona com um clique; a lista escolhida é pela categoria/subcategoria.
 */
const SPEC_TEMPLATES: SpecTemplate[] = [
  { match: /celular|telefone|smartphone/, label: 'celulares', fields: ['Memória interna', 'Memória RAM', 'Tamanho da tela', 'Câmera principal', 'Câmera frontal', 'Bateria', 'Processador', 'Sistema operacional', 'Dual SIM', 'Rede 5G', 'Homologação Anatel'] },
  { match: /informatica|notebook|computador|tablet/, label: 'informática', fields: ['Processador', 'Memória RAM', 'Armazenamento', 'Tamanho da tela', 'Resolução da tela', 'Placa de vídeo', 'Sistema operacional', 'Bateria'] },
  { match: /televis|\btv\b/, label: 'TVs', fields: ['Tamanho da tela', 'Resolução', 'Tipo de tela', 'Smart TV', 'Sistema operacional', 'Entradas HDMI', 'Taxa de atualização', 'Voltagem'] },
  { match: /game|console/, label: 'games', fields: ['Plataforma', 'Armazenamento', 'Edição', 'Controles inclusos', 'Resolução máxima', 'Jogos inclusos'] },
  { match: /audio|fone|som|caixa/, label: 'áudio', fields: ['Tipo', 'Conexão', 'Versão do Bluetooth', 'Cancelamento de ruído', 'Autonomia da bateria', 'Microfone', 'Resistência à água'] },
  { match: /camera|foto/, label: 'câmeras', fields: ['Resolução', 'Tipo de sensor', 'Zoom óptico', 'Gravação de vídeo', 'Estabilização', 'Conectividade'] },
  { match: /eletrodomest|geladeira|fogao|forno|lavadora|micro|aspirador|ventilador|ar-condicionado|cozinha/, label: 'eletrodomésticos', fields: ['Voltagem', 'Potência', 'Capacidade', 'Cor', 'Eficiência energética', 'Garantia do fabricante', 'Itens inclusos'] },
  { match: /moda|roupa|camis|calca|vestido|calcad|tenis|sapato|bolsa/, label: 'moda', fields: ['Gênero', 'Material', 'Composição', 'Estilo', 'Tipo de gola', 'Tipo de manga', 'Origem'] },
  { match: /beleza|perfume|maquiagem|cosmet|cabelo/, label: 'beleza', fields: ['Volume', 'Tipo', 'Fragrância', 'Gênero', 'Tipo de pele', 'Validade'] },
  { match: /esporte|bicicleta|ciclismo|fitness/, label: 'esportes', fields: ['Material', 'Tamanho do aro', 'Número de marchas', 'Tipo de freio', 'Peso suportado'] },
  { match: /casa|movei|decora|iluminacao|organiza|jardim|cama|mesa|banho/, label: 'casa', fields: ['Material', 'Cor', 'Largura', 'Altura', 'Profundidade', 'Requer montagem', 'Itens inclusos'] },
];

const GENERIC_FIELDS = ['Cor', 'Material', 'Garantia do fabricante', 'Itens inclusos', 'Origem', 'Voltagem'];

/** Sugestões para a categoria escolhida (nome da categoria + subcategoria). */
export function specSuggestions(categoryText: string, used: ProductSpec[]): { label: string; fields: string[] } {
  const text = normalizeText(categoryText);
  const template = SPEC_TEMPLATES.find(t => t.match.test(text));
  const taken = new Set(used.map(s => normalizeText(s.label)));
  const fields = (template?.fields ?? GENERIC_FIELDS).filter(f => !taken.has(normalizeText(f)));
  return { label: template?.label ?? 'qualquer produto', fields };
}
