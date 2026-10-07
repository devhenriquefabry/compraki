import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ModalController, ToastController } from '@ionic/angular';

import { getCurrentUser } from '../../core/auth-state';
import { formatDay } from '../../core/order-stage';
import { ListingMatch, ProductReview } from '../../interfaces/review';
import {
  LISTING_MATCH_LABEL, ProductReviewsService, REVIEW_MAX_LENGTH, REVIEW_MAX_PHOTOS, STAR_LABELS,
  publicReviewerName, reviewPhotoUrl, reviewPhotos,
} from '../../services/product-reviews.service';
import { VnIconComponent } from '../vn-icon/vn-icon.component';

/** Foto na grade: já publicada, subindo ou pronta (só nesta edição). */
interface DraftPhoto {
  id: string;
  path: string | null;
  url: string;
  uploading: boolean;
  /** Subiu nesta janela: se a pessoa desistir, o arquivo é apagado. */
  fresh: boolean;
}

export interface ReviewComposerResult {
  saved: boolean;
}

/** Placeholder do comentário conforme a nota: pergunta o que ajuda de verdade. */
const COMMENT_PROMPTS = [
  'O que você achou da qualidade? Chegou como esperava? Indicaria para alguém?',
  'O que deu errado? Contar ajuda outros compradores e a loja a corrigir.',
  'O que deu errado? Contar ajuda outros compradores e a loja a corrigir.',
  'O que poderia ser melhor? E o que funcionou bem?',
  'O que você mais gostou? Como está a qualidade depois de usar?',
  'O que fez valer a pena? Qualidade, acabamento, tamanho, custo-benefício...',
];

/**
 * Janela de avaliar um produto (nova avaliação ou edição): nota, "como no
 * anúncio?", comentário e até 5 fotos. Abrir pelo `openReviewComposer()`.
 *
 * `@Input()` comum, não signal input: o ModalController grava `componentProps`
 * direto na instância (ver notificacoes.md).
 */
@Component({
  selector: 'app-review-composer',
  templateUrl: './review-composer.component.html',
  styleUrls: ['./review-composer.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, VnIconComponent],
})
export class ReviewComposerComponent implements OnInit {
  @Input({ required: true }) productId!: string;
  @Input({ required: true }) productName!: string;
  @Input() productPhoto: string | null = null;
  @Input({ required: true }) orderId!: string;
  @Input() variant: string | null = null;
  @Input() deliveredAt: Date | null = null;
  @Input() existing: ProductReview | null = null;
  /** Nota já tocada antes de abrir (estrelas da lista "Para avaliar"). */
  @Input() initialRating = 0;

  private readonly service = inject(ProductReviewsService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly stars = [1, 2, 3, 4, 5];
  readonly starLabels = STAR_LABELS;
  readonly maxLength = REVIEW_MAX_LENGTH;
  readonly maxPhotos = REVIEW_MAX_PHOTOS;
  readonly matchOptions: { id: ListingMatch; label: string }[] = [
    { id: 'yes', label: 'Sim' },
    { id: 'partly', label: 'Em parte' },
    { id: 'no', label: 'Não' },
  ];
  readonly matchLabel = LISTING_MATCH_LABEL;

  readonly rating = signal(0);
  readonly hover = signal(0);
  readonly match = signal<ListingMatch | null>(null);
  readonly comment = signal('');
  readonly photos = signal<DraftPhoto[]>([]);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly shownRating = computed(() => this.hover() || this.rating());
  readonly prompt = computed(() => COMMENT_PROMPTS[this.rating()] ?? COMMENT_PROMPTS[0]);
  readonly uploading = computed(() => this.photos().some(p => p.uploading));
  readonly canAddPhoto = computed(() => this.photos().length < REVIEW_MAX_PHOTOS);
  readonly canSave = computed(() => this.rating() > 0 && !this.uploading() && !this.saving());

  publicName = '';
  deliveredLabel = '';

  ngOnInit() {
    const user = getCurrentUser();
    this.publicName = publicReviewerName(user?.displayName ?? null, user?.email ?? null);
    this.deliveredLabel = this.deliveredAt ? `Entregue em ${formatDay(this.deliveredAt, true)}` : '';

    const e = this.existing;
    this.rating.set(e?.rating ?? this.initialRating ?? 0);
    this.match.set(e?.matchesListing ?? null);
    this.comment.set(e?.comment ?? '');
    this.photos.set(e ? reviewPhotos(e).map(path => ({ id: path, path, url: reviewPhotoUrl(path), uploading: false, fresh: false })) : []);
  }

  pick(star: number) {
    this.rating.set(star);
    this.error.set('');
  }

  /** Setas mudam a nota, como num grupo de rádio. */
  onStarsKey(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    this.pick(Math.min(5, Math.max(1, (this.rating() || 0) + step)));
    const next = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-star="${this.rating()}"]`);
    next?.focus();
  }

  toggleMatch(id: ListingMatch) {
    this.match.update(current => (current === id ? null : id));
  }

  // ----------------------------------------------------------------- fotos

  async onFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const room = REVIEW_MAX_PHOTOS - this.photos().length;
    if (files.length > room) this.toast(`Dá para enviar até ${REVIEW_MAX_PHOTOS} fotos. Ficaram as primeiras ${room}.`);

    await Promise.all(files.slice(0, Math.max(0, room)).map(file => this.upload(file)));
  }

  private async upload(file: File) {
    if (!file.type.startsWith('image/')) {
      this.toast('Escolha uma imagem (JPG, PNG ou WebP).');
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const preview = URL.createObjectURL(file);
    this.photos.update(list => [...list, { id, path: null, url: preview, uploading: true, fresh: true }]);
    try {
      const path = await this.service.uploadPhoto(this.productId, file);
      this.photos.update(list => list.map(p => (p.id === id ? { ...p, path, uploading: false } : p)));
    } catch (err) {
      console.error('Falha ao enviar foto da avaliação', err);
      this.photos.update(list => list.filter(p => p.id !== id));
      URL.revokeObjectURL(preview);
      this.toast('Não deu para enviar uma das fotos. Tente uma imagem menor.');
    }
  }

  removePhoto(photo: DraftPhoto) {
    if (photo.uploading) return;
    this.photos.update(list => list.filter(p => p.id !== photo.id));
    // Foto já publicada sai do Storage pela função quando a avaliação salva.
    if (photo.fresh && photo.path) void this.service.discardPhoto(photo.path);
  }

  // --------------------------------------------------------------- publicar

  async save() {
    if (this.rating() < 1) {
      this.error.set('Toque nas estrelas para dar sua nota.');
      return;
    }
    if (!this.canSave()) return;

    this.saving.set(true);
    this.error.set('');
    try {
      await this.service.saveReview(this.productId, {
        rating: this.rating(),
        comment: this.comment(),
        orderId: this.orderId,
        photos: this.photos().map(p => p.path).filter((p): p is string => !!p),
        matchesListing: this.match(),
      }, this.existing);
      await this.toast(this.existing ? 'Avaliação atualizada.' : 'Avaliação publicada. Obrigado por contar!', 'success');
      await this.modalCtrl.dismiss({ saved: true } satisfies ReviewComposerResult, 'saved');
    } catch (err: any) {
      console.error('Falha ao salvar avaliação', err);
      this.error.set(err?.code === 'permission-denied'
        ? 'Não foi possível publicar: a avaliação só abre depois que o pedido é marcado como entregue.'
        : 'Não foi possível publicar agora. Confira a conexão e tente de novo.');
    } finally {
      this.saving.set(false);
    }
  }

  async close() {
    if (this.saving()) return;
    if (this.isDirty()) {
      const alert = await this.alertCtrl.create({
        header: 'Sair sem publicar?',
        message: 'O que você escreveu nesta avaliação vai ser descartado.',
        buttons: [
          { text: 'Continuar avaliando', role: 'cancel' },
          { text: 'Descartar', role: 'destructive' },
        ],
      });
      await alert.present();
      if ((await alert.onDidDismiss()).role !== 'destructive') return;
    }
    for (const photo of this.photos()) {
      if (photo.fresh && photo.path) void this.service.discardPhoto(photo.path);
    }
    await this.modalCtrl.dismiss({ saved: false } satisfies ReviewComposerResult, 'cancel');
  }

  private isDirty(): boolean {
    const e = this.existing;
    if (!e) return this.rating() !== (this.initialRating || 0) || !!this.comment().trim() || this.photos().length > 0 || !!this.match();
    return this.rating() !== e.rating
      || this.comment() !== (e.comment ?? '')
      || this.match() !== (e.matchesListing ?? null)
      || this.photos().some(p => p.fresh)
      || this.photos().length !== reviewPhotos(e).length;
  }

  private async toast(message: string, color = 'dark') {
    const t = await this.toastCtrl.create({ message, color, duration: 2600, position: 'bottom' });
    await t.present();
  }
}

/** Abre a janela de avaliar e diz se a pessoa publicou. */
export async function openReviewComposer(
  modalCtrl: ModalController,
  props: {
    productId: string;
    productName: string;
    productPhoto?: string | null;
    orderId: string;
    variant?: string | null;
    deliveredAt?: Date | null;
    existing?: ProductReview | null;
    initialRating?: number;
  }
): Promise<boolean> {
  const modal = await modalCtrl.create({
    component: ReviewComposerComponent,
    componentProps: props,
    cssClass: 'vn-review-modal',
    backdropDismiss: false,
  });
  await modal.present();
  const { data } = await modal.onDidDismiss<ReviewComposerResult>();
  return !!data?.saved;
}
