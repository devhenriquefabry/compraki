import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AdminHeaderComponent } from '../../components/admin-header/admin-header.component';
import { DevProductsPage } from '../dev-products/dev-products.page';
import { ManageChatsPage } from '../manage-chats/manage-chats.page';
import { ManageBannersPage } from '../manage-banners/manage-banners.page';
import { ManageWhatsappPage } from '../manage-whatsapp/manage-whatsapp.page';
import { MelhorEnvioPage } from '../melhor-envio/melhor-envio.page';
import { AdminMetricsPage } from '../admin-metrics/admin-metrics.page';
import { BotsPage } from '../bots/bots.page';
import { ManageUsersPage } from '../manage-users/manage-users.page';
import { ManageRefundsPage } from '../manage-refunds/manage-refunds.page';

type AdminTab =
  | 'metrics'
  | 'products'
  | 'chats'
  | 'banners'
  | 'whatsapp'
  | 'melhor-envio'
  | 'bots'
  | 'users'
  | 'refunds';

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
    AdminMetricsPage,
    DevProductsPage,
    ManageChatsPage,
    ManageBannersPage,
    ManageWhatsappPage,
    MelhorEnvioPage,
    BotsPage,
    ManageUsersPage,
    ManageRefundsPage
  ]
})
export class AdminPage implements OnInit, OnDestroy {
  activeTab: AdminTab = 'metrics';
  private routeSub?: Subscription;
  private validTabs: AdminTab[] = [
    'metrics',
    'products',
    'chats',
    'banners',
    'whatsapp',
    'melhor-envio',
    'bots',
    'users',
    'refunds'
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private modalCtrl: ModalController
  ) {}

  ngOnInit() {
    this.routeSub = this.route.paramMap.subscribe(params => {
      const tab = params.get('tab') as AdminTab | null;

      if (tab && this.validTabs.includes(tab)) {
        if (tab !== 'products') {
          this.dismissProductChatModals();
        }

        this.activeTab = tab;
        return;
      }

      this.router.navigate(['/admin/metrics'], { replaceUrl: true });
    });
  }

  ngOnDestroy() {
    this.routeSub?.unsubscribe();
  }

  private dismissProductChatModals() {
    localStorage.setItem('compraki_chat_open', 'false');
    void this.modalCtrl.dismiss(undefined, 'admin-tab-change', 'admin-mobile-chat-modal').catch(() => undefined);
    void this.modalCtrl.dismiss(undefined, 'admin-tab-change', 'admin-chat-inbox-modal').catch(() => undefined);
  }
}
