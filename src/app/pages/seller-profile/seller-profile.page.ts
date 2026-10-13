import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { Subscription, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ChatBoxComponent } from 'src/app/components/chat-box/chat-box.component';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { ReportModalComponent } from 'src/app/components/report-modal/report-modal.component';
import { ReviewStarsComponent } from 'src/app/components/review-stars/review-stars.component';
import { StorefrontCardComponent } from 'src/app/components/storefront-card/storefront-card.component';
import { waitForAuthUser } from 'src/app/core/auth-state';
import { requireAccount } from 'src/app/core/auth-redirect';
import { couponHeadline, couponShortRule, isCouponLive } from 'src/app/core/coupons';
import { LayoutService } from 'src/app/core/layout.service';
import { formatDay, normalizeSearch, toDate } from 'src/app/core/order-stage';
import { priceMain } from 'src/app/core/product-pricing';
import { SHOP_COLOR_DEFAULT, normalizeHex, textOnShopColor } from 'src/app/core/shop-color';
import { STORE_ICONS } from 'src/app/core/store-icons';
import { Coupon } from 'src/app/interfaces/coupon';
import { Product } from 'src/app/interfaces/product';
import { ProductReview } from 'src/app/interfaces/review';
import { PublicSellerProfile } from 'src/app/interfaces/seller';
import { CouponService } from 'src/app/services/coupon.service';
import { FirebaseChatService } from 'src/app/services/firebase-chat.service';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';
import { ProductReviewsService, reviewPhotoUrl } from 'src/app/services/product-reviews.service';
import { environment } from 'src/environments/environment';

type Tab = 'produtos' | 'avaliacoes' | 'sobre';
type Sort = 'relevance' | 'sold' | 'priceAsc' | 'priceDesc' | 'recent';

const TABS: Tab[] = ['produtos', 'avaliacoes', 'sobre'];
const REVIEWS_STEP = 8;

export const SORT_LABELS: Record<Sort, string> = {
  relevance: 'Mais relevantes',
  sold: 'Mais vendidos',
  priceAsc: 'Menor preço',
  priceDesc: 'Maior preço',
  recent: 'Mais recentes',
};

/**
 * Página pública da loja (`/seller-profile/:sellerId`).
 *
 * Só mostra o que é verdade e dá para conferir: a nota vem das avaliações de
 * compra verificada dos produtos da loja (`watchStore`), vendas da soma de
 * `soldCount`, seguidores da subcoleção. O selo "Vendedor verificado" saiu —
 * `isSeller` é true para todo mundo, então não verificava nada.
 *
 * A cor da loja (escolhida em "Minha vitrine") vai no botão Seguir e na aba
 * ativa; o resto segue a casca Vineon. A capa tem proporção fixa porque a
 * orientação de medidas da vitrine depende dela (`core/shop-media.ts`), e a
 * prévia em `my-showcase` repete este layout — mexeu aqui, mexa lá.
 *
 * `?aba=produtos|avaliacoes|sobre` abre direto numa aba. No computador "Sobre"
 * vira a coluna da direita, sem aba.
 */
@Component({
  selector: 'app-seller-profile',
  templateUrl: './seller-profile.page.html',
  styleUrls: ['./seller-profile.page.scss'],
  standalone: true,
  imports: [
    IonicModule, FormsModule, RouterModule, NgTemplateOutlet, MiniHeaderComponent, ChatBoxComponent,
    StorefrontCardComponent, ReviewStarsComponent,
  ],
})
export class SellerProfilePage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly productsService = inject(FirebaseProducts);
  private readonly usersService = inject(FirebaseUsersService);
  private readonly chatService = inject(FirebaseChatService);
  private readonly reviewsService = inject(ProductReviewsService);
  private readonly couponService = inject(CouponService);
  private readonly layout = inject(LayoutService);

  readonly ic = STORE_ICONS;
  readonly sortLabels = SORT_LABELS;
  readonly sortKeys = Object.keys(SORT_LABELS) as Sort[];
  readonly photoUrl = reviewPhotoUrl;

  /** undefined = carregando; null = loja não existe. */
  readonly seller = signal<PublicSellerProfile | null | undefined>(undefined);
  readonly products = signal<Product[]>([]);
  readonly productsLoaded = signal(false);
  readonly reviews = signal<ProductReview[]>([]);
  readonly followers = signal(0);
  readonly isFollowing = signal(false);
  readonly coupons = signal<Coupon[]>([]);

  readonly tab = signal<Tab>('produtos');
  readonly search = signal('');
  readonly sort = signal<Sort>('relevance');
  readonly reviewsShown = signal(REVIEWS_STEP);
  readonly bioOpen = signal(false);

  followBusy = false;
  isChatOpen = false;
  activeChatId = '';
  readonly currentUserId = signal('');

  readonly isDesktop = this.layout.isDesktop;

  readonly isOwn = computed(() => !!this.seller() && this.seller()!.uid === this.currentUserId());

  readonly name = computed(() => {
    const s = this.seller();
    return s?.shopName || s?.displayName || s?.username || 'Loja na Vineon';
  });

  readonly initials = computed(() => {
    const words = this.name().split(/\s+/).filter(w => w && !/^(d[aeo]s?|e|&)$/i.test(w));
    return words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'VN';
  });

  readonly color = computed(() => normalizeHex(this.seller()?.shopPrimaryColor) || SHOP_COLOR_DEFAULT);
  readonly onColor = computed(() => textOnShopColor(this.color()));

  readonly memberSince = computed(() => {
    const date = toDate(this.seller()?.createdAt);
    return date ? date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
  });

  readonly soldCount = computed(() => this.products().reduce((total, p) => total + (p.soldCount || 0), 0));
  readonly inStockCount = computed(() => this.products().filter(p => p.stock > 0).length);

  readonly paymentLabel = computed(() => {
    const labels: Record<string, string> = { PIX: 'Pix', 'CARTÃO': 'Cartão', DINHEIRO: 'Dinheiro' };
    const set = new Set(this.products().flatMap(p => p.paymentMethods || []));
    return [...set].map(m => labels[m] || m).join(', ');
  });

  readonly shippingLabel = computed(() => [...new Set(this.products().map(p => p.shipping).filter(Boolean))].join(', '));

  /** Nota da loja: média das avaliações verificadas de todos os produtos. */
  readonly rating = computed(() => {
    const list = this.reviews().filter(r => typeof r.rating === 'number');
    if (!list.length) return null;
    const bars = [5, 4, 3, 2, 1].map(stars => {
      const count = list.filter(r => Math.round(r.rating) === stars).length;
      return { stars, count, percent: Math.round((count / list.length) * 100) };
    });
    const average = list.reduce((sum, r) => sum + r.rating, 0) / list.length;
    return { average, count: list.length, bars };
  });

  readonly visibleReviews = computed(() => this.reviews().slice(0, this.reviewsShown()));

  readonly shownProducts = computed(() => {
    const term = normalizeSearch(this.search().trim());
    let list = this.products();
    if (term) list = list.filter(p => normalizeSearch(p.name).includes(term));
    const sorted = [...list];
    const time = (p: Product) => toDate((p as any).createdAt)?.getTime() ?? 0;
    switch (this.sort()) {
      case 'sold': sorted.sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0)); break;
      case 'priceAsc': sorted.sort((a, b) => priceMain(a) - priceMain(b)); break;
      case 'priceDesc': sorted.sort((a, b) => priceMain(b) - priceMain(a)); break;
      case 'recent': sorted.sort((a, b) => time(b) - time(a)); break;
      default: sorted.sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0) || time(b) - time(a));
    }
    // Esgotado sempre por último: a pessoa veio comprar.
    return sorted.sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0));
  });

  readonly publicUrl = computed(() => {
    const origin = environment.production ? 'https://www.vineonsite.com.br' : location.origin;
    return `${origin}/seller-profile/${this.seller()?.uid ?? ''}`;
  });

  private subs: Subscription[] = [];

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Auth pode ainda estar restaurando a sessão (F5 em /seller-profile).
    const authReady = waitForAuthUser().then(user => {
      this.currentUserId.set(user?.uid || '');
      return user?.uid || '';
    });

    const routeSub = this.route.paramMap.subscribe(params => {
      const id = params.get('sellerId');
      if (id) this.load(id);
      else authReady.then(uid => this.load(uid));
    });
    const querySub = this.route.queryParamMap.subscribe(q => {
      const aba = q.get('aba') as Tab | null;
      if (aba && TABS.includes(aba)) this.tab.set(aba);
    });

    // "Sobre" é a coluna da direita no computador: lá a aba não existe.
    effect(() => {
      if (this.isDesktop() && this.tab() === 'sobre') this.tab.set('produtos');
    });

    destroyRef.onDestroy(() => {
      routeSub.unsubscribe();
      querySub.unsubscribe();
      this.unbind();
    });
  }

  private async load(sellerId: string) {
    this.unbind();
    this.seller.set(undefined);
    this.products.set([]);
    this.productsLoaded.set(false);
    this.reviews.set([]);
    this.coupons.set([]);
    this.reviewsShown.set(REVIEWS_STEP);
    if (!sellerId) {
      this.seller.set(null);
      return;
    }

    this.subs.push(
      this.productsService.getBySeller(sellerId).pipe(catchError(() => of([] as Product[]))).subscribe(list => {
        this.products.set(list);
        this.productsLoaded.set(true);
      }),
      this.reviewsService.watchStore(sellerId).pipe(catchError(() => of([] as ProductReview[]))).subscribe(list => this.reviews.set(list)),
      this.usersService.getSellerFollowerCount(sellerId).pipe(catchError(() => of(0))).subscribe(n => this.followers.set(n)),
      this.usersService.isFollowingSeller(sellerId).pipe(catchError(() => of(false))).subscribe(v => this.isFollowing.set(v)),
    );

    this.couponService.listPublicOfSeller(sellerId)
      .then(list => this.coupons.set(list.filter(c => isCouponLive(c))))
      .catch(() => undefined);

    try {
      this.seller.set(await this.usersService.getPublicSellerProfile(sellerId));
    } catch (error) {
      console.error('Falha ao carregar a loja:', error);
      this.seller.set(null);
    }
  }

  private unbind() {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
  }

  // ------------------------------------------------------------ abas e lista

  selectTab(tab: Tab) {
    this.tab.set(tab);
  }

  openReviews() {
    this.tab.set('avaliacoes');
    requestAnimationFrame(() => document.getElementById('sp-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  showMoreReviews() {
    this.reviewsShown.update(n => n + REVIEWS_STEP);
  }

  clearSearch() {
    this.search.set('');
  }

  // ------------------------------------------------------------ ações

  editShowcase() {
    this.router.navigate(['/my-showcase']);
  }

  async toggleFollow() {
    const seller = this.seller();
    if (!seller || !requireAccount(this.router) || this.isOwn() || this.followBusy) return;

    this.followBusy = true;
    try {
      if (this.isFollowing()) {
        await this.usersService.unfollowSeller(seller.uid);
        await this.showToast('Você deixou de seguir esta loja.');
      } else {
        await this.usersService.followSeller(seller);
        await this.showToast('Pronto: você segue esta loja.');
      }
    } catch (error) {
      console.error('Falha ao atualizar seguimento:', error);
      await this.showToast('Não deu para atualizar. Tente de novo.', 'danger');
    } finally {
      this.followBusy = false;
    }
  }

  async startChat() {
    const seller = this.seller();
    if (!seller || !requireAccount(this.router)) return;
    if (this.isOwn()) {
      this.editShowcase();
      return;
    }
    try {
      this.activeChatId = await this.chatService.startChat({
        uid: seller.uid,
        name: this.name(),
        photoUrl: seller.photoURL || undefined,
      });
      this.isChatOpen = true;
    } catch (error) {
      console.error('Falha ao iniciar conversa com a loja:', error);
      await this.showToast('Não deu para abrir a conversa. Tente de novo.', 'danger');
    }
  }

  closeChat() {
    this.isChatOpen = false;
    this.activeChatId = '';
  }

  async share() {
    const url = this.publicUrl();
    const title = `${this.name()} na Vineon`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      await this.showToast('Link da loja copiado.');
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        await this.showToast('Não deu para compartilhar. Copie o endereço da barra do navegador.', 'warning');
      }
    }
  }

  whatsAppUrl(): string | null {
    const digits = (this.seller()?.shopWhatsApp || '').replace(/\D/g, '');
    if (digits.length < 10) return null;
    return `https://wa.me/${digits.startsWith('55') ? digits : '55' + digits}`;
  }

  instagramUrl(): string | null {
    const handle = (this.seller()?.shopInstagram || '').replace(/^@+/, '').trim();
    return handle ? `https://instagram.com/${encodeURIComponent(handle)}` : null;
  }

  instagramHandle(): string {
    return '@' + (this.seller()?.shopInstagram || '').replace(/^@+/, '').trim();
  }

  async reportSeller() {
    const seller = this.seller();
    if (!seller || !requireAccount(this.router)) return;
    const modal = await this.modalCtrl.create({
      component: ReportModalComponent,
      componentProps: {
        targetType: 'seller',
        targetId: seller.uid,
        sellerId: seller.uid,
        targetName: this.name(),
        targetPhoto: seller.photoURL || null,
      },
    });
    await modal.present();
  }

  async copyCoupon(coupon: Coupon) {
    try {
      await navigator.clipboard.writeText(coupon.code);
      await this.showToast(`Cupom ${coupon.code} copiado. Use no pagamento.`);
    } catch {
      await this.showToast(`Use o cupom ${coupon.code} no pagamento.`);
    }
  }

  // ------------------------------------------------------------ formatação

  couponTitle(c: Coupon): string {
    return couponHeadline(c);
  }

  couponRule(c: Coupon): string {
    return couponShortRule(c).split(' · ').slice(1).join(' · ');
  }

  compact(value: number): string {
    return value.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  }

  ratingLabel(value: number): string {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  reviewDate(review: ProductReview): string {
    return formatDay(toDate(review.createdAt), true);
  }

  private async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastCtrl.create({ message, color, duration: 2400, position: 'top' });
    await toast.present();
  }
}
