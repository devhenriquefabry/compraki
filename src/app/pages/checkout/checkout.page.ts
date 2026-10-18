import { Component, inject, OnInit } from '@angular/core';
import { CartItem } from 'src/app/interfaces/cart-item';
import { AppUser } from 'src/app/interfaces/app-user';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { CheckoutStateService } from 'src/app/services/checkout-state.service';
import { LoadingController, AlertController, NavController, ToastController } from '@ionic/angular';
import { OrderRequestError, OrdersService, PlaceOrderInput, PlaceOrderResult } from 'src/app/services/orders.service';
import { getAuth } from 'firebase/auth';
import { Router } from '@angular/router';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { CouponReservation, CouponService } from 'src/app/services/coupon.service';
import { isValidCpf } from 'src/app/core/br-documents';

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
  standalone: false
})
export class CheckoutPage implements OnInit {

  public currentStep: number = 1;
  public cartItems: CartItem[] = [];
  /** Perfil do comprador logado, carregado em `autoFillUserData()`. */
  public appUser: AppUser | null = null;


  private cartService = inject(FirebaseCartService);
  private navCtrl = inject(NavController);
  private toastCtrl = inject(ToastController);
  private stateService = inject(CheckoutStateService);
  private loadingCtrl = inject(LoadingController);
  private alertCtrl = inject(AlertController);
  private ordersService = inject(OrdersService);
  private router = inject(Router);
  private usersService = inject(FirebaseUsersService);
  private couponService = inject(CouponService);

  constructor() { }

  ngOnInit() {
    this.cartService.getAllCartItems().subscribe(items => {
      this.cartItems = items;
    });

    // O carrinho guarda o preço de quando o item entrou; o pedido é cobrado
    // pelo preço de agora. Atualizar já na abertura faz a tela mostrar o
    // mesmo total que o servidor vai cobrar.
    void this.cartService.refreshPrices().catch(() => undefined);

    this.autoFillUserData();
  }

  async autoFillUserData() {
    const userAuth = getAuth().currentUser;
    if (userAuth) {
      const profile = await this.usersService.getUserById(userAuth.uid);
      this.appUser = profile;
      if (profile) {
        this.stateService.paymentData = {
          ...this.stateService.paymentData,
          buyerName: profile.displayName || this.stateService.paymentData.buyerName,
          buyerCpf: profile.cpf || this.stateService.paymentData.buyerCpf,
          buyerPhone: profile.phoneNumber || this.stateService.paymentData.buyerPhone
        };
      }
    }
  }

  async nextStep() {
    const problem = this.stepProblem(this.currentStep);
    if (problem) {
      await this.showToast(problem);
      return;
    }
    if (this.currentStep < 4) {
      this.currentStep++;
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
    } else {
      this.navCtrl.back();
    }
  }

  /** O que impede de sair da etapa (vazio = pode seguir). */
  private stepProblem(step: number): string {
    const address = this.stateService.addressData;
    const data = this.stateService.paymentData;
    switch (step) {
      case 1:
        return this.cartItems.length ? '' : 'Seu carrinho está vazio.';
      case 2:
        if (!address?.street || String(address?.postalCode || '').replace(/\D/g, '').length !== 8) {
          return 'Cadastre um endereço de entrega para continuar.';
        }
        return this.stateService.shippingData?.serviceId ? '' : 'Escolha a forma de entrega.';
      case 3: {
        if (String(data.buyerName || '').trim().length < 3) return 'Informe o nome completo de quem compra.';
        if (!isValidCpf(String(data.buyerCpf || ''))) return 'CPF inválido. Confira os 11 números.';
        const phone = String(data.buyerPhone || '').replace(/\D/g, '');
        if (phone.length < 10 || phone.length > 11) return 'Informe um celular com DDD.';
        return data.method ? '' : 'Escolha a forma de pagamento.';
      }
      default:
        return '';
    }
  }

  /** Produtos + frete, sem cupom. */
  get grossTotal(): number {
    const productsTotal = this.cartItems.reduce((acc, item) => {
      const p = item.productData.priceDiscounted
        ? Math.min(item.productData.price, item.productData.priceDiscounted)
        : item.productData.price;
      return acc + (p * item.quantity);
    }, 0);

    const shippingTotal = this.stateService.shippingData?.price || 0;
    return productsTotal + shippingTotal;
  }

  /** O que a pessoa paga: com o desconto do cupom aplicado. */
  get cartTotal(): number {
    return Math.round((this.grossTotal - this.stateService.couponDiscount()) * 100) / 100;
  }

  async finishOrder() {
    for (const step of [1, 2, 3]) {
      const problem = this.stepProblem(step);
      if (problem) {
        this.currentStep = step;
        await this.showToast(problem);
        return;
      }
    }

    const loading = await this.loadingCtrl.create({
      message: 'Processando pagamento...',
    });
    await loading.present();

    // Cupom: reservado no servidor ANTES de cobrar. Se algo falhar depois
    // disso, a reserva é devolvida no `catch`.
    let reservation: CouponReservation | null = null;
    let orderSaved = false;

    try {
      const data = this.stateService.paymentData;
      const address = this.stateService.addressData;

      const applied = this.stateService.coupon();
      if (applied) {
        reservation = await this.couponService.reserve(applied.code, this.cartItems, this.stateService.shippingData?.price || 0);
        // O preço de algum produto mudou desde o cálculo: mostra o novo desconto
        // antes de cobrar, em vez de cobrar um total que a pessoa não viu.
        if (Math.abs(reservation.quote.discount - applied.quote.discount) > 0.009) {
          this.stateService.coupon.set({ ...applied, quote: reservation.quote });
          throw new Error(`O desconto do cupom ${applied.code} mudou para ${reservation.quote.discount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} porque o preço de um produto mudou. Confira o total e finalize de novo.`);
        }
      }

      const expectedTotal = Math.round((this.grossTotal - (reservation?.quote.discount ?? 0)) * 100) / 100;
      if (expectedTotal <= 0) throw new Error('Carrinho vazio ou valor inválido.');

      let card: PlaceOrderInput['card'];
      if (data.method === 'CREDIT_CARD') {
        const [month, year] = String(data.cardData.expiry || '').split('/');
        card = {
          holderName: data.cardData.holderName,
          number: String(data.cardData.number || '').replace(/\D/g, ''),
          expiryMonth: month || '',
          expiryYear: year ? `20${year}` : '',
          ccv: data.cardData.ccv,
        };
      }

      // O servidor calcula preço, frete e cupom, emite a cobrança com esse
      // total e grava o pedido. Daqui só sai O QUE comprar, nunca quanto custa.
      const result = await this.ordersService.placeOrder({
        items: this.cartItems.map(item => ({
          productId: item.productId || item.productData?.id || '',
          skuId: item.skuId || null,
          quantity: item.quantity,
        })),
        shippingServiceId: Number(this.stateService.shippingData.serviceId),
        address: {
          street: address.street,
          number: address.addressNumber,
          complement: address.complement,
          neighborhood: address.neighborhood,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
        },
        buyer: { name: data.buyerName, cpf: data.buyerCpf, phone: data.buyerPhone },
        method: data.method,
        couponRedemptionId: reservation?.redemptionId ?? null,
        card,
        expectedTotal,
      });
      orderSaved = true;
      this.stateService.coupon.set(null);
      await loading.dismiss();
      await this.afterOrder(result);
    } catch (e: any) {
      await loading.dismiss();
      if (reservation && !orderSaved) void this.couponService.release(reservation.redemptionId);
      console.error(e);
      await this.explainFailure(e);
    }
  }

  /** Para onde vai cada forma de pagamento depois do pedido criado. */
  private async afterOrder(result: PlaceOrderResult) {
    if (result.method === 'PIX') {
      // A tela de PIX lê o código do próprio pedido e acompanha o status.
      this.router.navigate(['/pix-payment'], { queryParams: { orderId: result.orderId } });
      return;
    }
    if (result.method === 'BOLETO') {
      if (result.charge) await this.showBoletoAlert(result.charge);
      await this.cartService.clearCart();
      this.navCtrl.navigateRoot('/tabs/tab2');
      return;
    }
    // Cartão: o pedido segue PENDING. Quem confirma o pagamento é o webhook do
    // Asaas (servidor); para cartão aprovado ele chega em segundos.
    const approved = ['CONFIRMED', 'RECEIVED'].includes(String(result.cardStatus));
    await this.showSuccessAlert(
      approved ? 'Sucesso!' : 'Pagamento em análise',
      approved
        ? 'Compra em Cartão de Crédito aprovada!'
        : 'Recebemos seu pagamento e ele está em análise. Você será avisado assim que for confirmado.'
    );
    await this.cartService.clearCart();
    this.navCtrl.navigateRoot('/tabs/tab2');
  }

  private async explainFailure(e: any) {
    if (e instanceof OrderRequestError) {
      // Preço, frete ou estoque mudaram: atualiza o carrinho e mostra o total novo.
      if (e.reason === 'TOTAL_CHANGED') {
        await this.cartService.refreshPrices().catch(() => undefined);
        if (this.stateService.coupon()) this.stateService.coupon.set(null);
        const alert = await this.alertCtrl.create({ header: 'O total mudou', message: e.message, buttons: ['Conferir'] });
        await alert.present();
        return;
      }
      if (e.reason === 'COUPON_STALE' || e.reason === 'COUPON_EXPIRED') this.stateService.coupon.set(null);
      if (e.reason === 'SHIPPING_UNAVAILABLE') this.currentStep = 2;
    }
    await this.showToast(e?.message || 'Falha ao processar pagamento.', 5000);
  }

  private async showToast(message: string, duration = 3500) {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      color: 'danger',
      position: 'top'
    });
    await toast.present();
  }

  /** Boleto do Cora: linha digitável em texto e o PDF num botão. */
  private async showBoletoAlert(charge: NonNullable<PlaceOrderResult['charge']>) {
    const buttons: any[] = [];
    if (charge.digitableLine) {
      buttons.push({
        text: 'Copiar linha',
        handler: () => {
          navigator.clipboard.writeText(charge.digitableLine!).catch(() => undefined);
        }
      });
    }
    if (charge.bankSlipUrl) {
      buttons.push({
        text: 'Abrir boleto',
        handler: () => {
          window.open(charge.bankSlipUrl!, '_blank', 'noopener');
        }
      });
    }
    buttons.push({ text: 'OK', role: 'cancel' });

    const alert = await this.alertCtrl.create({
      header: charge.sandbox ? 'Boleto gerado (teste)' : 'Boleto gerado!',
      subHeader: charge.digitableLine ? `Linha digitável: ${charge.digitableLine}` : undefined,
      message: 'O boleto também fica disponível em Meus pedidos.',
      buttons
    });
    await alert.present();
    await alert.onDidDismiss();
  }

  async showSuccessAlert(header: string, message: string) {
    const alert = await this.alertCtrl.create({
      header: header,
      message: message,
      buttons: ['OK']
    });
    await alert.present();
    await alert.onDidDismiss();
  }
}
