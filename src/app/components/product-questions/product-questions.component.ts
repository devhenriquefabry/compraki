import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlertController, IonicModule, ModalController, ToastController } from '@ionic/angular';
import { of, switchMap } from 'rxjs';

import { requireAccount } from '../../core/auth-redirect';
import { getCurrentUser, onAuthUserChanged } from '../../core/auth-state';
import { formatDay, normalizeSearch } from '../../core/order-stage';
import {
  CONTACT_MESSAGE, QUESTION_LIMITS, QUESTION_PROMPTS, agoLabel, findContactInfo, formatDuration, median, similarQuestions,
} from '../../core/question-rules';
import { Product } from '../../interfaces/product';
import { ProductQuestion } from '../../interfaces/question';
import { ProductQuestionsService, QuestionError } from '../../services/product-questions.service';
import { ReportModalComponent } from '../report-modal/report-modal.component';
import { VnIconComponent } from '../vn-icon/vn-icon.component';

const COLLAPSED_COUNT = 4;
const SEARCH_FROM = 6;
/** Poucas respostas dão uma média enganosa: só mostra "costuma responder em…" a partir daqui. */
const MIN_ANSWERS_FOR_PACE = 3;

/**
 * "Perguntas e respostas" da página do produto.
 *
 * Quem olha decide o que vê:
 *  - visitante: lê as perguntas respondidas; para perguntar, entra na conta;
 *  - comprador: escreve a dúvida (com sugestões de perguntas parecidas já
 *    respondidas e aviso de contato por fora antes de enviar), vê as dele que
 *    esperam resposta e pode apagar;
 *  - a loja dona do anúncio: não pergunta; vê quantas esperam resposta e vai
 *    para a fila em Minha conta.
 *
 * Quem garante as regras é o servidor (functions/src/questions.ts); a
 * validação daqui só poupa o texto digitado.
 */
@Component({
  selector: 'app-product-questions',
  templateUrl: './product-questions.component.html',
  styleUrls: ['./product-questions.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, RouterLink, VnIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductQuestionsComponent {
  readonly product = input.required<Product>();

  private readonly service = inject(ProductQuestionsService);
  private readonly router = inject(Router);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly modalCtrl = inject(ModalController);

  readonly limits = QUESTION_LIMITS;
  readonly prompts = QUESTION_PROMPTS;
  readonly ago = agoLabel;

  private readonly productId = computed(() => this.product().id ?? '');
  readonly viewerId = signal<string | null>(getCurrentUser()?.uid ?? null);

  readonly isStore = computed(() => !!this.viewerId() && this.product().sellerId === this.viewerId());

  /** Perguntas respondidas: públicas, para qualquer visitante. */
  readonly answered = toSignal<ProductQuestion[] | null>(
    toObservable(this.productId).pipe(switchMap(id => (id ? this.service.watchAnswered(id) : of([] as ProductQuestion[])))),
    { initialValue: null },
  );

  /** O que a pessoa logada já perguntou neste anúncio (quem ainda espera resposta aparece aqui). */
  readonly mine = signal<ProductQuestion[]>([]);
  /** Só a loja: perguntas deste anúncio esperando resposta. */
  readonly storePending = signal(0);

  readonly waiting = computed(() => this.mine().filter(q => q.status === 'open'));
  readonly slotsLeft = computed(() => Math.max(0, QUESTION_LIMITS.openPerProduct - this.waiting().length));

  // ---------------------------------------------------------------- lista

  readonly search = signal('');
  readonly expanded = signal(false);

  readonly filtered = computed(() => {
    const term = normalizeSearch(this.search().trim());
    const list = this.answered() ?? [];
    if (!term) return list;
    return list.filter(q => normalizeSearch(`${q.text} ${q.answer?.text ?? ''}`).includes(term));
  });

  readonly visible = computed(() => (this.expanded() || this.search().trim() ? this.filtered() : this.filtered().slice(0, COLLAPSED_COUNT)));

  /** Mediana do tempo de resposta da loja neste anúncio, quando há respostas suficientes. */
  readonly pace = computed(() => {
    const times = (this.answered() ?? []).map(q => q.responseMs).filter((n): n is number => typeof n === 'number');
    return times.length >= MIN_ANSWERS_FOR_PACE ? formatDuration(median(times)!) : null;
  });

  // ------------------------------------------------------------- formulário

  /** Texto da pergunta (campo do formulário). */
  draft = '';
  readonly typed = signal('');
  readonly sending = signal(false);
  readonly error = signal('');

  readonly contact = computed(() => {
    const kind = findContactInfo(this.typed());
    return kind ? CONTACT_MESSAGE[kind] : null;
  });

  readonly similar = computed(() => {
    const text = this.typed().trim();
    return text.length >= 12 ? similarQuestions(text, this.answered() ?? []) : [];
  });

  readonly canSend = computed(() => {
    const len = this.typed().trim().length;
    return !this.sending() && len >= QUESTION_LIMITS.questionMin && !this.contact() && this.slotsLeft() > 0;
  });

  constructor() {
    const stopAuth = onAuthUserChanged(user => this.viewerId.set(user?.uid ?? null));
    inject(DestroyRef).onDestroy(stopAuth);

    // As perguntas da própria pessoa (e, para a loja, as que esperam resposta) mudam com quem está logado.
    effect(onCleanup => {
      const uid = this.viewerId();
      const productId = this.productId();
      this.mine.set([]);
      this.storePending.set(0);
      if (!uid || !productId) return;

      const sub = this.isStore()
        ? this.service.watchStore(uid).subscribe({
            next: list => this.storePending.set(list.filter(q => q.productId === productId && q.status === 'open').length),
            error: () => this.storePending.set(0),
          })
        : this.service.watchMineOnProduct(uid, productId).subscribe({
            next: list => this.mine.set(list),
            error: () => this.mine.set([]),
          });
      onCleanup(() => sub.unsubscribe());
    });
  }

  // ------------------------------------------------------------------ ações

  onType(value: string) {
    this.draft = value;
    this.typed.set(value);
    if (this.error()) this.error.set('');
  }

  usePrompt(text: string) {
    this.onType(text);
    setTimeout(() => (document.getElementById('pq-text') as HTMLTextAreaElement | null)?.focus(), 30);
  }

  goToLogin() {
    requireAccount(this.router);
  }

  async send() {
    if (!this.canSend() || !requireAccount(this.router)) return;
    this.sending.set(true);
    this.error.set('');
    try {
      await this.service.ask(this.productId(), this.typed().trim());
      this.onType('');
      void this.toast('Pergunta enviada. Avisamos você quando a loja responder.', 'success');
    } catch (err) {
      this.error.set(err instanceof QuestionError ? err.message : 'Não foi possível enviar agora. Tente de novo.');
    } finally {
      this.sending.set(false);
    }
  }

  async removeMine(question: ProductQuestion) {
    const alert = await this.alertCtrl.create({
      header: 'Apagar pergunta?',
      message: 'Ela sai da fila da loja. Você pode perguntar de novo depois.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Apagar', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    try {
      await this.service.remove(question.id);
      void this.toast('Pergunta apagada.', 'medium');
    } catch (err) {
      void this.toast(err instanceof QuestionError ? err.message : 'Não foi possível apagar agora.', 'danger');
    }
  }

  async report(question: ProductQuestion) {
    const product = this.product();
    if (!requireAccount(this.router) || question.userId === this.viewerId()) return;
    const modal = await this.modalCtrl.create({
      component: ReportModalComponent,
      componentProps: {
        targetType: 'question',
        targetId: question.id,
        sellerId: question.userId,
        targetName: `Pergunta de ${question.userName} em ${product.name}`.slice(0, 200),
        targetPhoto: product.photoURL?.[0] ?? null,
      },
    });
    await modal.present();
  }

  // ------------------------------------------------------------------ apoio

  isMine(question: ProductQuestion): boolean {
    return !!this.viewerId() && question.userId === this.viewerId();
  }

  day(value: Date | null): string {
    return formatDay(value, true) || 'agora';
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium') {
    const toast = await this.toastCtrl.create({ message, color, duration: 3200, position: 'bottom' });
    await toast.present();
  }
}
