import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { authGuard, noAuthGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';

const routes: Routes = [
  {
    path: 'address',
    loadComponent: () => import('./pages/address/address.page').then(m => m.AddressPage),
    canActivate: [authGuard]
  },
  {
    path: 'payments',
    loadComponent: () => import('./pages/payments/payments.page').then(m => m.PaymentsPage),
    canActivate: [authGuard]
  },
  {
    path: '',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'login',
    loadChildren: () => import('./pages/login/login.module').then(m => m.LoginPageModule),
    canActivate: [noAuthGuard]
  },
  {
    path: 'password-recovery',
    loadChildren: () => import('./pages/password-recovery/password-recovery.module').then(m => m.PasswordRecoveryPageModule),
    canActivate: [noAuthGuard]
  },
  {
    path: 'notifications',
    loadChildren: () => import('./pages/notifications/notifications.module').then(m => m.NotificationsPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'product-details/:id',
    loadComponent: () => import('./pages/product-details/product-details.page').then(m => m.ProductDetailsPage),
    canActivate: [authGuard]
  },
  {
    path: 'home',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'sign-in',
    loadChildren: () => import('./pages/sign-in/sign-in.module').then(m => m.SignInPageModule),
    canActivate: [noAuthGuard]
  },
  { 
    path: 'forgot-password',
    loadChildren: () => import('./pages/forgot-password/forgot-password.module').then(m => m.ForgotPasswordPageModule),
    canActivate: [noAuthGuard]
  },
  {
    path: 'upload-product',
    loadChildren: () => import('./pages/upload-product/upload-product.module').then(m => m.UploadProductPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'checkout',
    loadChildren: () => import('./pages/checkout/checkout.module').then(m => m.CheckoutPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'edit-product',
    loadChildren: () => import('./pages/edit-product/edit-product.module').then(m => m.EditProductPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'manage-categories',
    loadChildren: () => import('./pages/manage-categories/manage-categories.module').then(m => m.ManageCategoriesPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'chat-details/:id',
    loadComponent: () => import('./pages/chat-details/chat-details.page').then(m => m.ChatDetailsPage),
    canActivate: [authGuard]
  },
  {
    path: 'cart',
    loadComponent: () => import('./pages/cart/cart.page').then(m => m.CartPage),
    canActivate: [authGuard]
  },
  {
    path: 'webhook-tester',
    loadChildren: () => import('./pages/webhook-tester/webhook-tester.module').then( m => m.WebhookTesterPageModule),
    canActivate: [adminGuard]
  },
  {
    path: 'pix-payment',
    loadChildren: () => import('./pages/pix-payment/pix-payment.module').then( m => m.PixPaymentPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'my-orders',
    loadChildren: () => import('./pages/my-orders/my-orders.module').then( m => m.MyOrdersPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'payment-success',
    loadChildren: () => import('./pages/payment-success/payment-success.module').then( m => m.PaymentSuccessPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'my-products',
    loadChildren: () => import('./pages/my-products/my-products.module').then( m => m.MyProductsPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'my-sales',
    loadChildren: () => import('./pages/my-sales/my-sales.module').then( m => m.MySalesPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'sale-details/:id',
    loadChildren: () => import('./pages/sale-details/sale-details.module').then( m => m.SaleDetailsPageModule),
    canActivate: [authGuard]
  },
  {
    path: 'product-admin/:id',
    loadChildren: () => import('./pages/product-admin/product-admin.module').then( m => m.ProductAdminPageModule),
    canActivate: [authGuard]
  },  {
    path: 'bots',
    redirectTo: 'admin/bots',
    pathMatch: 'full'
  },
  {
    path: 'admin',
    redirectTo: 'admin/metrics',
    pathMatch: 'full'
  },
  {
    path: 'admin/:tab',
    loadComponent: () => import('./pages/admin/admin.page').then( m => m.AdminPage),
    canActivate: [adminGuard]
  },  {
    path: 'my-showcase',
    loadChildren: () => import('./pages/my-showcase/my-showcase.module').then( m => m.MyShowcasePageModule),
    canActivate: [authGuard]
  }


];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
