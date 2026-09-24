import { Component, inject, OnInit } from '@angular/core';
import { CartItem } from 'src/app/interfaces/cart-item';
import { AppUser } from 'src/app/interfaces/app-user';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { AsaasService, AsaasPaymentResult, CreditCardData, CreditCardHolderInfo } from 'src/app/services/asaas.service';
import { CoraCharge, CoraService } from 'src/app/services/cora.service';
import { Order } from 'src/app/interfaces/order';
import { CheckoutStateService } from 'src/app/services/checkout-state.service';
import { LoadingController, AlertController, NavController, ToastController } from '@ionic/angular';
import { OrdersService } from 'src/app/services/orders.service';
import { getAuth } from 'firebase/auth';
import { Router } from '@angular/router';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { FirebaseProducts } from 'src/app/services/firebase-products';

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
  private asaasService = inject(AsaasService);
  private coraService = inject(CoraService);
  private stateService = inject(CheckoutStateService);
  private loadingCtrl = inject(LoadingController);
  private alertCtrl = inject(AlertController);
  private ordersService = inject(OrdersService);
  private router = inject(Router);
  private usersService = inject(FirebaseUsersService);
  private firebaseProducts = inject(FirebaseProducts);

  constructor() { }

  ngOnInit() {
    this.cartService.getAllCartItems().subscribe(items => {
      this.cartItems = items;
    });

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

  nextStep() {
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

  get cartTotal(): number {
    const productsTotal = this.cartItems.reduce((acc, item) => {
      const p = item.productData.priceDiscounted 
        ? Math.min(item.productData.price, item.productData.priceDiscounted) 
        : item.productData.price;
      return acc + (p * item.quantity);
    }, 0);

    const shippingTotal = this.stateService.shippingData?.price || 0;
    return productsTotal + shippingTotal;
  }

  async finishOrder() {
    const loading = await this.loadingCtrl.create({
      message: 'Processando pagamento...',
    });
    await loading.present();

    try {
      const data = this.stateService.paymentData;
      
      // 1. Validar ou Criar Cliente
      if (!data.buyerName || !data.buyerCpf) {
         throw new Error("Por favor, preencha Nome e CPF nos dados do comprador.");
      }
      
      const buyerEmail = this.appUser?.email || undefined;

      const total = this.cartTotal;
      if (total <= 0) throw new Error("Carrinho vazio ou valor inválido.");

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 3); // 3 dias de vencimento
      const dueString = dueDate.toISOString().split('T')[0];

      // PIX e boleto saem pelo Cora (conta PJ do lojista); cartão pelo Asaas.
      let paymentResult: AsaasPaymentResult | null = null;
      let coraCharge: CoraCharge | null = null;

      if (data.method === 'PIX' || data.method === 'BOLETO') {
         const address = this.stateService.addressData;
         coraCharge = await this.coraService.createCharge({
           billingType: data.method,
           value: total,
           dueDate: dueString,
           customer: { name: data.buyerName, cpfCnpj: data.buyerCpf, email: buyerEmail },
           address: {
             street: address.street,
             number: address.addressNumber,
             district: address.neighborhood,
             city: address.city,
             state: address.state,
             complement: address.complement,
             zipCode: address.postalCode
           }
         });
      } else if (data.method === 'CREDIT_CARD') {
         // O servidor resolve o cliente Asaas a partir do ID token: reaproveita
         // o cadastro se o CPF já existir e guarda o vínculo em `users/{uid}`.
         const customer = await this.asaasService.createCustomer({
           name: data.buyerName,
           cpfCnpj: data.buyerCpf,
           email: buyerEmail,
           phone: data.buyerPhone
         });

         const expiryParts = data.cardData.expiry.split('/');
         const cardData: CreditCardData = {
           holderName: data.cardData.holderName,
           number: data.cardData.number.replace(/\D/g, ''),
           expiryMonth: expiryParts[0],
           expiryYear: '20' + expiryParts[1],
           ccv: data.cardData.ccv
         };
         
         const address = this.stateService.addressData;
         const holderInfo: CreditCardHolderInfo = {
           name: data.buyerName,
           email: buyerEmail || 'comprador@email.com',
           cpfCnpj: data.buyerCpf,
           postalCode: address.postalCode,
           addressNumber: address.addressNumber,
           phone: data.buyerPhone
         };

         paymentResult = await this.asaasService.createPayment(
           customer.id,
           'CREDIT_CARD',
           total,
           dueString,
           cardData,
           holderInfo
         );
      } else {
         throw new Error('Forma de pagamento não suportada.');
      }

      await loading.dismiss();

      // 4. Salvar Pedido no Firestore como PENDING com Escrow Automático
      const user = getAuth().currentUser;
      const sellerIds = [...new Set(this.cartItems.map(item => item.productData.sellerId || 'unknown'))];

      // Calcular data de liberação do escrow (7 dias a partir de agora)
      const releaseDate = new Date();
      releaseDate.setDate(releaseDate.getDate() + 7);

      // Firestore recusa campo `undefined`: só entra o id de quem cobrou.
      const paymentRef: Partial<Order> = coraCharge
        ? {
            paymentProvider: 'cora',
            coraInvoiceId: coraCharge.id,
            coraPayment: {
              pixCode: coraCharge.pixCode,
              bankSlipUrl: coraCharge.bankSlipUrl,
              digitableLine: coraCharge.digitableLine,
              sandbox: coraCharge.sandbox
            }
          }
        : { paymentProvider: 'asaas', asaasPaymentId: paymentResult!.id };

      const orderId = await this.ordersService.createOrder({
        userId: user?.uid || 'guest',
        items: [...this.cartItems],
        total: total,
        status: 'PENDING',
        paymentMethod: data.method as any,
        ...paymentRef,
        sellerIds: sellerIds,
        escrowInfo: {
          status: 'HOLDING',
          releaseDate: releaseDate
        },
        customerData: {
          name: data.buyerName,
          cpf: data.buyerCpf,
          phone: data.buyerPhone,
          email: buyerEmail || `${data.buyerCpf}@compraki.com.br`
        },
        addressData: {
          street: this.stateService.addressData.street || 'Endereço Salvo',
          number: this.stateService.addressData.addressNumber,
          city: this.stateService.addressData.city || 'Cidade',
          state: this.stateService.addressData.state || 'Estado',
          postalCode: this.stateService.addressData.postalCode,
          complement: this.stateService.addressData.complement,
          neighborhood: this.stateService.addressData.neighborhood
        },
        shippingInfo: {
          serviceId: this.stateService.shippingData.serviceId,
          serviceName: this.stateService.shippingData.serviceName,
          price: this.stateService.shippingData.price,
          freeShipping: this.stateService.shippingData.freeShipping === true,
          quotedPrice: this.stateService.shippingData.quotedPrice ?? this.stateService.shippingData.price,
          deliveryTime: this.stateService.shippingData.deliveryTime
        }
      });

      // 5. Navegar conforme o método
      if (data.method === 'PIX') {
          // A tela de PIX lê o código do próprio pedido e acompanha o status.
          this.router.navigate(['/pix-payment'], { queryParams: { orderId } });
      } else if (data.method === 'BOLETO') {
          await this.showBoletoAlert(coraCharge!);
          await this.cartService.clearCart();
          this.navCtrl.navigateRoot('/tabs/tab2');
      } else {
          // Cartão de Crédito
          //
          // O pedido segue PENDING aqui de proposito. Quem escreve `status` e
          // a Cloud Function `asaasWebhook`, pelo Admin SDK — o cliente nao
          // confirma o proprio pagamento (as regras do Firestore tambem barram).
          // Para cartao aprovado o webhook chega em segundos.
          const approved = ['CONFIRMED', 'RECEIVED'].includes(paymentResult!.status);
          await this.showSuccessAlert(
            approved ? 'Sucesso!' : 'Pagamento em análise',
            approved
              ? 'Compra em Cartão de Crédito aprovada!'
              : 'Recebemos seu pagamento e ele está em análise. Você será avisado assim que for confirmado.'
          );
          await this.cartService.clearCart();
          this.navCtrl.navigateRoot('/tabs/tab2');
      }

    } catch (e: any) {
      await loading.dismiss();
      const erroMsg = e.message || 'Falha ao processar pagamento.';
      console.error(e);
      const toast = await this.toastCtrl.create({
        message: erroMsg,
        duration: 4000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    }
  }

  /** Boleto do Cora: linha digitável em texto e o PDF num botão. */
  private async showBoletoAlert(charge: CoraCharge) {
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

  async showSuccessAlert(header: string, message: string, imageSrc?: string) {
    let htmlMsg = message;
    if (imageSrc) {
       htmlMsg = `<div style="text-align: center;"><img src="data:image/png;base64,${imageSrc}" width="200" /><br><p style="word-break: break-all; font-size: 12px; margin-top: 10px;">${message}</p></div>`;
    }

    const alert = await this.alertCtrl.create({
      header: header,
      message: htmlMsg,
      buttons: ['OK']
    });
    await alert.present();
    await alert.onDidDismiss();
  }
}
