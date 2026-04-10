import { Component, inject, OnInit } from '@angular/core';
import { CartItem } from 'src/app/interfaces/cart-item';
import { FirebaseCartService } from 'src/app/services/firebase-cart.service';
import { NavController, ToastController } from '@ionic/angular';

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
  standalone: false
})
export class CheckoutPage implements OnInit {
  
  public currentStep: number = 1;
  public cartItems: CartItem[] = [];
  
  private cartService = inject(FirebaseCartService);
  private navCtrl = inject(NavController);
  private toastCtrl = inject(ToastController);

  constructor() { }

  ngOnInit() {
    this.cartService.getAllCartItems().subscribe(items => {
      this.cartItems = items;
    });
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

  async finishOrder() {
    const toast = await this.toastCtrl.create({
      message: 'Pedido realizado com sucesso!',
      duration: 2000,
      color: 'success',
      position: 'top'
    });
    await toast.present();
    
    // Limpar carrinho e voltar para home
    await this.cartService.clearCart();
    this.navCtrl.navigateRoot('/tabs/tab2');
  }
}
