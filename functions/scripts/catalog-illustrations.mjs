// Gera as imagens ilustrativas do catálogo (src/assets/catalogo/ilustracoes).
//
//   node functions/scripts/catalog-illustrations.mjs [pasta-do-playwright]
//
// Desenhos próprios da Vineon (vetor → PNG 1000×1000, fundo branco), um por
// tipo de produto, com a legenda "Imagem ilustrativa". Aparecem quando a ficha
// do catálogo não tem foto oficial; o vendedor é orientado a trocar pela foto
// real. Não representam nenhum produto de marca específico — de propósito.
//
// Precisa do Playwright com Edge/Chrome. Sem argumento, usa `playwright` do
// próprio node_modules.

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../src/assets/catalogo/ilustracoes');

const N = '#0B1623';   // azul-noite
const N2 = '#13233A';  // superfície escura
const N3 = '#24364F';  // brilho em superfície escura
const L = '#D8F51F';   // lima (só preenchimento)
const G = '#E3E7EC';   // cinza claro
const G2 = '#C8D0DA';  // cinza médio
const W = '#FFFFFF';

const shadow = (cx = 500, cy = 820, rx = 260) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="26" fill="#EEF1F5"/>`;

/** Cada desenho ocupa ~y 120–820 num quadro 1000×1000. */
export const DRAWINGS = {
  celular: `${shadow(500, 840, 200)}
    <rect x="335" y="140" width="330" height="680" rx="58" fill="${N}"/>
    <clipPath id="tela"><rect x="352" y="157" width="296" height="646" rx="44"/></clipPath>
    <rect x="352" y="157" width="296" height="646" rx="44" fill="${N2}"/>
    <g clip-path="url(#tela)"><circle cx="600" cy="330" r="170" fill="${N3}"/><circle cx="400" cy="640" r="130" fill="${L}" opacity=".9"/></g>
    <rect x="455" y="178" width="90" height="26" rx="13" fill="${N}"/>
    <rect x="665" y="300" width="8" height="90" rx="4" fill="${N3}"/>`,

  headphone: `${shadow()}
    <path d="M300 520 V420 a200 200 0 0 1 400 0 V520" fill="none" stroke="${N}" stroke-width="44" stroke-linecap="round"/>
    <rect x="245" y="470" width="130" height="250" rx="62" fill="${N}"/>
    <rect x="625" y="470" width="130" height="250" rx="62" fill="${N}"/>
    <rect x="285" y="500" width="70" height="190" rx="35" fill="${N3}"/>
    <rect x="645" y="500" width="70" height="190" rx="35" fill="${N3}"/>
    <rect x="232" y="560" width="14" height="70" rx="7" fill="${L}"/>`,

  earbuds: `${shadow(500, 830, 230)}
    <rect x="300" y="430" width="400" height="360" rx="120" fill="${W}" stroke="${G2}" stroke-width="8"/>
    <line x1="308" y1="560" x2="692" y2="560" stroke="${G2}" stroke-width="6"/>
    <circle cx="500" cy="640" r="12" fill="${L}"/>
    <g transform="rotate(-14 400 300)"><ellipse cx="400" cy="250" rx="62" ry="70" fill="${W}" stroke="${G2}" stroke-width="8"/><rect x="378" y="290" width="44" height="150" rx="22" fill="${W}" stroke="${G2}" stroke-width="8"/><circle cx="390" cy="240" r="16" fill="${N}"/></g>
    <g transform="rotate(14 600 300)"><ellipse cx="600" cy="250" rx="62" ry="70" fill="${W}" stroke="${G2}" stroke-width="8"/><rect x="578" y="290" width="44" height="150" rx="22" fill="${W}" stroke="${G2}" stroke-width="8"/><circle cx="610" cy="240" r="16" fill="${N}"/></g>`,

  'caixa-som': `${shadow(500, 760, 330)}
    <rect x="200" y="360" width="600" height="330" rx="165" fill="${N}"/>
    <ellipse cx="285" cy="525" rx="58" ry="120" fill="${N3}"/>
    <ellipse cx="715" cy="525" rx="58" ry="120" fill="${N3}"/>
    <rect x="360" y="400" width="280" height="250" rx="30" fill="${N2}"/>
    <g fill="${N3}">${Array.from({ length: 5 }, (_, r) => Array.from({ length: 9 }, (_, c) => `<circle cx="${392 + c * 27}" cy="${440 + r * 44}" r="7"/>`).join('')).join('')}</g>
    <rect x="455" y="610" width="90" height="16" rx="8" fill="${L}"/>
    <rect x="780" y="480" width="70" height="90" rx="20" fill="none" stroke="${N}" stroke-width="16"/>`,

  'smart-speaker': `${shadow(500, 800, 210)}
    <circle cx="500" cy="530" r="240" fill="${N}"/>
    <rect x="300" y="740" width="400" height="40" rx="12" fill="${N}"/>
    <path d="M300 690 Q 500 770 700 690" fill="none" stroke="${L}" stroke-width="18" stroke-linecap="round"/>
    <circle cx="420" cy="420" r="70" fill="${N3}" opacity=".7"/>
    <g fill="${N3}"><circle cx="450" cy="330" r="12"/><circle cx="500" cy="318" r="12"/><circle cx="550" cy="330" r="12"/></g>`,

  tv: `${shadow(500, 820, 300)}
    <rect x="130" y="190" width="740" height="450" rx="22" fill="${N}"/>
    <rect x="148" y="208" width="704" height="414" rx="10" fill="${N2}"/>
    <circle cx="640" cy="360" r="160" fill="${N3}"/>
    <rect x="220" y="520" width="220" height="40" rx="20" fill="${L}"/>
    <path d="M300 640 L260 800 M700 640 L740 800" stroke="${N}" stroke-width="26" stroke-linecap="round"/>`,

  console: `${shadow(480, 830, 220)}
    <path d="M360 170 C 330 170 320 190 320 220 L 300 780 C 300 800 315 815 340 815 L 440 815 L 460 170 Z" fill="${W}" stroke="${G2}" stroke-width="8"/>
    <path d="M600 170 C 630 170 640 190 640 220 L 660 780 C 660 800 645 815 620 815 L 520 815 L 500 170 Z" fill="${W}" stroke="${G2}" stroke-width="8"/>
    <rect x="455" y="170" width="50" height="645" rx="12" fill="${N}"/>
    <rect x="470" y="240" width="20" height="60" rx="10" fill="${L}"/>`,

  'console-portatil': `${shadow(500, 740, 360)}
    <rect x="130" y="330" width="170" height="380" rx="80" fill="${N3}"/>
    <rect x="700" y="330" width="170" height="380" rx="80" fill="${N3}"/>
    <rect x="270" y="330" width="460" height="380" rx="24" fill="${N}"/>
    <rect x="300" y="360" width="400" height="320" rx="10" fill="${N2}"/>
    <circle cx="560" cy="480" r="110" fill="${N3}"/>
    <circle cx="215" cy="440" r="36" fill="${N}"/><circle cx="785" cy="580" r="36" fill="${N}"/>
    <g fill="${L}"><circle cx="785" cy="420" r="14"/><circle cx="815" cy="450" r="14"/><circle cx="755" cy="450" r="14"/><circle cx="785" cy="480" r="14"/></g>
    <rect x="195" y="560" width="40" height="40" rx="6" fill="${N}"/>`,

  controle: `${shadow(500, 770, 300)}
    <path d="M300 330 H700 C 820 330 860 460 880 600 C 895 720 820 770 760 720 L 670 620 H330 L240 720 C 180 770 105 720 120 600 C 140 460 180 330 300 330 Z" fill="${N}"/>
    <circle cx="330" cy="450" r="42" fill="${N3}"/><rect x="310" y="430" width="40" height="40" rx="6" fill="${N}"/>
    <rect x="290" y="440" width="80" height="20" rx="4" fill="${N2}"/><rect x="320" y="410" width="20" height="80" rx="4" fill="${N2}"/>
    <g fill="${L}"><circle cx="670" cy="400" r="20"/><circle cx="710" cy="440" r="20"/><circle cx="630" cy="440" r="20"/><circle cx="670" cy="480" r="20"/></g>
    <circle cx="420" cy="560" r="44" fill="${N3}"/><circle cx="580" cy="560" r="44" fill="${N3}"/>
    <rect x="440" y="360" width="120" height="80" rx="14" fill="${N2}"/>`,

  ssd: `${shadow(500, 640, 330)}
    <rect x="170" y="420" width="660" height="170" rx="14" fill="${N}"/>
    <rect x="200" y="445" width="150" height="120" rx="8" fill="${N3}"/>
    <rect x="380" y="445" width="150" height="120" rx="8" fill="${N3}"/>
    <rect x="560" y="455" width="110" height="100" rx="8" fill="${N2}"/>
    <g fill="${L}">${Array.from({ length: 8 }, (_, i) => `<rect x="${702 + i * 14}" y="440" width="8" height="130" rx="2"/>`).join('')}</g>
    <circle cx="190" cy="505" r="14" fill="${W}"/>
    <rect x="420" y="470" width="70" height="14" rx="7" fill="${L}"/>`,

  periferico: `${shadow(500, 790, 340)}
    <rect x="140" y="470" width="560" height="220" rx="28" fill="${N}"/>
    <g fill="${N3}">${Array.from({ length: 3 }, (_, r) => Array.from({ length: 9 }, (_, c) => `<rect x="${170 + c * 57}" y="${500 + r * 52}" width="44" height="38" rx="8"/>`).join('')).join('')}</g>
    <rect x="280" y="650" width="280" height="24" rx="8" fill="${N3}"/>
    <path d="M790 420 C 870 420 890 520 885 600 C 880 700 840 760 780 760 C 720 760 690 700 690 600 C 690 500 710 420 790 420 Z" fill="${N}"/>
    <path d="M788 430 V 540" stroke="${N3}" stroke-width="8"/>
    <rect x="778" y="470" width="20" height="44" rx="10" fill="${L}"/>`,

  antena: `${shadow(500, 800, 300)}
    <g transform="rotate(-18 500 460)">
      <rect x="250" y="220" width="500" height="430" rx="24" fill="${W}" stroke="${G2}" stroke-width="10"/>
      <rect x="290" y="260" width="420" height="350" rx="14" fill="${G}"/>
      <circle cx="500" cy="435" r="46" fill="${L}"/>
    </g>
    <path d="M470 640 L420 790 M560 630 L610 790" stroke="${N}" stroke-width="22" stroke-linecap="round"/>`,

  'air-fryer': `${shadow(500, 810, 250)}
    <rect x="270" y="170" width="460" height="630" rx="70" fill="${N}"/>
    <rect x="310" y="210" width="380" height="120" rx="40" fill="${N2}"/>
    <circle cx="500" cy="270" r="34" fill="${L}"/>
    <rect x="300" y="380" width="400" height="380" rx="44" fill="${N2}"/>
    <rect x="410" y="520" width="180" height="60" rx="30" fill="${N3}"/>
    <rect x="430" y="535" width="140" height="30" rx="15" fill="${N}"/>`,

  liquidificador: `${shadow(500, 820, 210)}
    <path d="M360 170 H640 L610 560 H390 Z" fill="${G}" stroke="${G2}" stroke-width="10" stroke-linejoin="round"/>
    <rect x="345" y="150" width="310" height="40" rx="14" fill="${N}"/>
    <path d="M640 250 C 720 250 720 450 620 450" fill="none" stroke="${G2}" stroke-width="22"/>
    <path d="M420 300 H580 M425 380 H575 M430 460 H570" stroke="${W}" stroke-width="10" stroke-linecap="round"/>
    <path d="M370 560 H630 L660 800 H340 Z" fill="${N}"/>
    <circle cx="500" cy="690" r="46" fill="${N3}"/><circle cx="500" cy="690" r="16" fill="${L}"/>`,

  batedeira: `${shadow(480, 810, 280)}
    <rect x="250" y="720" width="480" height="80" rx="24" fill="${N}"/>
    <rect x="620" y="330" width="100" height="400" rx="36" fill="${N}"/>
    <rect x="300" y="250" width="440" height="170" rx="80" fill="${N}"/>
    <rect x="330" y="290" width="120" height="30" rx="15" fill="${L}"/>
    <path d="M360 420 V560 M420 420 V560" stroke="${G2}" stroke-width="16" stroke-linecap="round"/>
    <path d="M250 540 H560 L530 720 H280 Z" fill="${G}" stroke="${G2}" stroke-width="8" stroke-linejoin="round"/>`,

  cafeteira: `${shadow(500, 810, 230)}
    <rect x="330" y="150" width="340" height="120" rx="30" fill="${N}"/>
    <rect x="560" y="260" width="110" height="480" rx="20" fill="${N}"/>
    <rect x="310" y="730" width="380" height="70" rx="20" fill="${N}"/>
    <path d="M360 460 C 360 420 380 400 420 400 H520 C 550 400 560 420 560 450 V 690 C 560 715 545 730 520 730 H400 C 375 730 360 715 360 690 Z" fill="${G}" stroke="${G2}" stroke-width="8"/>
    <path d="M360 560 H560 V690 C560 715 545 730 520 730 H400 C375 730 360 715 360 690 Z" fill="${N3}"/>
    <rect x="590" y="620" width="50" height="22" rx="11" fill="${L}"/>`,

  ventilador: `${shadow(500, 830, 220)}
    <circle cx="500" cy="380" r="250" fill="${W}" stroke="${N}" stroke-width="22"/>
    <g fill="${N3}">${[0, 60, 120, 180, 240, 300].map(a => `<ellipse cx="500" cy="270" rx="46" ry="100" transform="rotate(${a} 500 380)"/>`).join('')}</g>
    <circle cx="500" cy="380" r="46" fill="${N}"/><circle cx="500" cy="380" r="16" fill="${L}"/>
    <rect x="480" y="630" width="40" height="150" fill="${N}"/>
    <rect x="360" y="770" width="280" height="50" rx="25" fill="${N}"/>`,

  'aspirador-vertical': `${shadow(500, 830, 240)}
    <rect x="470" y="120" width="60" height="560" rx="30" fill="${N}"/>
    <rect x="455" y="100" width="90" height="120" rx="34" fill="${N}"/>
    <rect x="420" y="300" width="160" height="260" rx="60" fill="${G}" stroke="${G2}" stroke-width="8"/>
    <rect x="455" y="340" width="90" height="40" rx="20" fill="${L}"/>
    <path d="M300 740 C 300 700 330 680 380 680 H620 C 670 680 700 700 700 740 V790 H300 Z" fill="${N}"/>`,

  aspirador: `${shadow(420, 810, 260)}
    <rect x="200" y="360" width="380" height="440" rx="60" fill="${N}"/>
    <rect x="220" y="330" width="340" height="80" rx="30" fill="${N2}"/>
    <circle cx="390" cy="370" r="24" fill="${L}"/>
    <rect x="240" y="470" width="300" height="240" rx="40" fill="${N3}"/>
    <path d="M580 470 C 720 470 760 380 780 260" fill="none" stroke="${N}" stroke-width="40" stroke-linecap="round"/>
    <rect x="740" y="160" width="80" height="140" rx="30" fill="${N}"/>`,

  'lavadora-pressao': `${shadow(420, 810, 280)}
    <rect x="200" y="300" width="330" height="480" rx="60" fill="${N}"/>
    <rect x="230" y="330" width="270" height="140" rx="36" fill="${N2}"/>
    <circle cx="365" cy="400" r="30" fill="${L}"/>
    <circle cx="280" cy="760" r="46" fill="${N3}"/><circle cx="450" cy="760" r="46" fill="${N3}"/>
    <path d="M530 620 C 640 620 660 520 700 440" fill="none" stroke="${N3}" stroke-width="22" stroke-linecap="round"/>
    <path d="M680 460 L 740 300 L 790 320 L 740 460 Z" fill="${N}"/>
    <rect x="735" y="160" width="26" height="170" rx="12" fill="${N}" transform="rotate(20 748 245)"/>`,

  'ferramenta-eletrica': `${shadow(500, 800, 300)}
    <circle cx="420" cy="560" r="220" fill="${G}" stroke="${G2}" stroke-width="10"/>
    <circle cx="420" cy="560" r="40" fill="${G2}"/>
    <path d="M300 400 C 300 330 360 300 440 300 H700 C 760 300 790 340 790 400 V470 C 790 510 760 530 720 530 H400 C 340 530 300 480 300 400 Z" fill="${N}"/>
    <rect x="650" y="330" width="100" height="30" rx="15" fill="${L}"/>
    <rect x="520" y="380" width="120" height="16" rx="8" fill="${N3}"/>`,

  'ferramenta-manual': `${shadow(500, 800, 260)}
    <g transform="rotate(-35 500 480)">
      <rect x="470" y="220" width="60" height="520" rx="26" fill="${N}"/>
      <path d="M440 170 a70 70 0 1 0 120 0 l-30 40 h-60 z" fill="${N}"/>
      <circle cx="500" cy="760" r="62" fill="none" stroke="${N}" stroke-width="30"/>
      <rect x="485" y="360" width="30" height="120" rx="15" fill="${L}"/>
    </g>
    <g transform="rotate(35 500 480)">
      <rect x="470" y="220" width="60" height="520" rx="26" fill="${N3}"/>
      <path d="M440 170 a70 70 0 1 0 120 0 l-30 40 h-60 z" fill="${N3}"/>
      <circle cx="500" cy="760" r="62" fill="none" stroke="${N3}" stroke-width="30"/>
    </g>`,

  cosmetico: `${shadow(500, 810, 250)}
    <rect x="300" y="300" width="220" height="500" rx="40" fill="${W}" stroke="${G2}" stroke-width="10"/>
    <rect x="370" y="220" width="80" height="90" rx="10" fill="${N}"/>
    <path d="M410 220 V170 H490" fill="none" stroke="${N}" stroke-width="24" stroke-linecap="round"/>
    <rect x="330" y="460" width="160" height="150" rx="16" fill="${N}"/>
    <rect x="350" y="490" width="80" height="16" rx="8" fill="${L}"/>
    <path d="M560 800 L 580 420 C 582 400 595 390 615 390 H665 C 685 390 698 400 700 420 L720 800 Z" fill="${G}" stroke="${G2}" stroke-width="10"/>
    <rect x="595" y="330" width="90" height="70" rx="10" fill="${N}"/>`,

  'escova-cabelo': `${shadow(500, 820, 170)}
    <rect x="440" y="470" width="120" height="340" rx="56" fill="${N}"/>
    <rect x="470" y="560" width="60" height="30" rx="15" fill="${L}"/>
    <rect x="420" y="150" width="160" height="340" rx="80" fill="${N3}"/>
    <g fill="${G2}">${Array.from({ length: 6 }, (_, r) => [430, 470, 510, 550].map((x, i) => `<circle cx="${x + (r % 2) * 20}" cy="${200 + r * 48}" r="${i % 3 === 0 ? 7 : 9}"/>`).join('')).join('')}</g>`,

  perfume: `${shadow(500, 810, 210)}
    <rect x="450" y="190" width="100" height="90" rx="14" fill="${N}"/>
    <rect x="470" y="270" width="60" height="50" fill="${G2}"/>
    <rect x="320" y="310" width="360" height="490" rx="60" fill="${G}" stroke="${G2}" stroke-width="10"/>
    <rect x="360" y="350" width="280" height="410" rx="40" fill="${W}" opacity=".6"/>
    <rect x="390" y="500" width="220" height="110" rx="14" fill="${N}"/>
    <rect x="420" y="540" width="110" height="16" rx="8" fill="${L}"/>`,

  suplemento: `${shadow(500, 820, 230)}
    <rect x="290" y="170" width="420" height="110" rx="24" fill="${N}"/>
    <rect x="300" y="270" width="400" height="540" rx="40" fill="${N}"/>
    <rect x="300" y="420" width="400" height="220" fill="${L}"/>
    <rect x="360" y="480" width="200" height="30" rx="15" fill="${N}"/>
    <rect x="360" y="540" width="130" height="22" rx="11" fill="${N}" opacity=".6"/>`,

  chinelo: `${shadow(500, 830, 280)}
    <g transform="rotate(-8 390 480)">
      <path d="M390 150 C 470 150 500 230 495 330 C 490 420 470 470 475 560 C 480 690 460 800 385 800 C 310 800 290 690 295 560 C 300 470 280 420 285 330 C 280 230 310 150 390 150 Z" fill="${N}"/>
      <path d="M390 250 L 305 420 M390 250 L 475 420" stroke="${L}" stroke-width="26" stroke-linecap="round"/>
      <circle cx="390" cy="250" r="16" fill="${W}"/>
    </g>
    <g transform="rotate(8 610 480)">
      <path d="M610 150 C 690 150 720 230 715 330 C 710 420 690 470 695 560 C 700 690 680 800 605 800 C 530 800 510 690 515 560 C 520 470 500 420 505 330 C 500 230 530 150 610 150 Z" fill="${N3}"/>
      <path d="M610 250 L 525 420 M610 250 L 695 420" stroke="${L}" stroke-width="26" stroke-linecap="round"/>
      <circle cx="610" cy="250" r="16" fill="${W}"/>
    </g>`,

  produto: `${shadow(500, 800, 280)}
    <path d="M500 190 L780 320 L500 450 L220 320 Z" fill="${N3}"/>
    <path d="M220 320 L500 450 V790 L220 660 Z" fill="${N}"/>
    <path d="M780 320 L500 450 V790 L780 660 Z" fill="${N2}"/>
    <path d="M360 255 L640 385 V470 L600 450 V400 L320 270 Z" fill="${L}"/>`,
};

function svg(key) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
  <rect width="1000" height="1000" fill="#FFFFFF"/>
  <g transform="translate(0 -20)">${DRAWINGS[key]}</g>
  <text x="500" y="945" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="600" fill="#8A94A1" letter-spacing="1">Imagem ilustrativa</text>
</svg>`;
}

const pwDir = process.argv[2];
const require = createRequire(pwDir ? path.join(pwDir, 'package.json') : import.meta.url);
const { chromium } = require('playwright');

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
for (const key of Object.keys(DRAWINGS)) {
  await page.setContent(`<html><body style="margin:0">${svg(key)}</body></html>`);
  await page.screenshot({ path: path.join(OUT, `${key}.png`), clip: { x: 0, y: 0, width: 1000, height: 1000 } });
  console.log('ok', key);
}
await browser.close();
