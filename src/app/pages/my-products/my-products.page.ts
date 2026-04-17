import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { Product } from 'src/app/interfaces/product';
import { Subscription } from 'rxjs';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@Component({
  selector: 'app-my-products',
  templateUrl: './my-products.page.html',
  styleUrls: ['./my-products.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, MiniHeaderComponent]
})
export class MyProductsPage implements OnInit, OnDestroy {

  private fbProducts = inject(FirebaseProducts);
  private router = inject(Router);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);

  public myProducts: Product[] = [];
  public isLoading: boolean = true;
  private sub?: Subscription;

  constructor() { }

  ngOnInit() {
    this.carregarProdutos();
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  carregarProdutos() {
    this.isLoading = true;
    const user = this.fbProducts.getUser();
    
    if (user) {
      this.sub = this.fbProducts.getBySeller(user.uid).subscribe({
        next: (products) => {
          this.myProducts = products;
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Erro ao carregar seus produtos:', err);
          this.isLoading = false;
        }
      });
    } else {
      this.isLoading = false;
      this.router.navigate(['/login']);
    }
  }

  async deleteProduct(product: Product) {
    if (!product.id) return;

    const alert = await this.alertCtrl.create({
      header: 'Excluir Produto',
      message: `Tem certeza que deseja excluir "${product.name}"? Esta ação não pode ser desfeita.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Excluir',
          role: 'destructive',
          handler: async () => {
            try {
              await this.fbProducts.delete(product.id!);
              const toast = await this.toastCtrl.create({
                message: 'Produto excluído com sucesso!',
                duration: 2000,
                color: 'success'
              });
              await toast.present();
            } catch (err) {
              console.error(err);
              const toast = await this.toastCtrl.create({
                message: 'Erro ao excluir produto.',
                duration: 2000,
                color: 'danger'
              });
              await toast.present();
            }
          }
        }
      ]
    });

    await alert.present();
  }

  editProduct(productId: string) {
    this.router.navigate(['/edit-product', productId]);
  }

  formatPrice(price: number): string {
    return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
