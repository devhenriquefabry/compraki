import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { of, switchMap } from 'rxjs';
import { requireAccount } from '../../core/auth-redirect';
import { getCurrentUser, onAuthUserChanged } from '../../core/auth-state';
import { formatDay, toDate } from '../../core/order-stage';
import { Product } from '../../interfaces/product';
import { ProductReview } from '../../interfaces/review';
import {
  ProductReviewsService,
  ReviewEligibility,
  STAR_LABELS,
  reviewPhotoUrl,
  reviewPhotos,
} from '../../services/product-reviews.service';
import { ReportModalComponent } from '../report-modal/report-modal.component';
import { openReviewComposer } from '../review-composer/review-composer.component';
import { ReviewPhotoViewerComponent } from '../review-photo-viewer/review-photo-viewer.component';
import { ReviewStarsComponent } from '../review-stars/review-stars.component';
import { VnIconComponent } from '../vn-icon/vn-icon.component';

type ReviewSort = 'relevantes' | 'recentes' | 'melhores' | 'piores';

const COLLAPSED_COUNT = 5;
const PHOTO_STRIP_MAX = 8;

/** Voto de "útil" ainda não refletido na contagem do servidor. */
interface PendingVote {
  base: number;
  delta: number;
}

/**
 * "Opiniões do produto": nota média com distribuição por estrela, quanto os
 * compradores acharam o produto igual ao anúncio, fotos dos compradores,
 * filtros, lista (com "útil", denúncia e resposta da loja) e a chamada para
 * avaliar.
 *
 * Só quem recebeu o produto avalia. O componente consulta a elegibilidade para
 * decidir o que mostrar, mas quem garante são as regras do Firestore e a Cloud
 * Function `onProductReviewWritten`, que também marca a compra como verificada.
 */
@Component({
  selector: 'app-product-reviews',
  templateUrl: './product-reviews.component.html',
  styleUrls: ['./product-reviews.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, RouterLink, ReviewStarsComponent, VnIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductReviewsComponent {
  readonly product = input.required<Product>();

  private readonly reviewsService = inject(ProductReviewsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toast = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);

  /**
   * `?avaliar=1` (links antigos e o aviso de entrega de versões anteriores):
   * abre a janela assim que a elegibilidade confirmar a compra. Vale uma vez.
   */
  private pendingAutoOpen = this.route.snapshot.queryParamMap.has('avaliar');

  readonly starLabels = STAR_LABELS;
  readonly stars = [1, 2, 3, 4, 5];
  readonly photosOf = reviewPhotos;
  readonly photoUrl = reviewPhotoUrl;

  private readonly productId = computed(() => this.product().id ?? '');

  readonly reviews = toSignal(
    toObservable(this.productId).pipe(
      switchMap(id => (id ? this.reviewsService.watchReviews(id) : of([] as ProductReview[])))
    ),
    { initialValue: [] as ProductReview[] }
  );

  readonly summary = computed(() => this.reviewsService.summarize(this.product(), this.reviews()));

  /** Fotos de todas as avaliações, para a faixa "Fotos dos compradores". */
  readonly allPhotos = computed(() =>
    this.reviews().flatMap(review => reviewPhotos(review).map(path => ({ review, url: reviewPhotoUrl(path) })))
  );
  readonly photoStrip = computed(() => this.allPhotos().slice(0, PHOTO_STRIP_MAX));

  readonly starFilter = signal<number | null>(null);
  readonly photosOnly = signal(false);
  readonly sort = signal<ReviewSort>('relevantes');
  readonly expanded = signal(false);

  readonly filtered = computed(() => {
    const filter = this.starFilter();
    const photosOnly = this.photosOnly();
    const list = this.reviews().filter(r =>
      (filter === null || Math.round(r.rating) === filter) && (!photosOnly || reviewPhotos(r).length > 0));
    const time = (r: ProductReview) => toDate(r.createdAt)?.getTime() ?? Date.now();
    switch (this.sort()) {
      case 'melhores': return [...list].sort((a, b) => b.rating - a.rating || time(b) - time(a));
      case 'piores': return [...list].sort((a, b) => a.rating - b.rating || time(b) - time(a));
      case 'recentes': return list;
      default:
        // Relevantes: mais "útil" primeiro; empate, quem escreveu ou mandou foto; depois a mais nova.
        return [...list].sort((a, b) =>
          (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0)
          || weight(b) - weight(a)
          || time(b) - time(a));
    }
  });

  readonly visible = computed(() => (this.expanded() ? this.filtered() : this.filtered().slice(0, COLLAPSED_COUNT)));

  // ------------------------------------------------------------- quem olha

  readonly eligibility = signal<ReviewEligibility | null>(null);
  readonly busy = signal(false);
  readonly viewerId = signal<string | null>(getCurrentUser()?.uid ?? null);

  readonly myReview = computed(() => {
    const e = this.eligibility();
    return e?.kind === 'can-review' ? e.existing : null;
  });

  /** Avaliações que a pessoa marcou como úteis (uid do autor). */
  readonly myVotes = signal<Set<string>>(new Set());
  private readonly pendingVotes = signal<Map<string, PendingVote>>(new Map());

  private readonly authTick = signal(0);

  constructor() {
    const stop = onAuthUserChanged(user => {
      this.viewerId.set(user?.uid ?? null);
      this.authTick.update(n => n + 1);
    });
    inject(DestroyRef).onDestroy(stop);

    // Depende só do id e da sessão: o produto chega em tempo real, e a nota
    // recalculada pela função não deve repetir a consulta de pedidos.
    effect(() => {
      const productId = this.productId();
      this.authTick();
      const product = untracked(this.product);
      this.eligibility.set(null);
      this.myVotes.set(new Set());
      if (!productId) return;

      void this.reviewsService.getMyVotes(productId).then(ids => this.myVotes.set(new Set(ids)));
      this.reviewsService
        .getEligibility(product)
        .then(result => {
          this.eligibility.set(result);
          if (this.pendingAutoOpen && result.kind === 'can-review') {
            this.pendingAutoOpen = false;
            setTimeout(() => this.host.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
            void this.openComposer();
          }
        })
        .catch(() => this.eligibility.set({ kind: 'not-buyer' }));
    });
  }

  // ---------------------------------------------------------------- filtros

  toggleStarFilter(stars: number) {
    this.starFilter.update(current => (current === stars ? null : stars));
    this.expanded.set(false);
  }

  togglePhotosOnly() {
    this.photosOnly.update(v => !v);
    this.expanded.set(false);
  }

  clearFilters() {
    this.starFilter.set(null);
    this.photosOnly.set(false);
  }

  // ---------------------------------------------------------------- avaliar

  async openComposer() {
    if (!requireAccount(this.router)) return;
    const e = this.eligibility();
    const product = this.product();
    if (e?.kind !== 'can-review' || !product.id || this.busy()) return;

    this.busy.set(true);
    try {
      const saved = await openReviewComposer(this.modalCtrl, {
        productId: product.id,
        productName: product.name,
        productPhoto: product.photoURL?.[0] ?? null,
        orderId: e.orderId,
        existing: e.existing,
      });
      if (saved) this.eligibility.set(await this.reviewsService.getEligibility(product));
    } finally {
      this.busy.set(false);
    }
  }

  goToLogin() {
    requireAccount(this.router);
  }

  // ------------------------------------------------------------------- útil

  isMine(review: ProductReview): boolean {
    return review.userId === this.viewerId();
  }

  voted(review: ProductReview): boolean {
    return this.myVotes().has(review.userId);
  }

  /** Contagem de "útil" com o voto que acabou de ser dado, até o servidor alcançar. */
  helpfulCount(review: ProductReview): number {
    const server = review.helpfulCount ?? 0;
    const pending = this.pendingVotes().get(review.userId);
    return pending && server === pending.base ? Math.max(0, pending.base + pending.delta) : server;
  }

  async toggleHelpful(review: ProductReview) {
    if (!requireAccount(this.router) || this.isMine(review)) return;
    const productId = this.productId();
    const id = review.userId;
    const was = this.myVotes().has(id);

    const next = new Set(this.myVotes());
    if (was) next.delete(id);
    else next.add(id);
    this.myVotes.set(next);

    const pending = new Map(this.pendingVotes());
    const current = pending.get(id);
    const base = current && (review.helpfulCount ?? 0) === current.base ? current.base : review.helpfulCount ?? 0;
    const delta = (current && base === current.base ? current.delta : 0) + (was ? -1 : 1);
    pending.set(id, { base, delta });
    this.pendingVotes.set(pending);

    try {
      await this.reviewsService.setVotes(productId, [...next]);
    } catch (err) {
      console.error('Falha ao registrar voto', err);
      const rollback = new Set(this.myVotes());
      if (was) rollback.add(id);
      else rollback.delete(id);
      this.myVotes.set(rollback);
      const undo = new Map(this.pendingVotes());
      undo.delete(id);
      this.pendingVotes.set(undo);
      this.showToast('Não foi possível registrar agora.', 'danger');
    }
  }

  // ---------------------------------------------------------- denúncia/fotos

  async report(review: ProductReview) {
    const product = this.product();
    if (!requireAccount(this.router) || !product.id || this.isMine(review)) return;
    const modal = await this.modalCtrl.create({
      component: ReportModalComponent,
      componentProps: {
        targetType: 'review',
        targetId: `${product.id}~${review.userId}`,
        sellerId: review.userId,
        targetName: `Avaliação de ${review.userName} em ${product.name}`.slice(0, 200),
        targetPhoto: product.photoURL?.[0] ?? null,
      },
    });
    await modal.present();
  }

  async openPhotos(review: ProductReview, start: number) {
    const modal = await this.modalCtrl.create({
      component: ReviewPhotoViewerComponent,
      componentProps: { urls: reviewPhotos(review).map(reviewPhotoUrl), start, caption: `${review.userName} · ${review.rating} de 5` },
      cssClass: 'vn-photo-viewer',
    });
    await modal.present();
  }

  /** Faixa "Fotos dos compradores": abre todas, em sequência. */
  async openStrip(start: number) {
    const modal = await this.modalCtrl.create({
      component: ReviewPhotoViewerComponent,
      componentProps: { urls: this.allPhotos().map(p => p.url), start, caption: 'Fotos dos compradores' },
      cssClass: 'vn-photo-viewer',
    });
    await modal.present();
  }

  // ---------------------------------------------------------------- formato

  formatAverage(value: number): string {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  formatDate(value: any): string {
    return formatDay(toDate(value), true) || 'agora';
  }

  edited(review: ProductReview): boolean {
    const created = toDate(review.createdAt)?.getTime();
    const updated = toDate(review.updatedAt)?.getTime();
    return !!created && !!updated && updated - created > 60_000;
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toast.create({ message, color, duration: 2600, position: 'bottom' });
    await toast.present();
  }
}

/** Avaliação com foto e texto pesa mais que só a nota. */
function weight(review: ProductReview): number {
  return (reviewPhotos(review).length ? 2 : 0) + ((review.comment || '').trim().length > 40 ? 1 : 0);
}
