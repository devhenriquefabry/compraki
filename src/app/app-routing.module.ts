import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: 'address',
    loadComponent: () => import('./pages/address/address.page').then(m => m.AddressPage)
  },
  {
    path: 'payments',
    loadComponent: () => import('./pages/payments/payments.page').then(m => m.PaymentsPage)
  },
  {
    path: '',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule)
  },
  {
    path: 'login',
    loadChildren: () => import('./pages/login/login.module').then(m => m.LoginPageModule)
  },
  {
    path: 'password-recovery',
    loadChildren: () => import('./pages/password-recovery/password-recovery.module').then(m => m.PasswordRecoveryPageModule)
  },
  {
    path: 'notifications',
    loadChildren: () => import('./pages/notifications/notifications.module').then(m => m.NotificationsPageModule)
  },
  {
    path: 'product-details/:id',
    loadComponent: () => import('./pages/product-details/product-details.page').then(m => m.ProductDetailsPage)
  },
  {
    path: 'home',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule)
  },
  {
    path: 'sign-in',
    loadChildren: () => import('./pages/sign-in/sign-in.module').then(m => m.SignInPageModule)
  },
  { 
    path: 'forgot-password',
    loadChildren: () => import('./pages/forgot-password/forgot-password.module').then(m => m.ForgotPasswordPageModule)
  },
  {
    path: 'upload-product',
    loadChildren: () => import('./pages/upload-product/upload-product.module').then(m => m.UploadProductPageModule)
  },
  {
    path: 'checkout',
    loadChildren: () => import('./pages/checkout/checkout.module').then(m => m.CheckoutPageModule)
  },
  {
    path: 'edit-product',
    loadChildren: () => import('./pages/edit-product/edit-product.module').then(m => m.EditProductPageModule)
  },
  {
    path: 'manage-categories',
    loadChildren: () => import('./pages/manage-categories/manage-categories.module').then(m => m.ManageCategoriesPageModule)
  },
  {
    path: 'chat-details/:id',
    loadComponent: () => import('./pages/chat-details/chat-details.page').then(m => m.ChatDetailsPage)
  },
  {
    path: 'cart',
    loadComponent: () => import('./pages/cart/cart.page').then(m => m.CartPage)
  },
  {
    path: 'webhook-tester',
    loadChildren: () => import('./pages/webhook-tester/webhook-tester.module').then( m => m.WebhookTesterPageModule)
  },
  {
    path: 'pix-payment',
    loadChildren: () => import('./pages/pix-payment/pix-payment.module').then( m => m.PixPaymentPageModule)
  },
  {
    path: 'my-orders',
    loadChildren: () => import('./pages/my-orders/my-orders.module').then( m => m.MyOrdersPageModule)
  },
  {
    path: 'payment-success',
    loadChildren: () => import('./pages/payment-success/payment-success.module').then( m => m.PaymentSuccessPageModule)
  },
  {
    path: 'my-products',
    loadChildren: () => import('./pages/my-products/my-products.module').then( m => m.MyProductsPageModule)
  },
  {
    path: 'my-sales',
    loadChildren: () => import('./pages/my-sales/my-sales.module').then( m => m.MySalesPageModule)
  },
  {
    path: 'sale-details/:id',
    loadChildren: () => import('./pages/sale-details/sale-details.module').then( m => m.SaleDetailsPageModule)
  },
  {
    path: 'product-admin/:id',
    loadChildren: () => import('./pages/product-admin/product-admin.module').then( m => m.ProductAdminPageModule)
  },  {
    path: 'bots',
    loadChildren: () => import('./pages/bots/bots.module').then( m => m.BotsPageModule)
  },
  {
    path: 'admin',
    loadComponent: () => import('./pages/admin/admin.page').then( m => m.AdminPage)
  }

];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
