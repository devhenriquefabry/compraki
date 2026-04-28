import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { AdminHeaderComponent } from '../../components/admin-header/admin-header.component';
import { DevProductsPage } from '../dev-products/dev-products.page';
import { ManageChatsPage } from '../manage-chats/manage-chats.page';
import { ManageBannersPage } from '../manage-banners/manage-banners.page';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AdminHeaderComponent,
    DevProductsPage,
    ManageChatsPage,
    ManageBannersPage
  ]
})
export class AdminPage {
  activeTab: 'products' | 'chats' | 'banners' = 'products';
}
