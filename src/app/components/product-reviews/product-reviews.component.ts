import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { of, switchMap } from 'rxjs';
import { requireAccount } from '../../core/auth-redirect';
import { onAuthUserChanged } from '../../core/auth-state';
import { Product } from '../../interfaces/product';
import { ProductReview } from '../../interfaces/review';
import {
  ProductReviewsService,
  REVIEW_MAX_LENGTH,
  ReviewEligibility,
} from '../../services/product-reviews.service';

type ReviewSort = 'recentes' | 'melhores' | 'piores';

const STAR_LABELS = ['', 'Péssimo', 'Ruim', 'Regular', 'Bom', 'Excelente'];
const COLLAPSED_COUNT = 5;

/**
 * "Opiniões do produto": nota média com distribuição por estrela, filtros,
 * lista e o formulário de avaliação.
 *
 * Só quem comprou avalia. O componente consulta a elegibilidade para decidir o
 * que mostrar, mas quem garante são as regras do Firestore e a Cloud Function
 * `onProductReviewWritten`, que também marca a compra como verificada.
 */
@Component({
  selector: 'app-product-reviews',
  templateUrl: './product-reviews.component.html',
  styleUrls: ['./product-reviews.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductReviewsComponent {
  readonly product = input.required<Product>();

  private readonly reviewsService = inject(ProductReviewsService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastController);

  readonly maxLength = REVIEW_MAX_LENGTH;
  readonly starLabels = STAR_LABELS;
  readonly stars = [1, 2, 3, 4, 5];

  private readonly productId = computed(() => this.product().id ?? '');

  readonly reviews = toSignal(
    toObservable(this.productId).pipe(
      switchMap(id => (id ? this.reviewsService.watchReviews(id) : of([] as ProductReview[])))
    ),
    { initialValue: [] as ProductReview[] }
  );

  readonly summary = computed(() => this.reviewsService.summarize(this.product(), this.reviews()));

  readonly starFilter = signal<number | null>(null);
  readonly sort = signal<ReviewSort>('recentes');
  readonly expanded = signal(false);

  readonly filtered = computed(() => {
    const filter = this.starFilter();
    const list = this.reviews().filter(r => filter === null || Math.round(r.rating) === filter);
    const sort = this.sort();
    if (sort === 'melhores') return [...list].sort((a, b) => b.rating - a.rating);
    if (sort === 'piores') return [...list].sort((a, b) => a.rating - b.rating);
    return list;
  });

  readonly visible = computed(() => (this.expanded() ? this.filtered() : this.filtered().slice(0, COLLAPSED_COUNT)));

  // ---------------------------------------------------------------- formulário
  readonly eligibility = signal<ReviewEligibility | null>(null);
  readonly formOpen = signal(false);
  readonly draftRating = signal(0);
  readonly hoverRating = signal(0);
  readonly draftComment = signal('');
  readonly saving = signal(false);

  readonly myReview = computed(() => {
    const e = this.eligibility();
    return e?.kind === 'can-review' ? e.existing : null;
  });

  private readonly authTick = signal(0);

  constructor() {
    const stop = onAuthUserChanged(() => this.authTick.update(n => n + 1));
    inject(DestroyRef).onDestroy(stop);

    // Depende só do id e da sessão: o produto chega em tempo real, e a nota
    // recalculada pela função não deve repetir a consulta de pedidos.
    effect(() => {
      this.productId();
      this.authTick();
      const product = untracked(this.product);
      this.eligibility.set(null);
      this.formOpen.set(false);
      this.reviewsService
        .getEligibility(product)
        .then(result => this.eligibility.set(result))
        .catch(() => this.eligibility.set({ kind: 'not-buyer' }));
    });
  }

  toggleStarFilter(stars: number) {
    this.starFilter.update(current => (current === stars ? null : stars));
    this.expanded.set(false);
  }

  openForm() {
    if (!requireAccount(this.router)) return;
    const existing = this.myReview();
    this.draftRating.set(existing?.rating ?? 0);
    this.draftComment.set(existing?.comment ?? '');
    this.formOpen.set(true);
  }

  cancelForm() {
    this.formOpen.set(false);
  }

  async submit() {
    const e = this.eligibility();
    const productId = this.productId();
    if (e?.kind !== 'can-review' || !productId || this.saving()) return;

    if (this.draftRating() < 1) {
      this.showToast('Escolha de 1 a 5 estrelas.', 'warning');
      return;
    }

    this.saving.set(true);
    try {
      await this.reviewsService.saveReview(
        productId,
        { rating: this.draftRating(), comment: this.draftComment(), orderId: e.orderId },
        e.existing
      );
      this.formOpen.set(false);
      this.showToast(e.existing ? 'Avaliação atualizada.' : 'Avaliação publicada. Obrigado!', 'success');
      this.eligibility.set(await this.reviewsService.getEligibility(this.product()));
    } catch (error) {
      console.error('Falha ao salvar avaliação:', error);
      this.showToast('Não foi possível publicar a avaliação. Tente de novo.', 'danger');
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    const productId = this.productId();
    if (!productId || this.saving()) return;
    this.saving.set(true);
    try {
      await this.reviewsService.deleteReview(productId);
      this.formOpen.set(false);
      this.showToast('Avaliação excluída.', 'medium');
      this.eligibility.set(await this.reviewsService.getEligibility(this.product()));
    } catch {
      this.showToast('Não foi possível excluir a avaliação.', 'danger');
    } finally {
      this.saving.set(false);
    }
  }

  goToLogin() {
    requireAccount(this.router);
  }

  formatAverage(value: number): string {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  formatDate(value: any): string {
    const date: Date | null = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
    if (!date) return 'agora';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Preenchimento de cada estrela (0 a 1), para notas quebradas como 4,5. */
  starFill(rating: number, star: number): number {
    return Math.max(0, Math.min(1, rating - (star - 1)));
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toast.create({ message, color, duration: 2600, position: 'bottom' });
    await toast.present();
  }
}
