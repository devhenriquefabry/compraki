import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let maskSeq = 0;

/**
 * Logo oficial da Vineon em SVG inline, na cor lima da marca.
 *
 * `variant="horizontal"` é a bolsa + "ineon"; `variant="symbol"` é só a bolsa.
 * Com `animated`, a bolsa se desenha (traços, depois o V por máscara, depois as
 * faixas) e o "ineon" sobe — é a animação da splash, ~1,8 s no total.
 *
 * O "ineon" já vem em contornos, extraídos da fonte oficial que estava embutida
 * no SVG da marca: não depende de fonte carregada.
 */
@Component({
  selector: 'app-vineon-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': '"Vineon"' },
  template: `
    <svg [attr.viewBox]="variant() === 'horizontal' ? '33 22 419.62 142' : '38 30 122 126'"
         [class.anim]="animated()" aria-hidden="true">
      @if (animated()) {
        <defs>
          <mask [attr.id]="maskId" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="260">
            <path class="v-mask" d="M68 80C83 80 91 84 95 91L115 129L137 95L152 95"
                  fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
          </mask>
        </defs>
      }
      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path class="s s1" stroke-width="5.5" pathLength="1" d="M66 64.5L57.5 67.6Q53 69.3 52.4 74L43.6 133.5Q43 138 47 140.2L70.5 150.8" />
        <path class="s s2" stroke-width="5.5" pathLength="1" d="M145.5 76L143.2 64.8Q142.3 60.2 137.5 60.4L70.5 63.8Q65.6 64.1 65.9 69L70.2 145.5Q70.6 150.6 75.6 149.7L139.5 138.8Q145 137.8 145.3 131.5" />
        <path class="s s3" stroke-width="5.5" pathLength="1" d="M47.5 137L57.5 135.4" />
        <path class="s s4" stroke-width="5.5" pathLength="1" d="M75 63.5V56C75 44 86 35.5 99 35.5C112 35.5 122.5 44 122.5 56V61.2" />
        <path class="s s5" stroke-width="4" pathLength="1" d="M88 62.9V57C88 47 93.5 41 100 41C106 41 111.5 46.5 112.8 55" />
      </g>
      <path fill="currentColor" [attr.mask]="animated() ? 'url(#' + maskId + ')' : null"
            d="M70 78.5L88 78.5Q96 78.5 100 86L117 120Q118.7 123.4 120.5 121L133.9 97C135.4 94.4 137.8 93 141 93L148 93L145.2 98L142 98C141.2 98 140.5 98.7 140 99.6L124 128C121.6 132.7 118.4 135.5 114.5 135.5C110.6 135.5 107.2 132.8 105 128.6L89 97C86.5 92 83 89 78.5 86.5C74.5 84.3 71.5 81.5 70 78.5Z" />
      <path class="stripe" fill="currentColor"
            d="M115.9 110L122.8 110L134.3 90C135.6 87.7 137.8 86.5 141 86.5L152 86.5L155 81L138.5 81C134.8 81 131.8 82.5 129.8 86Z" />
      @if (variant() === 'horizontal') {
        <g class="word" fill="currentColor">
          <path d="M177.07 80.38H165.57V69.98H177.07ZM177.07 138H165.57V90.19H177.07Z" />
          <path d="M243.78 138H232.28V111.47Q232.28 109.21 231.5 107.42Q230.73 105.63 229.4 104.35Q228.08 103.06 226.28 102.38Q224.49 101.69 222.42 101.69H202.29V138H190.8V95.9Q190.8 94.71 191.24 93.67Q191.68 92.63 192.48 91.85Q193.27 91.08 194.33 90.64Q195.39 90.19 196.59 90.19H222.5Q224.67 90.19 227.08 90.68Q229.49 91.17 231.86 92.25Q234.22 93.33 236.37 94.99Q238.51 96.65 240.17 99.02Q241.83 101.38 242.8 104.48Q243.78 107.57 243.78 111.47Z" />
          <path d="M308.01 106.03Q308.01 108.41 307.17 111.18Q306.33 113.94 304.45 116.31Q302.57 118.67 299.54 120.27Q296.51 121.86 292.18 121.86H271.43V110.94H292.18Q294.52 110.94 295.8 109.5Q297.08 108.06 297.08 105.94Q297.08 103.68 295.65 102.4Q294.21 101.12 292.18 101.12H271.43Q269.09 101.12 267.81 102.55Q266.53 103.99 266.53 106.11V122.17Q266.53 124.47 267.96 125.75Q269.4 127.03 271.52 127.03H292.18V138H271.43Q269.05 138 266.28 137.16Q263.52 136.32 261.15 134.44Q258.79 132.56 257.19 129.53Q255.6 126.5 255.6 122.17V106.03Q255.6 103.64 256.44 100.87Q257.28 98.11 259.16 95.74Q261.04 93.38 264.07 91.79Q267.1 90.19 271.43 90.19H292.18Q294.56 90.19 297.33 91.03Q300.09 91.87 302.46 93.75Q304.82 95.63 306.42 98.66Q308.01 101.69 308.01 106.03Z" />
          <path d="M370.47 121.86Q370.47 124.82 369.72 127.19Q368.97 129.55 367.73 131.34Q366.49 133.14 364.86 134.4Q363.22 135.66 361.43 136.45Q359.64 137.25 357.8 137.62Q355.97 138 354.33 138H333.59Q331.2 138 328.37 137.16Q325.54 136.32 323.13 134.4Q320.72 132.47 319.11 129.4Q317.49 126.32 317.49 121.86V106.29Q317.49 101.87 319.11 98.8Q320.72 95.72 323.13 93.8Q325.54 91.87 328.37 91.03Q331.2 90.19 333.59 90.19H354.33Q358.75 90.19 361.85 91.79Q364.94 93.38 366.85 95.79Q368.75 98.2 369.61 101.03Q370.47 103.86 370.47 106.29ZM358.97 106.38Q358.97 103.99 357.78 102.84Q356.59 101.69 354.33 101.69H333.68Q331.38 101.69 330.18 102.86Q328.99 104.04 328.99 106.29V121.86Q328.99 124.11 330.18 125.31Q331.38 126.5 333.68 126.5H354.33Q356.67 126.5 357.82 125.31Q358.97 124.11 358.97 121.86Z" />
          <path d="M435.94 138H424.44V111.47Q424.44 109.21 423.66 107.42Q422.89 105.63 421.56 104.35Q420.24 103.06 418.44 102.38Q416.65 101.69 414.58 101.69H394.45V138H382.96V95.9Q382.96 94.71 383.4 93.67Q383.84 92.63 384.64 91.85Q385.43 91.08 386.49 90.64Q387.55 90.19 388.75 90.19H414.66Q416.83 90.19 419.24 90.68Q421.65 91.17 424.02 92.25Q426.38 93.33 428.53 94.99Q430.67 96.65 432.33 99.02Q433.99 101.38 434.96 104.48Q435.94 107.57 435.94 111.47Z" />
        </g>
      }
    </svg>
  `,
  styles: [`
    :host { display: block; color: #D8F51F; }
    svg { display: block; width: 100%; height: 100%; overflow: visible; }

    .anim .s { stroke-dasharray: 1; stroke-dashoffset: 1; animation: vn-draw .8s cubic-bezier(.65,0,.25,1) forwards; }
    .anim .s2 { animation-delay: .15s; }
    .anim .s3 { animation-delay: .55s; }
    .anim .s4 { animation-delay: .45s; }
    .anim .s5 { animation-delay: .6s; }
    .anim .v-mask { stroke-dasharray: 1; stroke-dashoffset: 1; animation: vn-draw .6s .75s ease-out forwards; }
    .anim .stripe { opacity: 0; animation: vn-fade .4s 1.25s forwards; }
    .anim .word { opacity: 0; animation: vn-rise .7s 1.1s cubic-bezier(.2,.8,.2,1) forwards; }

    @keyframes vn-draw { to { stroke-dashoffset: 0; } }
    @keyframes vn-fade { to { opacity: 1; } }
    @keyframes vn-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

    @media (prefers-reduced-motion: reduce) {
      .anim .s, .anim .v-mask { animation-duration: .01s; animation-delay: 0s; }
      .anim .stripe, .anim .word { animation-duration: .2s; animation-delay: 0s; }
    }
  `],
})
export class VineonLogoComponent {
  readonly variant = input<'horizontal' | 'symbol'>('horizontal');
  readonly animated = input(false);

  /** Cada instância precisa de um id de máscara próprio (há duas logos na tela durante a transição). */
  readonly maskId = `vn-logo-mask-${++maskSeq}`;
}
