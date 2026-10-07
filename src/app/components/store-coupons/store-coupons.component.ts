import { Component, Input, inject } from '@angular/core';
import { IonIcon, ToastController } from '@ionic/angular/standalone';

import { couponHeadline, couponShortRule } from '../../core/coupons';
import { Coupon } from '../../interfaces/coupon';

/**
 * Selos "Cupom da loja" abaixo do preço, na página do produto. Tocar copia o
 * código; ele é aplicado no checkout. O ícone vem por nome de `/svg/` (sem
 * `addIcons`, para não puxar SVG para o bundle inicial).
 */
@Component({
  selector: 'app-store-coupons',
  standalone: true,
  imports: [IonIcon],
  template: `
    @if (coupons.length) {
      <div class="sc" aria-label="Cupons da loja">
        @for (c of coupons; track c.code) {
          <button type="button" class="sc-item" (click)="copy(c)" [attr.aria-label]="'Copiar cupom ' + c.code + ': ' + headline(c)">
            <ion-icon name="ticket-outline" aria-hidden="true"></ion-icon>
            <span class="sc-text">
              <strong>Cupom da loja: {{ headline(c) }}</strong>
              @if (rule(c)) { <small>{{ rule(c) }}</small> }
            </span>
            <span class="sc-code">{{ c.code }}</span>
          </button>
        }
      </div>
    }
  `,
  styles: [`
    .sc { display: grid; gap: 6px; margin: 12px 0 4px; }
    .sc-item {
      display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px;
      border: 1.5px dashed #0B1623; border-radius: 10px; background: rgba(216, 245, 31, 0.22);
      color: #0B1623; font: inherit; text-align: left; cursor: pointer;
    }
    .sc-item ion-icon { flex-shrink: 0; font-size: 20px; }
    .sc-text { display: grid; min-width: 0; flex: 1; }
    .sc-text strong { font-size: 14px; font-weight: 800; }
    .sc-text small { font-size: 12px; color: #3A4452; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sc-code {
      flex-shrink: 0; padding: 4px 8px; border-radius: 6px; background: #D8F51F;
      font-size: 12.5px; font-weight: 800; letter-spacing: 0.06em;
    }
  `],
})
export class StoreCouponsComponent {
  @Input() coupons: Coupon[] = [];

  private readonly toastCtrl = inject(ToastController);

  headline(c: Coupon): string {
    return couponHeadline(c);
  }

  /** Só as condições (o desconto já está no título). */
  rule(c: Coupon): string {
    return couponShortRule(c).split(' · ').slice(1).join(' · ');
  }

  async copy(c: Coupon) {
    let message = `Cupom ${c.code} copiado. Aplique no checkout, na etapa Entrega.`;
    try {
      await navigator.clipboard.writeText(c.code);
    } catch {
      message = `Use o cupom ${c.code} no checkout, na etapa Entrega.`;
    }
    const toast = await this.toastCtrl.create({ message, duration: 2800, position: 'top' });
    await toast.present();
  }
}
