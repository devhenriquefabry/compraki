import { Component, OnInit, inject, Input } from '@angular/core';
import { IonicModule, LoadingController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { MelhorEnvioService } from 'src/app/services/melhor-envio.service';
import { CheckoutStateService } from 'src/app/services/checkout-state.service';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { ShippingQuote, MelhorEnvioConfig } from 'src/app/interfaces/shipping';
import { CartItem } from 'src/app/interfaces/cart-item';

@Component({
  selector: 'app-checkout-shipping',
  templateUrl: './checkout-shipping.component.html',
  styleUrls: ['./checkout-shipping.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class CheckoutShippingComponent implements OnInit {
  @Input() readOnly: boolean = false;


  private melhorEnvioService = inject(MelhorEnvioService);
  private stateService = inject(CheckoutStateService);
  private cartService = inject(FirebaseCartService);
  private loadingCtrl = inject(LoadingController);

  public quotes: ShippingQuote[] = [];
  public isLoading: boolean = true;
  public error: string | null = null;
  public selectedServiceId: number | null = null;

  constructor() { }

  ngOnInit() {
    this.loadShippingQuotes();
  }

  async loadShippingQuotes() {
    this.isLoading = true;
    this.error = null;

    const zipTo = this.stateService.addressData.postalCode.replace(/\D/g, '');
    if (zipTo.length !== 8) {
      this.error = 'CEP de destino inválido no endereço selecionado.';
      this.isLoading = false;
      return;
    }

    // Pega itens do carrinho
    this.cartService.getAllCartItems().subscribe({
      next: (items: CartItem[]) => {
        if (items.length === 0) {
          this.error = 'Carrinho vazio.';
          this.isLoading = false;
          return;
        }

        // Pega configuração do Melhor Envio
        this.melhorEnvioService.getConfig().subscribe({
          next: (config: MelhorEnvioConfig | null) => {
            if (!config || !config.accessToken) {
              this.error = 'Configuração do Melhor Envio não encontrada.';
              this.isLoading = false;
              return;
            }

            // Mapeia itens para o formato da API
            const products = items.map(item => ({
              id: item.productId,
              width: item.productData.width || 10,
              height: item.productData.height || 10,
              length: item.productData.length || 15,
              weight: item.productData.weight || 0.1,
              price: item.productData.priceDiscounted || item.productData.price,
              quantity: item.quantity
            }));

            this.melhorEnvioService.getQuotes(config, zipTo, products).subscribe({
              next: (quotes) => {
                this.quotes = quotes;
                this.isLoading = false;
                
                // Se já houver um selecionado, mantém
                if (this.stateService.shippingData.serviceId) {
                  this.selectedServiceId = this.stateService.shippingData.serviceId;
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
    });
  }

  selectQuote(quote: ShippingQuote) {
    this.selectedServiceId = quote.id;
    this.stateService.shippingData = {
      serviceId: quote.id,
      serviceName: `${quote.company.name} - ${quote.name}`,
      price: quote.price,
      deliveryTime: quote.delivery_time
    };
  }

  formatPrice(price: number): string {
    return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
