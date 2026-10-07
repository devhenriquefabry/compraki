import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { authGuard, noAuthGuard, storefrontGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';
import { SelectivePreloadStrategy } from './core/selective-preload.strategy';

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
    // Vitrine aberta no navegador; as abas de conta têm guard próprio
    // (tabs-routing.module.ts).
    path: '',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule),
    canActivate: [storefrontGuard]
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
    loadComponent: () => import('./pages/notifications/notifications.page').then(m => m.NotificationsPage),
    canActivate: [authGuard]
  },
  {
    // Política de Privacidade: aberta, sem guard — precisa poder ser lida
    // antes de criar a conta (inclusive no app nativo).
    path: 'privacy',
    loadComponent: () => import('./pages/privacy/privacy.page').then(m => m.PrivacyPage)
  },
  {
    // Excluir conta (LGPD). O servidor recusa conta de admin; a tela também.
    path: 'account/delete',
    loadComponent: () => import('./pages/delete-account/delete-account.page').then(m => m.DeleteAccountPage),
    canActivate: [authGuard]
  },
  {
    // Termos de uso, trocas e devoluções e regras para vender. Aberta, como a privacidade.
    path: 'terms',
    loadComponent: () => import('./pages/terms/terms.page').then(m => m.TermsPage)
  },
  {
    // Central de ajuda: perguntas e respostas para quem compra e para quem vende. Aberta, sem guard.
    path: 'help',
    loadComponent: () => import('./pages/help/help.page').then(m => m.HelpPage)
  },
  {
    // "Fale com a Vineon": atendimento por protocolo. Precisa de conta (o
    // atendimento nasce ligado a ela); quem não entra usa o e-mail da Central.
    // `support/new` vem antes de `support/:id`.
    path: 'support',
    loadComponent: () => import('./pages/support/support.page').then(m => m.SupportPage),
    canActivate: [authGuard]
  },
  {
    path: 'support/new',
    loadComponent: () => import('./pages/support-new/support-new.page').then(m => m.SupportNewPage),
    canActivate: [authGuard]
  },
  {
    path: 'support/:id',
    loadComponent: () => import('./pages/support-ticket/support-ticket.page').then(m => m.SupportTicketPage),
    canActivate: [authGuard]
  },
  {
    path: 'product-details/:id',
    loadComponent: () => import('./pages/product-details/product-details.page').then(m => m.ProductDetailsPage),
    data: { preload: true },
    canActivate: [storefrontGuard]
  },
  {
    path: 'home',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule),
    canActivate: [storefrontGuard]
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
    data: { preload: true },
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
    data: { preload: true },
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
    path: 'purchase-history',
    loadComponent: () => import('./pages/purchase-history/purchase-history.page').then(m => m.PurchaseHistoryPage),
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
    // Cupons públicos (Vineon e lojas). Aberto como a vitrine.
    path: 'coupons',
    loadComponent: () => import('./pages/coupons/coupons.page').then(m => m.CouponsPage),
    canActivate: [storefrontGuard]
  },
  {
    // Minhas avaliações: o que falta avaliar, o que a pessoa já avaliou e,
    // para quem vende, as avaliações da loja para responder.
    path: 'my-reviews',
    loadComponent: () => import('./pages/my-reviews/my-reviews.page').then(m => m.MyReviewsPage),
    canActivate: [authGuard]
  },
  {
    // "Cupons da loja": a loja cria e acompanha os cupons dela.
    path: 'my-coupons',
    loadComponent: () => import('./pages/my-coupons/my-coupons.page').then(m => m.MyCouponsPage),
    canActivate: [authGuard]
  },
  {
    path: 'my-invoices',
    loadComponent: () => import('./pages/my-invoices/my-invoices.page').then(m => m.MyInvoicesPage),
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
    // Trocar de seção não recria o painel (ver AppRouteStrategy).
    data: { reuseAcrossParams: true },
    canActivate: [adminGuard]
  },
  {
    path: 'my-showcase',
    loadChildren: () => import('./pages/my-showcase/my-showcase.module').then( m => m.MyShowcasePageModule),
    canActivate: [authGuard]
  },
  {
    path: 'seller-profile',
    loadComponent: () => import('./pages/seller-profile/seller-profile.page').then(m => m.SellerProfilePage),
    canActivate: [authGuard]
  },
  {
    path: 'seller-profile/:sellerId',
    loadComponent: () => import('./pages/seller-profile/seller-profile.page').then(m => m.SellerProfilePage),
    canActivate: [storefrontGuard]
  }


];

@NgModule({
  imports: [
    // Só as rotas com `data: { preload: true }` são baixadas antecipadamente.
    // `PreloadAllModules` trazia até o painel admin no primeiro acesso.
    RouterModule.forRoot(routes, { preloadingStrategy: SelectivePreloadStrategy })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
