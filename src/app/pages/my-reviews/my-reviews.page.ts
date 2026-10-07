import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertController, IonicModule, ModalController, NavController, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { onAuthUserChanged } from '../../core/auth-state';
import { formatDay, toDate } from '../../core/order-stage';
import { openReviewComposer } from '../../components/review-composer/review-composer.component';
import { ReviewPhotoViewerComponent } from '../../components/review-photo-viewer/review-photo-viewer.component';
import { ReviewStarsComponent } from '../../components/review-stars/review-stars.component';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { Order } from '../../interfaces/order';
import { PendingReview, ProductReview } from '../../interfaces/review';
import { FirebaseProducts } from '../../services/firebase-products';
import { OrdersService } from '../../services/orders.service';
import {
  LISTING_MATCH_LABEL, ProductReviewsService, REPLY_MAX_LENGTH, STAR_LABELS, reviewPhotoUrl, reviewPhotos,
} from '../../services/product-reviews.service';

type Tab = 'pendentes' | 'feitas' | 'loja';
type StoreFilter = 'all' | 'unanswered' | 'low' | 'photos';

const TAB_IDS: Tab[] = ['pendentes', 'feitas', 'loja'];

/**
 * Minhas avaliações.
 *
 * - "Para avaliar": o que já foi entregue e ainda não tem avaliação, com as
 *   estrelas na própria lista (tocar numa já abre a janela com a nota).
 * - "Avaliadas": o que a pessoa escreveu, com "útil", resposta da loja,
 *   editar e excluir.
 * - "Da sua loja" (só para quem anuncia): nota geral da loja e as avaliações
 *   dos produtos dela, para responder em público.
 *
 * `?aba=pendentes|feitas|loja` escolhe a aba; `?pedido=<id>` (vem do aviso
 * "Pedido entregue") põe os produtos daquele pedido na frente.
 */
@Component({
  selector: 'app-my-reviews',
  templateUrl: './my-reviews.page.html',
  styleUrls: ['./my-reviews.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, RouterModule, VnIconComponent, ReviewStarsComponent],
})
export class MyReviewsPage {
  private readonly reviews = inject(ProductReviewsService);
  private readonly ordersService = inject(OrdersService);
  private readonly products = inject(FirebaseProducts);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly navCtrl = inject(NavController);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly stars = [1, 2, 3, 4, 5];
  readonly starLabels = STAR_LABELS;
  readonly matchLabel = LISTING_MATCH_LABEL;
  readonly replyMax = REPLY_MAX_LENGTH;
  readonly photosOf = reviewPhotos;
  readonly photoUrl = reviewPhotoUrl;

  readonly uid = signal<string | null>(null);
  readonly tab = signal<Tab>('pendentes');
  readonly highlightOrder = signal<string | null>(null);

  readonly orders = signal<Order[] | null>(null);
  readonly mine = signal<ProductReview[] | null>(null);
  readonly store = signal<ProductReview[] | null>(null);
  readonly productCount = signal(0);
  readonly failed = signal(false);
  readonly storeFailed = signal(false);

  /** Estrela sob o dedo/mouse em cada cartão de "Para avaliar". */
  readonly hover = signal<{ key: string; star: number } | null>(null);
  readonly busy = signal<string | null>(null);

  readonly storeFilter = signal<StoreFilter>('all');
  /** Avaliação (uid do autor + produto) com a caixa de resposta aberta. */
  readonly replying = signal<string | null>(null);
  replyDraft = '';

  private subs: Subscription[] = [];

  // ------------------------------------------------------------- derivados

  readonly pending = computed<PendingReview[] | null>(() => {
    const orders = this.orders();
    const mine = this.mine();
    const uid = this.uid();
    if (!orders || !mine || !uid) return null;
    const list = this.reviews.pendingFrom(orders, mine, uid);
    const first = this.highlightOrder();
    return first ? [...list.filter(p => p.orderId === first), ...list.filter(p => p.orderId !== first)] : list;
  });

  readonly loading = computed(() => !this.failed() && (this.pending() === null || this.mine() === null));

  /** A aba da loja aparece para quem anuncia ou já recebeu avaliação. */
  readonly isSeller = computed(() => this.productCount() > 0 || (this.store()?.length ?? 0) > 0);

  readonly storeSummary = computed(() => {
    const list = this.store() ?? [];
    const count = list.length;
    const average = count ? list.reduce((s, r) => s + r.rating, 0) / count : 0;
    const answered = list.filter(r => r.matchesListing);
    return {
      count,
      average: Math.round(average * 10) / 10,
      unanswered: list.filter(r => !r.sellerReply?.text).length,
      withPhotos: list.filter(r => reviewPhotos(r).length).length,
      listingYes: answered.length ? Math.round((answered.filter(r => r.matchesListing === 'yes').length / answered.length) * 100) : null,
      bars: [5, 4, 3, 2, 1].map(stars => {
        const n = list.filter(r => Math.round(r.rating) === stars).length;
        return { stars, count: n, percent: count ? Math.round((n / count) * 100) : 0 };
      }),
    };
  });

  readonly storeList = computed(() => {
    const list = this.store() ?? [];
    switch (this.storeFilter()) {
      case 'unanswered': return list.filter(r => !r.sellerReply?.text);
      case 'low': return list.filter(r => r.rating <= 2);
      case 'photos': return list.filter(r => reviewPhotos(r).length);
      default: return list;
    }
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const stopAuth = onAuthUserChanged(user => this.bind(user?.uid ?? null));
    destroyRef.onDestroy(() => {
      stopAuth();
      this.unbind();
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const aba = params.get('aba') as Tab | null;
      const pedido = params.get('pedido');
      if (pedido) {
        this.highlightOrder.set(pedido);
        this.tab.set('pendentes');
      } else if (aba && TAB_IDS.includes(aba)) {
        this.tab.set(aba);
      }
    });
  }

  private bind(uid: string | null) {
    if (uid === this.uid()) return;
    this.unbind();
    this.uid.set(uid);
    this.orders.set(null);
    this.mine.set(null);
    this.store.set(null);
    this.failed.set(false);
    this.storeFailed.set(false);
    if (!uid) return;

    const fail = (what: string) => (err: unknown) => {
      console.error(`[minhas avaliações] falha ao ler ${what}`, err);
      this.failed.set(true);
    };

    this.subs = [
      this.ordersService.getUserOrders(uid).subscribe({ next: list => this.orders.set(list), error: fail('pedidos') }),
      this.reviews.watchMine(uid).subscribe({ next: list => this.mine.set(list), error: fail('avaliações') }),
      this.reviews.watchStore(uid).subscribe({
        next: list => this.store.set(list),
        error: err => {
          console.error('[minhas avaliações] falha ao ler avaliações da loja', err);
          this.storeFailed.set(true);
          this.store.set([]);
        },
      }),
      this.products.getBySeller(uid, true).subscribe({
        next: list => this.productCount.set(list.length),
        error: () => this.productCount.set(0),
      }),
    ];
  }

  private unbind() {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
  }

  // ------------------------------------------------------------------ abas

  selectTab(tab: Tab) {
    this.tab.set(tab);
    void this.router.navigate([], { queryParams: { aba: tab, pedido: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  goBack() {
    this.navCtrl.back();
  }

  // ------------------------------------------------------------ para avaliar

  async rate(item: PendingReview, star = 0) {
    if (this.busy()) return;
    this.busy.set(item.key);
    try {
      const saved = await openReviewComposer(this.modalCtrl, {
        productId: item.productId,
        productName: item.name,
        productPhoto: item.photo,
        orderId: item.orderId,
        variant: item.variant,
        deliveredAt: item.deliveredAt,
        initialRating: star,
      });
      // A lista se atualiza sozinha (tempo real); só falta trocar de aba se acabou.
      if (saved && this.pending()?.length === 0) this.selectTab('feitas');
    } finally {
      this.busy.set(null);
      this.hover.set(null);
    }
  }

  starOn(item: PendingReview, star: number): boolean {
    const h = this.hover();
    return !!h && h.key === item.key && h.star >= star;
  }

  // --------------------------------------------------------------- avaliadas

  async edit(review: ProductReview) {
    if (!review.productId || this.busy()) return;
    this.busy.set(review.productId);
    try {
      await openReviewComposer(this.modalCtrl, {
        productId: review.productId,
        productName: review.productName || 'Produto',
        productPhoto: review.productPhoto,
        orderId: review.orderId,
        existing: review,
      });
    } finally {
      this.busy.set(null);
    }
  }

  async remove(review: ProductReview) {
    if (!review.productId) return;
    const alert = await this.alertCtrl.create({
      header: 'Excluir avaliação?',
      message: 'Ela sai do anúncio e da nota do produto. Depois, se quiser, você pode avaliar de novo.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Excluir', role: 'destructive' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;

    this.busy.set(review.productId);
    try {
      await this.reviews.deleteReview(review.productId);
      this.toast('Avaliação excluída.');
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível excluir agora. Tente de novo.', 'danger');
    } finally {
      this.busy.set(null);
    }
  }

  async openPhotos(review: ProductReview, start: number) {
    const modal = await this.modalCtrl.create({
      component: ReviewPhotoViewerComponent,
      componentProps: {
        urls: reviewPhotos(review).map(reviewPhotoUrl),
        start,
        caption: review.productName || '',
      },
      cssClass: 'vn-photo-viewer',
    });
    await modal.present();
  }

  // -------------------------------------------------------------------- loja

  replyKey(review: ProductReview): string {
    return `${review.productId}~${review.userId}`;
  }

  startReply(review: ProductReview) {
    this.replying.set(this.replyKey(review));
    this.replyDraft = review.sellerReply?.text ?? '';
    setTimeout(() => document.getElementById(`reply-${this.replyKey(review)}`)?.focus(), 60);
  }

  cancelReply() {
    this.replying.set(null);
    this.replyDraft = '';
  }

  async sendReply(review: ProductReview) {
    const text = this.replyDraft.trim();
    if (!review.productId || text.length < 2 || this.busy()) return;
    this.busy.set(this.replyKey(review));
    try {
      await this.reviews.saveReply(review.productId, review.userId, text, review.sellerReply ?? null);
      this.cancelReply();
      this.toast(review.sellerReply ? 'Resposta atualizada.' : 'Resposta publicada no anúncio.', 'success');
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível publicar a resposta. Tente de novo.', 'danger');
    } finally {
      this.busy.set(null);
    }
  }

  async removeReply(review: ProductReview) {
    if (!review.productId) return;
    const alert = await this.alertCtrl.create({
      header: 'Apagar resposta?',
      message: 'A resposta sai do anúncio. A avaliação continua.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Apagar', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    try {
      await this.reviews.deleteReply(review.productId, review.userId);
      this.toast('Resposta apagada.');
    } catch {
      this.toast('Não foi possível apagar a resposta.', 'danger');
    }
  }

  // ------------------------------------------------------------------ apoio

  day(value: unknown): string {
    return formatDay(toDate(value), true) || 'agora';
  }

  /** Editada depois de um dia da publicação: vale mostrar. */
  edited(review: ProductReview): boolean {
    const created = toDate(review.createdAt)?.getTime();
    const updated = toDate(review.updatedAt)?.getTime();
    return !!created && !!updated && updated - created > 60_000;
  }

  formatAverage(value: number): string {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  private async toast(message: string, color = 'dark') {
    const t = await this.toastCtrl.create({ message, color, duration: 2600, position: 'bottom' });
    await t.present();
  }
}
