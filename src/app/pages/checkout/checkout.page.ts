import { Component, inject, OnInit } from '@angular/core';
import { CartItem } from 'src/app/interfaces/cart-item';
import { AppUser } from 'src/app/interfaces/app-user';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { AsaasService, AsaasPaymentResult, CreditCardData, CreditCardHolderInfo } from 'src/app/services/asaas.service';
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
      
      // O servidor resolve o cliente Asaas a partir do ID token: reaproveita o
      // cadastro se o CPF já existir e guarda o vínculo em `users/{uid}`.
      // O app não escolhe mais para qual cliente a cobrança vai.
      const buyerEmail = this.appUser?.email || undefined;
      const customer = await this.asaasService.createCustomer({
        name: data.buyerName,
        cpfCnpj: data.buyerCpf,
        email: buyerEmail,
        phone: data.buyerPhone
      });

      const total = this.cartTotal;
      if (total <= 0) throw new Error("Carrinho vazio ou valor inválido.");

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 3); // 3 dias de vencimento
      const dueString = dueDate.toISOString().split('T')[0];

      let paymentResult: AsaasPaymentResult;

      if (data.method === 'PIX' || data.method === 'BOLETO') {
         paymentResult = await this.asaasService.createPayment(
           customer.id,
           data.method,
           total,
           dueString
         );
      } else if (data.method === 'CREDIT_CARD') {
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

      const orderId = await this.ordersService.createOrder({
        userId: user?.uid || 'guest',
        items: [...this.cartItems],
        total: total,
        status: 'PENDING',
        paymentMethod: data.method as any,
        asaasPaymentId: paymentResult.id,
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
          deliveryTime: this.stateService.shippingData.deliveryTime
        }
      });

      // 5. Navegar conforme o método
      if (data.method === 'PIX') {
          // O QR Code ja vem em `createPayment`; a consulta abaixo e o
          // fallback para quando o Asaas ainda nao o tinha pronto.
          const qr = (paymentResult.pixQrCode
            ?? await this.asaasService.getPixQrCode(paymentResult.id)) as
            { payload?: string; encodedImage?: string } | null;
          this.router.navigate(['/pix-payment'], { 
            queryParams: { 
              orderId: orderId,
              paymentId: paymentResult.id,
              pixCode: qr?.payload,
              qrCode: qr?.encodedImage
            }
          });
      } else if (data.method === 'BOLETO') {
          await this.showSuccessAlert('Boleto Gerado!', `Link do Boleto: \n\n ${paymentResult.bankSlipUrl}`);
          await this.cartService.clearCart();
          this.navCtrl.navigateRoot('/tabs/tab2');
      } else {
          // Cartão de Crédito
          // Status vem do Asaas, nao de suposicao nossa: CONFIRMED/RECEIVED
          // significam aprovado; qualquer outra coisa segue PENDING ate o
          // webhook confirmar.
          const approved = ['CONFIRMED', 'RECEIVED'].includes(paymentResult.status);
          if (approved) {
            await this.ordersService.updateOrderStatus(orderId, 'RECEIVED');
          }
          await this.showSuccessAlert('Sucesso!', 'Compra em Cartão de Crédito aprovada!');
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
