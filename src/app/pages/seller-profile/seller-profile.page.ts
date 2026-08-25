import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  bagHandleOutline,
  bicycleOutline,
  calendarOutline,
  cardOutline,
  chatbubblesOutline,
  checkmarkCircle,
  chevronForwardOutline,
  createOutline,
  cubeOutline,
  gridOutline,
  heart,
  heartOutline,
  imagesOutline,
  logoInstagram,
  logoWhatsapp,
  pricetagOutline,
  ribbon,
  shieldCheckmarkOutline,
  star,
  storefrontOutline,
  timeOutline
} from 'ionicons/icons';
import { Observable, Subject, combineLatest, from, of } from 'rxjs';
import { map, shareReplay, switchMap, takeUntil } from 'rxjs/operators';

import { PublicSellerProfile } from 'src/app/interfaces/seller';
import { Product } from 'src/app/interfaces/product';
import { ChatBoxComponent } from 'src/app/components/chat-box/chat-box.component';
import { MiniHeaderComponent } from 'src/app/components/mini-header/mini-header.component';
import { FirebaseChatService } from 'src/app/services/firebase-chat.service';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseUsersService } from 'src/app/services/firebase-users.service';

interface SellerStats {
  productCount: number;
  activeProductCount: number;
  soldCount: number;
  averageRating: number | null;
  paymentMethods: string[];
  shippingMethods: string[];
}

@Component({
  selector: 'app-seller-profile',
  templateUrl: './seller-profile.page.html',
  styleUrls: ['./seller-profile.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, MiniHeaderComponent, ChatBoxComponent]
})
export class SellerProfilePage implements OnInit, OnDestroy {
  public seller$!: Observable<PublicSellerProfile | null>;
  public products$!: Observable<Product[]>;
  public stats$!: Observable<SellerStats>;
  public followerCount$!: Observable<number>;
  public isFollowing$!: Observable<boolean>;
  public isChatOpen = false;
  public activeChatId = '';
  public currentUserId = '';
  public isFollowActionBusy = false;
  public isFollowingSeller = false;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toastCtrl = inject(ToastController);
  private productsService = inject(FirebaseProducts);
  private usersService = inject(FirebaseUsersService);
  private chatService = inject(FirebaseChatService);
  private destroy$ = new Subject<void>();

  constructor() {
    addIcons({
      alertCircleOutline,
      bagHandleOutline,
      bicycleOutline,
      calendarOutline,
      cardOutline,
      chatbubblesOutline,
      checkmarkCircle,
      chevronForwardOutline,
      createOutline,
      cubeOutline,
      gridOutline,
      heart,
      heartOutline,
      imagesOutline,
      logoInstagram,
      logoWhatsapp,
      pricetagOutline,
      ribbon,
      shieldCheckmarkOutline,
      star,
      storefrontOutline,
      timeOutline
    });
  }

  ngOnInit() {
    this.currentUserId = this.productsService.getUser()?.uid || '';

    const sellerId$ = this.route.paramMap.pipe(
      map(params => params.get('sellerId') || this.productsService.getUser()?.uid || ''),
      shareReplay(1)
    );

    this.seller$ = sellerId$.pipe(
      // Perfil PUBLICO (`sellers/{uid}`). Vale tambem para o proprio dono:
      // o espelho e mantido pela Cloud Function `syncSellerProfile`.
      switchMap(sellerId => sellerId ? from(this.usersService.getPublicSellerProfile(sellerId)) : of(null)),
      shareReplay(1)
    );

    this.products$ = sellerId$.pipe(
      switchMap(sellerId => sellerId ? this.productsService.getBySeller(sellerId) : of([])),
      shareReplay(1)
    );

    this.stats$ = this.products$.pipe(
      map(products => this.buildStats(products)),
      shareReplay(1)
    );

    this.followerCount$ = sellerId$.pipe(
      switchMap(sellerId => sellerId ? this.usersService.getSellerFollowerCount(sellerId) : of(0)),
      shareReplay(1)
    );

    this.isFollowing$ = sellerId$.pipe(
      switchMap(sellerId => sellerId ? this.usersService.isFollowingSeller(sellerId) : of(false)),
      shareReplay(1)
    );

    this.isFollowing$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isFollowing => {
        this.isFollowingSeller = isFollowing;
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public isOwnProfile(seller: PublicSellerProfile): boolean {
    return !!seller.uid && seller.uid === this.currentUserId;
  }

  public getDisplayName(seller: PublicSellerProfile): string {
    return seller.shopName || seller.displayName || seller.username || 'Vendedor Compraki';
  }

  public getInitials(seller: PublicSellerProfile | null): string {
    const source = seller ? this.getDisplayName(seller) : 'VC';
    return source
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase() || 'VC';
  }

  public getMemberSinceLabel(seller: PublicSellerProfile): string {
    const createdAt = this.toDate(seller.createdAt);
    if (!createdAt) return '';

    return createdAt.toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric'
    });
  }

  public getLatestProductLabel(products: Product[]): string {
    const dates = products
      .map(product => this.toDate(product.createdAt))
      .filter((date): date is Date => !!date)
      .sort((a, b) => b.getTime() - a.getTime());

    if (!dates.length) return '';
    return dates[0].toLocaleDateString('pt-BR');
  }

  public formatCount(value: number): string {
    return value.toLocaleString('pt-BR');
  }

  public formatCompactCount(value: number): string {
    return value.toLocaleString('pt-BR', {
      notation: 'compact',
      maximumFractionDigits: 1
    });
  }

  public formatRating(value: number | null): string {
    return value === null ? '-' : value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  public formatPrice(price: number): string {
    return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  public getProductImage(product: Product): string {
    return product.photoURL?.[0] || 'assets/imagens/imagem-placeholder.png';
  }

  public goToProduct(product: Product) {
    if (!product.id) return;
    this.router.navigate(['/product-details', product.id]);
  }

  public editSellerProfile() {
    this.router.navigate(['/my-showcase']);
  }

  public async toggleFollow(seller: PublicSellerProfile) {
    if (this.isOwnProfile(seller) || this.isFollowActionBusy) return;

    this.isFollowActionBusy = true;
    try {
      if (this.isFollowingSeller) {
        await this.usersService.unfollowSeller(seller.uid);
        await this.showToast('Você deixou de seguir este vendedor.');
      } else {
        await this.usersService.followSeller(seller);
        await this.showToast('Agora você segue este vendedor.');
      }
    } catch (error) {
      console.error('Falha ao atualizar seguimento:', error);
      await this.showToast('Não foi possível atualizar o seguimento.', 'danger');
    } finally {
      this.isFollowActionBusy = false;
    }
  }

  public async startChat(seller: PublicSellerProfile) {
    if (this.isOwnProfile(seller)) {
      this.editSellerProfile();
      return;
    }

    try {
      const chatId = await this.chatService.startChat({
        uid: seller.uid,
        name: this.getDisplayName(seller),
        photoUrl: seller.photoURL || undefined
      });
      this.activeChatId = chatId;
      this.isChatOpen = true;
    } catch (error) {
      console.error('Falha ao iniciar conversa com vendedor:', error);
      await this.showToast('Não foi possível iniciar a conversa.', 'danger');
    }
  }

  public closeChat() {
    this.isChatOpen = false;
    this.activeChatId = '';
  }

  public openWhatsApp(phone?: string | null) {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return;
    const normalizedPhone = digits.startsWith('55') ? digits : `55${digits}`;
    window.open(`https://wa.me/${normalizedPhone}`, '_blank', 'noopener');
  }

  public openInstagram(username?: string | null) {
    const handle = (username || '').replace('@', '').trim();
    if (!handle) return;
    window.open(`https://instagram.com/${handle}`, '_blank', 'noopener');
  }

  private buildStats(products: Product[]): SellerStats {
    const ratings = products
      .map(product => product.rating)
      .filter((rating): rating is number => typeof rating === 'number' && !Number.isNaN(rating));

    const paymentMethods = Array.from(new Set(products.flatMap(product => product.paymentMethods || [])));
    const shippingMethods = Array.from(new Set(products.map(product => product.shipping).filter(Boolean)));

    return {
      productCount: products.length,
      activeProductCount: products.filter(product => product.stock > 0).length,
      soldCount: products.reduce((total, product) => total + (product.soldCount || 0), 0),
      averageRating: ratings.length ? ratings.reduce((total, rating) => total + rating, 0) / ratings.length : null,
      paymentMethods,
      shippingMethods
    };
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      color,
      duration: 2400,
      position: 'top'
    });
    await toast.present();
  }
}
