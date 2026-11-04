// Regras puras do anúncio: bloqueio por termo (cópia do app e do servidor) e
// preço por variação. Não precisa de emulador:
//
//   node functions/scripts/product-rules.test.mjs
//
// As duas cópias de `findBlockedWord` rodam contra a mesma tabela: se uma mudar
// sem a outra, a bateria acusa.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');

/** Transpila um .ts (imports de tipo somem) e devolve o módulo. */
async function load(rel, transform = s => s) {
  const source = transform(fs.readFileSync(path.join(root, rel), 'utf8'));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const file = path.join(os.tmpdir(), `vineon-${path.basename(rel, '.ts')}-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, outputText);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// A cópia do servidor mora num arquivo que importa o firebase-admin: só o
// trecho puro interessa.
const serverOnly = source => {
  const start = source.indexOf('// -- início: regra de termos');
  const end = source.indexOf('// -- fim: regra de termos');
  if (start < 0 || end < 0) throw new Error('marcadores da regra de termos não achados em moderation.ts');
  return source.slice(start, end);
};

const dropImports = s => s.replace(/^import .*$/gm, '');

const client = await load('src/app/core/product-moderation.ts', dropImports);
const server = await load('functions/src/moderation.ts', serverOnly);
const list = await load('src/app/core/recommended-blocked-terms.ts');
const pricing = await load('src/app/core/product-pricing.ts', dropImports);

let failed = 0, passed = 0;
function ok(cond, label) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FALHOU  ${label}`);
}

// ------------------------------------------------------------ bloqueio
//  título                                   lista                        bloqueia?
const CASES = [
  // O caso do Henrique: o termo tem categoria + modelo, o título só o modelo.
  ['ak47',                                 ['arma de fogo ak47'],       true],
  ['AK-47',                                ['arma de fogo ak47'],       true],
  ['ak 47 original',                       ['arma de fogo ak47'],       true],
  ['Fuzil AK47 novo',                      ['arma de fogo ak47'],       true],
  ['ak47',                                 ['fuzil ak 47'],             true],
  ['ar15 usado',                           ['ar15 arma de fogo'],       true],
  ['Rifle m1911',                          ['pistola m1911'],           true],
  // Termo escrito de um jeito, título de outro.
  ['ak47',                                 ['ak-47'],                   true],
  ['AK-47',                                ['ak47'],                    true],
  ['a k 4 7',                              ['ak47'],                    true],
  ['Arma Fogo calibre 12',                 ['arma de fogo'],            true],
  ['Fogo: arma de caça',                   ['arma de fogo'],            true],
  ['Cartão de crédito clonado',            ['cartao clonado'],          true],
  ['Cartão Nubank clonado',                ['cartão clonado'],          true],
  // Plural e disfarce com números.
  ['Armas antigas',                        ['arma'],                    true],
  ['Vapes descartáveis',                   ['vape'],                    true],
  ['Lote de fuzis',                        ['fuzil'],                   true],
  ['Caixa de munições',                    ['munição'],                 true],
  ['Animais silvestres',                   ['animal silvestre'],        true],
  ['c0ca1na pura',                         ['cocaina'],                 true],
  ['M4c0nh4 da boa',                       ['maconha'],                 true],
  // Prefixo com `*` continua valendo.
  ['Armamento pesado',                     ['arma*'],                   true],
  ['Tênis falsificados',                   ['falsificad*'],             true],
  // Já funcionava e não pode quebrar.
  ['Arma de pressão',                      ['arma'],                    true],
  ['Cigarro eletrônico sabor uva',         ['cigarro eletronico'],      true],

  // Não pode bloquear: palavra parecida ou genérica de um termo composto.
  ['Armário de cozinha',                   ['arma'],                    false],
  ['Panela de pressão',                    ['arma de pressão'],         false],
  ['Fogo de chão para churrasco',          ['arma de fogo ak47'],       false],
  ['Arma de brinquedo Nerf',               ['arma de fogo ak47'],       false],
  ['Parafuso 9mm inox',                    ['pistola 9mm'],             false],
  ['Parafuso M16',                         ['fuzil m16'],               false],
  ['Capa para iPhone16',                   ['iphone16 falsificado'],    false],
  ['Camiseta branca',                      ['arma branca'],             false],
  ['Controle remoto eletrônico',           ['cigarro eletrônico'],      false],
  ['Cartão de visita',                     ['cartão clonado'],          false],
  ['TV 4K 50 polegadas',                   ['ak'],                      false],
  ['Celular 5G 128GB',                     ['sg'],                      false],
  ['Fone JBL Tune 520BT',                  ['arma de fogo ak47'],       false],
  ['',                                     ['arma'],                    false],
  ['Qualquer coisa',                       [],                          false],
];

for (const [name, impl] of [['app', client], ['servidor', server]]) {
  for (const [title, terms, blocked] of CASES) {
    const got = impl.findBlockedWord(title, terms);
    ok(blocked ? got === terms[0] : got === null,
      `[${name}] "${title}" com ${JSON.stringify(terms)} → ${JSON.stringify(got)} (esperado ${blocked ? 'bloquear' : 'liberar'})`);
  }
}

// ------------------------------------------------------- lista recomendada
const TERMS = list.RECOMMENDED_BLOCKED_TERMS;
ok(Array.isArray(TERMS) && TERMS.length >= 100, 'lista recomendada tem ao menos 100 termos');
ok(new Set(TERMS).size === TERMS.length, 'lista recomendada sem repetidos');
ok(TERMS.every(t => t === t.trim().toLowerCase() && t.length >= 3), 'termos em minúsculas, sem espaço sobrando, 3+ letras');

const MUST_BLOCK = ['Fuzil AK-47', 'Glock G19', 'Munição 9mm', 'Pod descartável vape', 'Cocaína', 'Ozempic 1mg',
  'Rivotril 2mg', 'Cartão de crédito clonado', 'RG falso', 'Tênis Nike réplica primeira linha', 'Animal silvestre',
  'Fogos de artifício', 'Bloqueador de sinal celular', 'Lança perfume'];
for (const title of MUST_BLOCK) ok(client.findBlockedWord(title, TERMS) !== null, `lista deveria bloquear "${title}"`);

// Produtos comuns de marketplace que a lista não pode derrubar.
const MUST_PASS = ['Armário de cozinha 6 portas', 'Pistola de cola quente', 'Pistola de pintura elétrica',
  'Pistola de pressão para lavadora', 'Cartucho de tinta HP 664', 'Panela de pressão 4,5L', 'Fogão 4 bocas',
  'Faca de cozinha inox', 'Boneca heroína Marvel', 'Fantasia de pirata infantil', 'Bomba de leite materno',
  'Macaco hidráulico 2 toneladas', 'Apple iPhone 16', 'Samsung Galaxy S24', 'Coleira antipulgas para gatos',
  'Cartão SD 128GB', 'Maçarico culinário', 'Papagaio de pelúcia', 'Kit de pesca com vara', 'Camisa do Flamengo 2024',
  'Bala de goma Fini', 'Taurus Fit perfume', 'Seda para cabelo', 'Álcool 70 gel', 'Tiro ao alvo de dardos',
  'Colete salva-vidas', 'Coldplay camiseta', 'Crachá com cordão', 'Cachorro de pelúcia', 'Granada romã decorativa'];
for (const title of MUST_PASS) {
  const term = client.findBlockedWord(title, TERMS);
  ok(term === null, `lista não deveria bloquear "${title}" (pegou em "${term}")`);
}

// ------------------------------------------------------ preço por variação
const parse = pricing.parsePriceInput;
const PRICES = [
  ['3200', 3200], ['3.200', 3200], ['3.200,00', 3200], ['3200,50', 3200.5], ['3200.50', 3200.5],
  ['3,5', 3.5], ['1.234.567,89', 1234567.89], ['R$ 2.800,00', 2800], ['3.', 3], ['3.20', 3.2],
  ['', null], ['0', null], ['0,00', null], ['abc', null], ['-5', 5],
];
for (const [raw, want] of PRICES) {
  ok(parse(raw) === want, `parsePriceInput(${JSON.stringify(raw)}) = ${parse(raw)} (esperado ${want})`);
}

const sku = (price, stock = 1) => ({ id: 'x', attributes: {}, price, stock });
const promo = { price: 3000, priceDiscounted: 2500, hasVariants: true };

ok(pricing.skuUnitPrice(promo, sku(2800)) === 2800, 'combinação com preço próprio usa o dela');
ok(pricing.skuUnitPrice(promo, sku(null)) === 2500, 'combinação sem preço usa o do anúncio (promocional)');

const noOwn = { ...promo, skus: { a: sku(null), b: sku(null) } };
ok(pricing.priceMain(noOwn) === 2500 && pricing.hasDiscount(noOwn), 'sem preço próprio nada muda na vitrine');

const own = { ...promo, skus: { a: sku(3200), b: sku(2800), c: sku(1000, 0) } };
ok(pricing.priceMain(own) === 2800, 'vitrine mostra a combinação mais barata com estoque');
ok(!pricing.hasDiscount(own), 'de/por do anúncio não vale para combinação com preço próprio');
ok(pricing.hasVariedPrices(own), 'preços diferentes viram "a partir de"');
ok(!pricing.hasVariedPrices(noOwn), 'preço único não mostra "a partir de"');

const mixed = { ...promo, skus: { a: sku(null), b: sku(2800) } };
ok(pricing.priceMain(mixed) === 2500 && pricing.hasDiscount(mixed), 'a mais barata é a do anúncio: de/por continua');

const allOut = { ...promo, skus: { a: sku(3200, 0), b: sku(2800, 0) } };
ok(pricing.priceMain(allOut) === 2800, 'esgotado ainda mostra um preço');

const plain = { price: 100, priceDiscounted: null };
ok(pricing.priceMain(plain) === 100 && !pricing.hasVariedPrices(plain), 'produto sem variação segue igual');

console.log(failed ? `\n${failed} falha(s), ${passed} ok` : `\nTudo certo: ${passed} verificações`);
process.exit(failed ? 1 : 0);
