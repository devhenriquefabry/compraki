import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabsPage } from './tabs.page';
import { authGuard } from '../guards/auth.guard';

const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: '',
        redirectTo: 'tab2',
        pathMatch: 'full'
      },
      {
        path: 'tab2',
        loadChildren: () => import('../tab2/tab2.module').then(m => m.Tab2PageModule)
      },
      {
        path: 'cart',
        loadComponent: () => import('../pages/cart/cart.page').then(m => m.CartPage),
        canActivate: [authGuard]
      },
      {
        path: 'upload-product',
        loadChildren: () => import('../pages/upload-product/upload-product.module').then(m => m.UploadProductPageModule),
        canActivate: [authGuard]
      },
      {
        path: 'my-account',
        loadChildren: () => import('../pages/my-account/my-account.module').then(m => m.MyAccountPageModule),
        canActivate: [authGuard]
      },
      {
        path: 'notifications',
        loadChildren: () => import('../pages/notifications/notifications.module').then(m => m.NotificationsPageModule),
        canActivate: [authGuard]
      },
      {
        path: 'saved',
        loadComponent: () => import('../pages/saved/saved.page').then(m => m.SavedPage),
        canActivate: [authGuard]
      },
      {
        path: 'chats',
        loadComponent: () => import('../pages/chats/chats.page').then(m => m.ChatsPage),
        canActivate: [authGuard]
      }
    ]
  },
  {
    path: '',
    redirectTo: '/tabs/tab2',
    pathMatch: 'full'
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
})
export class TabsPageRoutingModule {}
