import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AdminHeaderComponent } from '../../components/admin-header/admin-header.component';
import { DevProductsPage } from '../dev-products/dev-products.page';
import { ManageChatsPage } from '../manage-chats/manage-chats.page';
import { ManageBannersPage } from '../manage-banners/manage-banners.page';
import { ManageWhatsappPage } from '../manage-whatsapp/manage-whatsapp.page';

type AdminTab = 'products' | 'chats' | 'banners' | 'whatsapp';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule,
    AdminHeaderComponent,
    DevProductsPage,
    ManageChatsPage,
    ManageBannersPage,
    ManageWhatsappPage
  ]
})
export class AdminPage implements OnInit, OnDestroy {
  activeTab: AdminTab = 'products';
  private routeSub?: Subscription;
  private validTabs: AdminTab[] = ['products', 'chats', 'banners', 'whatsapp'];

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.routeSub = this.route.paramMap.subscribe(params => {
      const tab = params.get('tab') as AdminTab | null;

      if (tab && this.validTabs.includes(tab)) {
        this.activeTab = tab;
        return;
      }

      this.router.navigate(['/admin/products'], { replaceUrl: true });
    });
  }

  ngOnDestroy() {
    this.routeSub?.unsubscribe();
  }
}
