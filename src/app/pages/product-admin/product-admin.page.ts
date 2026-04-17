import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { StatsService } from 'src/app/services/stats.service';
import { Product } from 'src/app/interfaces/product';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';

@Component({
  selector: 'app-product-admin',
  templateUrl: './product-admin.page.html',
  styleUrls: ['./product-admin.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, MiniHeaderComponent]
})
export class ProductAdminPage implements OnInit {

  private route = inject(ActivatedRoute);
  private fbProducts = inject(FirebaseProducts);
  private statsService = inject(StatsService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private router = inject(Router);

  public product: Product | null = null;
  public stats: any = null;
  public activeTab: 'DETAILS' | 'STATS' = 'DETAILS';
  public isLoading: boolean = true;

  constructor() { }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.fbProducts.getAll().subscribe(async (products) => {
        const found = products.find(p => p.id === id);
        if (found) {
          this.product = found;
          this.stats = await this.statsService.getProductStats(id);
        }
        this.isLoading = false;
      });
    }
  }

  async deleteProduct() {
     if (!this.product?.id) return;

    const alert = await this.alertCtrl.create({
      header: 'Excluir Produto',
      message: `Tem certeza que deseja excluir "${this.product.name}"?`,
      buttons: [
        { text: 'Não', role: 'cancel' },
        {
          text: 'Sim, Excluir',
          role: 'destructive',
          handler: async () => {
            await this.fbProducts.delete(this.product!.id!);
            const toast = await this.toastCtrl.create({
              message: 'Produto removido.',
              duration: 2000,
              color: 'success'
            });
            await toast.present();
            this.router.navigate(['/my-products']);
          }
        }
      ]
    });

    await alert.present();
  }

  formatPrice(price: number): string {
    return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
