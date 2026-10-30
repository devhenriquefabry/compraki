import { Component, OnDestroy, OnInit, inject, Input } from '@angular/core';
import { Subscription, firstValueFrom, take } from 'rxjs';
import { AddressService } from 'src/app/services/address.service';
import { IonicModule, LoadingController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { MelhorEnvioService } from 'src/app/services/melhor-envio.service';
import { CheckoutStateService } from 'src/app/services/checkout-state.service';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { ShippingQuote } from 'src/app/interfaces/shipping';
import { CartItem } from 'src/app/interfaces/cart-item';
import { AppConfigService } from 'src/app/services/app-config.service';
import { hasFreeShipping } from 'src/app/core/product-pricing';
import { DeliveryPlan, LOCAL_DELIVERY_SERVICE, planDelivery } from 'src/app/core/local-delivery';
import { FirebaseProducts } from 'src/app/services/firebase-products';

@Component({
  selector: 'app-checkout-shipping',
  templateUrl: './checkout-shipping.component.html',
  styleUrls: ['./checkout-shipping.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class CheckoutShippingComponent implements OnInit, OnDestroy {
  @Input() readOnly: boolean = false;


  private melhorEnvioService = inject(MelhorEnvioService);
  private stateService = inject(CheckoutStateService);
  private cartService = inject(FirebaseCartService);
  private loadingCtrl = inject(LoadingController);
  private appConfig = inject(AppConfigService);
  private productsService = inject(FirebaseProducts);

  public quotes: ShippingQuote[] = [];
  public isLoading: boolean = true;
  public error: string | null = null;
  public selectedServiceId: number | null = null;
  /**
   * Entrega da própria loja (todos os itens entregues pela loja na cidade do
   * endereço): grátis, sem transportadora. Ver core/local-delivery.ts.
   */
  public local: DeliveryPlan['local'] = null;
  /** Logo da transportadora que não carregou: mostra um ícone no lugar. */
  public brokenLogos: Record<number, boolean> = {};
  private items: CartItem[] = [];
  private quotedZip = '';
  private addressSub?: Subscription;
  private cartSub?: Subscription;
  private addressService = inject(AddressService);

  constructor() { }

  ngOnInit() {
    // O endereço chega depois (o `app-checkout-address`, acima, escolhe o
    // padrão quando a lista carrega). Cota quando ele chegar e de novo se o CEP
    // mudar — antes cotava na hora com um CEP de exemplo de São Paulo.
    this.addressSub = this.addressService.addresses$.subscribe(() => {
      const zip = String(this.stateService.addressData?.postalCode || '').replace(/\D/g, '');
      if (zip === this.quotedZip) return;
      if (zip.length !== 8) {
        if (this.addressService.isLoaded()) {
          this.error = 'Cadastre um endereço de entrega para ver o frete.';
          this.isLoading = false;
        }
        return;
      }
      this.quotedZip = zip;
      void this.loadShippingQuotes();
    });
  }

  ngOnDestroy() {
    this.addressSub?.unsubscribe();
    this.cartSub?.unsubscribe();
  }

  async loadShippingQuotes() {
    this.isLoading = true;
    this.error = null;
    this.local = null;

    const zipTo = String(this.stateService.addressData?.postalCode || '').replace(/\D/g, '');
    if (zipTo.length !== 8) {
      this.error = 'Cadastre um endereço de entrega para ver o frete.';
      this.isLoading = false;
      return;
    }

    // Pega itens do carrinho (uma inscrição por cotação)
    this.cartSub?.unsubscribe();
    this.cartSub = this.cartService.getAllCartItems().pipe(take(1)).subscribe({
      next: async (items: CartItem[]) => {
        this.items = items;
        if (items.length === 0) {
          this.error = 'Carrinho vazio.';
          this.isLoading = false;
          return;
        }

        // Entrega da loja: lê a configuração de AGORA no anúncio (o carrinho
        // guarda um retrato de quando o item entrou). O servidor confere de novo.
        const plan = planDelivery(await this.deliveryLines(items), this.stateService.addressData?.city || '', this.stateService.addressData?.state || '');
        if (plan.blocked) {
          this.quotes = [];
          this.clearSelection();
          this.error = plan.blocked;
          this.isLoading = false;
          return;
        }
        if (plan.local) {
          this.quotes = [];
          this.local = plan.local;
          this.selectLocal();
          this.isLoading = false;
          return;
        }
        // Era entrega da loja e o endereço mudou: escolhe de novo entre as cotações.
        if (this.stateService.shippingData?.serviceId === LOCAL_DELIVERY_SERVICE) this.clearSelection();

        // A cotação é feita pela Cloud Function `calculateMelhorEnvioShipping`,
        // que lê a configuração (token e CEP de origem) no servidor. O app não
        // lê `settings/melhor_envio`: as regras fecham essa coleção desde a
        // Fase 0 — ler daqui travava a tela em "carregando" para sempre.
        const products = items.map(item => ({
          id: item.productId,
          width: item.productData.width || 10,
          height: item.productData.height || 10,
          length: item.productData.length || 15,
          weight: item.productData.weight || 0.1,
          price: item.productData.priceDiscounted || item.productData.price,
          quantity: item.quantity
        }));

        this.melhorEnvioService.getQuotes(null, zipTo, products).subscribe({
          next: (quotes) => {
            this.quotes = quotes;
            this.isLoading = false;
            if (!quotes.length) this.error = 'Nenhuma forma de entrega disponível para este CEP.';

            // Se já houver um selecionado, mantém
            const previous = quotes.find(q => q.id === this.stateService.shippingData.serviceId);
            if (previous) {
              // Reaplica: a regra de frete grátis pode ter mudado desde a escolha.
              this.selectQuote(previous);
            } else if (quotes.length > 0) {
              // Seleciona o primeiro por padrão (ou o mais barato)
              this.selectQuote(quotes[0]);
            }
          },
          error: (err) => {
            console.error('Erro ao buscar cotações:', err);
            this.error = 'Falha ao consultar frete. Verifique sua conexão.';
            this.isLoading = false;
          }
        });
      }
    });
  }

  private async deliveryLines(items: CartItem[]) {
    const ids = [...new Set(items.map(item => item.productId || item.productData?.id || '').filter(Boolean))];
    const products = new Map(await Promise.all(ids.map(async id =>
      [id, await firstValueFrom(this.productsService.getById(id)).catch(() => null)] as const)));
    return items.map(item => {
      const product = products.get(item.productId || item.productData?.id || '');
      return {
        name: item.productData?.name || 'Produto',
        sellerId: item.productData?.sellerId || '',
        localDelivery: product ? product.localDelivery : item.productData?.localDelivery,
      };
    });
  }

  selectLocal() {
    if (!this.local) return;
    this.selectedServiceId = null;
    this.stateService.shippingData = {
      serviceId: LOCAL_DELIVERY_SERVICE,
      serviceName: 'Entrega da loja',
      price: 0,
      quotedPrice: 0,
      freeShipping: true,
      deliveryTime: this.local.days,
      localDelivery: true,
    };
  }

  /** Nenhuma entrega possível: o checkout não segue sem escolher de novo. */
  private clearSelection() {
    this.selectedServiceId = null;
    this.stateService.shippingData = { serviceId: null, serviceName: '', price: 0, quotedPrice: 0, freeShipping: false, deliveryTime: 0 };
  }

  /** "Chega no mesmo dia do pagamento" / "Chega em até 2 dias úteis depois do pagamento". */
  localEta(days: number): string {
    return days <= 0
      ? 'Chega no mesmo dia do pagamento'
      : `Chega em até ${days} ${days === 1 ? 'dia útil' : 'dias úteis'} depois do pagamento`;
  }

  /**
   * Frete grátis vale para o pedido quando TODOS os itens têm frete grátis
   * (do vendedor ou pela regra da loja). A cotação é uma só para o pacote
   * inteiro; com um item fora da regra, o frete é cobrado normalmente.
   */
  get freeShipping(): boolean {
    const rule = this.appConfig.freeShippingRule();
    return this.items.length > 0 && this.items.every(item => hasFreeShipping(item.productData, rule));
  }

  /** A lista já vem do mais barato para o mais caro (MelhorEnvioService.getQuotes). */
  get cheapestId(): number | null {
    return this.quotes[0]?.id ?? null;
  }

  /** Menor prazo; no empate, o mais barato (o primeiro da lista). */
  get fastestId(): number | null {
    const fastest = this.quotes.reduce<ShippingQuote | null>((best, q) => !best || q.delivery_time < best.delivery_time ? q : best, null);
    return fastest?.id ?? null;
  }

  /** O que o comprador paga por esta cotação. */
  priceFor(quote: ShippingQuote): number {
    return this.freeShipping ? 0 : quote.price;
  }

  selectQuote(quote: ShippingQuote) {
    this.selectedServiceId = quote.id;
    const free = this.freeShipping;
    this.stateService.shippingData = {
      serviceId: quote.id,
      serviceName: `${quote.company.name} - ${quote.name}`,
      price: free ? 0 : quote.price,
      // Custo real da etiqueta, para quem vai pagar o envio saber quanto é.
      quotedPrice: quote.price,
      freeShipping: free,
      deliveryTime: quote.delivery_time
    };
  }

  formatPrice(price: number): string {
    return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
