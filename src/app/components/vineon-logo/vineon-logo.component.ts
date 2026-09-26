import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Logo oficial da Vineon em SVG inline, na cor lima da marca.
 *
 * `variant="horizontal"` é a bolsa + "ineon"; `variant="symbol"` é só a bolsa.
 * A versão animada (splash) fica no index.html, não aqui.
 *
 * O desenho é o da logo fixa do design (`vineon-logo-fixa`, "ineon" em traço),
 * o mesmo da splash animada. Só paths, sem fonte; a cor vem de `currentColor`
 * (lima por padrão; para fundo claro, basta `color: #0B1623`). Proporção 460 × 142.
 */
@Component({
  selector: 'app-vineon-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': '"Vineon"' },
  template: `
    <svg [attr.viewBox]="variant() === 'horizontal' ? '33 22 460 142' : '38 30 122 126'" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path stroke-width="4.2" d="M66 64.5L57.5 67.6Q53 69.3 52.4 74L43.6 133.5Q43 138 47 140.2L70.5 150.8" />
        <path stroke-width="4.2" d="M145.5 76L143.2 64.8Q142.3 60.2 137.5 60.4L70.5 63.8Q65.6 64.1 65.9 69L70.2 145.5Q70.6 150.6 75.6 149.7L139.5 138.8Q145 137.8 145.3 131.5" />
        <path stroke-width="4.2" d="M47.5 137L57.5 135.4" />
        <path stroke-width="4.2" d="M75 63.5V56C75 44 86 35.5 99 35.5C112 35.5 122.5 44 122.5 56V61.2" />
        <path stroke-width="3.4" d="M88 62.9V57C88 47 93.5 41 100 41C106 41 111.5 46.5 112.8 55" />
      </g>
      <path d="M70 78.5L88 78.5Q96 78.5 100 86L117 120Q118.7 123.4 120.5 121L133.9 97C135.4 94.4 137.8 93 141 93L148 93L145.2 98L142 98C141.2 98 140.5 98.7 140 99.6L124 128C121.6 132.7 118.4 135.5 114.5 135.5C110.6 135.5 107.2 132.8 105 128.6L89 97C86.5 92 83 89 78.5 86.5C74.5 84.3 71.5 81.5 70 78.5Z" fill="currentColor" />
      <path d="M115.9 110L122.8 110L134.3 90C135.6 87.7 137.8 86.5 141 86.5L152 86.5L155 81L138.5 81C134.8 81 131.8 82.5 129.8 86Z" fill="currentColor" />
      @if (variant() === 'horizontal') {
        <circle cx="175.7" cy="77.5" r="5.2" fill="currentColor" />
        <g fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round">
          <path d="M175.7 91.5V131" />
          <path d="M194.2 131V110A18.5 18.5 0 0 1 212.7 91.5H232.5A18.5 18.5 0 0 1 251 110V131" />
          <path d="M270.4 111H327.1V110A18.5 18.5 0 0 0 308.6 91.5H288.9A18.5 18.5 0 0 0 270.4 110V112.5A18.5 18.5 0 0 0 288.9 131H331.5" />
          <path stroke-linecap="round" d="M348.5 110A18.5 18.5 0 0 1 367 91.5H386.8A18.5 18.5 0 0 1 405.3 110V112.5A18.5 18.5 0 0 1 386.8 131H367A18.5 18.5 0 0 1 348.5 112.5Z" />
          <path d="M426.7 131V110A18.5 18.5 0 0 1 445.2 91.5H465A18.5 18.5 0 0 1 483.5 110V131" />
        </g>
      }
    </svg>
  `,
  styles: [`
    :host { display: block; color: #D8F51F; }
    svg { display: block; width: 100%; height: 100%; overflow: visible; }
  `],
})
export class VineonLogoComponent {
  readonly variant = input<'horizontal' | 'symbol'>('horizontal');
}
