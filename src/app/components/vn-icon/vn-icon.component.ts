import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { VN_ICONS, VnIconName } from '../../core/vn-icons';

/**
 * Ícone do Vineon (ver `core/vn-icons.ts`). Tamanho em `font-size` (1em) e cor
 * em `color`, como texto: `<vn-icon name="bag" style="font-size: 22px" />`.
 */
@Component({
  selector: 'vn-icon',
  standalone: true,
  template: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path [attr.d]="d()" /></svg>`,
  styles: [`
    :host { display: inline-flex; width: 1em; height: 1em; flex: none; }
    svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-width: var(--vn-icon-stroke, 1.75);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VnIconComponent {
  readonly name = input.required<VnIconName>();
  readonly d = computed(() => VN_ICONS[this.name()]);
}
