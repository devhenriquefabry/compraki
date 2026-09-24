import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from '../../interfaces/product';
import { ProductSelectionService } from '../../services/product-selection-service';
import { AppConfigService } from '../../services/app-config.service';
import { discountPercent, hasDiscount, hasFreeShipping, installmentHint, priceMain } from '../../core/product-pricing';

const PLACEHOLDER_IMAGE = 'assets/imagens/imagem-placeholder.png';

const BRL_INTEGER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/**
 * Card de produto da vitrine de desktop.
 *
 * É um link de verdade (`<a routerLink>`): no computador a pessoa espera poder
 * abrir o produto em outra aba com o botão do meio ou Ctrl+clique.
 */
@Component({
  selector: 'app-storefront-card',
  templateUrl: './storefront-card.component.html',
  styleUrls: ['./storefront-card.component.scss'],
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorefrontCardComponent {
  readonly product = input.required<Product>();

  private readonly selection = inject(ProductSelectionService);
  private readonly appConfig = inject(AppConfigService);

  readonly view = computed(() => {
    const product = this.product();
    const price = priceMain(product);
    // Arredonda em centavos antes de separar: 9.999 vira R$ 10, não "R$ 9,100".
    const totalCents = Math.round(price * 100);
    const cents = totalCents % 100;

    return {
      photo: product.photoURL?.[0] || PLACEHOLDER_IMAGE,
      reais: BRL_INTEGER.format(Math.trunc(totalCents / 100)),
      // Como no Mercado Livre: centavo zerado não aparece.
      cents: cents > 0 ? String(cents).padStart(2, '0') : null,
      fullPrice: price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      oldPrice: hasDiscount(product)
        ? product.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : null,
      off: discountPercent(product),
      installment: installmentHint(product),
      freeShipping: hasFreeShipping(product, this.appConfig.freeShippingRule()),
      express: product.shipping === 'Entrega Expressa',
      used: !!product.condition && product.condition !== 'novo',
    };
  });

  select() {
    this.selection.setSelectedProduct(this.product());
  }
}
