import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertController, IonicModule, ModalController, NavController, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { onAuthUserChanged } from '../../core/auth-state';
import { formatDay, normalizeSearch } from '../../core/order-stage';
import {
  CONTACT_MESSAGE, DEFAULT_QUICK_REPLIES, GOAL_RESPONSE_MS, LATE_AFTER_MS, QUESTION_LIMITS, agoLabel, findContactInfo,
  formatDuration,
} from '../../core/question-rules';
import { ReportModalComponent } from '../../components/report-modal/report-modal.component';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { ProductQuestion } from '../../interfaces/question';
import { FirebaseProducts } from '../../services/firebase-products';
import { ProductQuestionsService, QuestionError } from '../../services/product-questions.service';

type Tab = 'minhas' | 'loja';
type MineFilter = 'all' | 'answered' | 'waiting';
type StoreFilter = 'pending' | 'answered' | 'all';

const TAB_IDS: Tab[] = ['minhas', 'loja'];

/** Depois disto sem resposta, a pessoa ganha uma saída: conversar com a loja pelo anúncio. */
const SLOW_AFTER_MS = 48 * 60 * 60 * 1000;

/** Quanto a pessoa vê "Nova" antes da resposta ser marcada como vista. */
const SEEN_AFTER_MS = 2500;

/**
 * Perguntas aos vendedores.
 *
 * - "Minhas perguntas": o que a pessoa perguntou a lojas, com a resposta, o
 *   tempo que está esperando e a opção de apagar. Resposta nova aparece
 *   marcada até a pessoa ver.
 * - "Da sua loja" (só para quem anuncia): a fila de perguntas dos clientes —
 *   as que esperam resposta primeiro, a mais antiga no topo —, painel com
 *   tempo de resposta, respostas rápidas e denúncia.
 *
 * `?aba=minhas|loja` escolhe a aba (os avisos já levam para a certa).
 */
@Component({
  selector: 'app-my-questions',
  templateUrl: './my-questions.page.html',
  styleUrls: ['./my-questions.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, RouterModule, VnIconComponent],
})
export class MyQuestionsPage {
  private readonly service = inject(ProductQuestionsService);
  private readonly products = inject(FirebaseProducts);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly navCtrl = inject(NavController);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly limits = QUESTION_LIMITS;
  readonly goalMs = GOAL_RESPONSE_MS;
  readonly defaultReplies = DEFAULT_QUICK_REPLIES;
  readonly ago = agoLabel;
  readonly duration = formatDuration;

  readonly uid = signal<string | null>(null);
  readonly requestedTab = signal<Tab>('minhas');

  readonly mine = signal<ProductQuestion[] | null>(null);
  readonly store = signal<ProductQuestion[] | null>(null);
  readonly productCount = signal<number | null>(null);
  readonly failed = signal(false);
  readonly storeFailed = signal(false);
  readonly busy = signal<string | null>(null);

  readonly mineFilter = signal<MineFilter>('all');
  readonly storeFilter = signal<StoreFilter>('pending');
  readonly search = signal('');

  /** Respostas que chegaram: continuam marcadas "Nova" nesta visita, mesmo depois de vistas. */
  readonly fresh = signal<ReadonlySet<string>>(new Set());

  /** Pergunta com a caixa de resposta aberta. */
  readonly replying = signal<string | null>(null);
  replyDraft = '';
  readonly typed = signal('');
  readonly custom = signal<string[]>([]);
  readonly now = signal(Date.now());

  private subs: Subscription[] = [];
  private seenTimer: ReturnType<typeof setTimeout> | null = null;

  // ------------------------------------------------------------- derivados

  readonly isSeller = computed(() => (this.productCount() ?? 0) > 0 || (this.store()?.length ?? 0) > 0);

  readonly tab = computed<Tab>(() => {
    const wanted = this.requestedTab();
    const settled = this.productCount() !== null && this.store() !== null;
    return wanted === 'loja' && settled && !this.isSeller() ? 'minhas' : wanted;
  });

  readonly loading = computed(() => !this.failed() && this.mine() === null);

  readonly waitingMine = computed(() => (this.mine() ?? []).filter(q => q.status === 'open').length);
  readonly unreadMine = computed(() => (this.mine() ?? []).filter(q => q.askerUnread).length);

  readonly mineList = computed(() => {
    const list = this.mine() ?? [];
    switch (this.mineFilter()) {
      case 'answered': return list.filter(q => q.status === 'answered');
      case 'waiting': return list.filter(q => q.status === 'open');
      default: return list;
    }
  });

  readonly storeSummary = computed(() => {
    const list = this.store() ?? [];
    const open = list.filter(q => q.status === 'open');
    const answered = list.filter(q => q.status === 'answered');
    const times = answered.map(q => q.responseMs).filter((n): n is number => typeof n === 'number');
    const now = this.now();
    return {
      total: list.length,
      pending: open.length,
      answered: answered.length,
      late: open.filter(q => now - (q.createdAt?.getTime() ?? now) > LATE_AFTER_MS).length,
      averageMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      rate: list.length ? Math.round((answered.length / list.length) * 100) : null,
    };
  });

  readonly storeList = computed(() => {
    const term = normalizeSearch(this.search().trim());
    let list = this.store() ?? [];
    switch (this.storeFilter()) {
      case 'pending':
        // A que espera há mais tempo primeiro: é a que mais perde a venda.
        list = list.filter(q => q.status === 'open').sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
        break;
      case 'answered':
        list = list.filter(q => q.status === 'answered');
        break;
    }
    return term
      ? list.filter(q => normalizeSearch(`${q.text} ${q.productName} ${q.userName} ${q.answer?.text ?? ''}`).includes(term))
      : list;
  });

  readonly contact = computed(() => {
    const kind = findContactInfo(this.typed());
    return kind ? CONTACT_MESSAGE[kind] : null;
  });

  /** Respostas rápidas: as da loja primeiro, depois as que a Vineon sugere. */
  readonly replies = computed(() => [
    ...this.custom().map(text => ({ text, custom: true })),
    ...this.defaultReplies.map(text => ({ text: text as string, custom: false })),
  ]);

  readonly canSaveReply = computed(() => {
    const text = this.typed().trim();
    return text.length >= 10
      && text.length <= QUESTION_LIMITS.quickReplyMax
      && !this.contact()
      && this.custom().length < QUESTION_LIMITS.quickRepliesMax
      && !this.custom().includes(text)
      && !(this.defaultReplies as readonly string[]).includes(text);
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const stopAuth = onAuthUserChanged(user => this.bind(user?.uid ?? null));
    const tick = setInterval(() => this.now.set(Date.now()), 60_000);
    destroyRef.onDestroy(() => {
      stopAuth();
      clearInterval(tick);
      this.unbind();
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const aba = params.get('aba') as Tab | null;
      if (aba && TAB_IDS.includes(aba)) this.requestedTab.set(aba);
    });

    // Quem perguntou viu a resposta: depois de um instante com a aba aberta, tira a marca no servidor.
    effect(onCleanup => {
      const unread = (this.mine() ?? []).filter(q => q.askerUnread);
      if (this.tab() !== 'minhas' || !unread.length) return;
      this.fresh.update(set => new Set([...set, ...unread.map(q => q.id)]));
      this.seenTimer = setTimeout(() => unread.forEach(q => void this.service.markSeen(q.id)), SEEN_AFTER_MS);
      onCleanup(() => {
        if (this.seenTimer) clearTimeout(this.seenTimer);
      });
    });
  }

  private bind(uid: string | null) {
    if (uid === this.uid()) return;
    this.unbind();
    this.uid.set(uid);
    this.mine.set(null);
    this.store.set(null);
    this.productCount.set(null);
    this.failed.set(false);
    this.storeFailed.set(false);
    if (!uid) return;

    this.subs = [
      this.service.watchMine(uid).subscribe({
        next: list => this.mine.set(list),
        error: err => {
          console.error('[perguntas] falha ao ler as perguntas da pessoa', err);
          this.failed.set(true);
        },
      }),
      this.service.watchStore(uid).subscribe({
        next: list => this.store.set(list),
        error: err => {
          console.error('[perguntas] falha ao ler as perguntas da loja', err);
          this.storeFailed.set(true);
          this.store.set([]);
        },
      }),
      this.products.getBySeller(uid, true).subscribe({
        next: list => this.productCount.set(list.length),
        error: () => this.productCount.set(0),
      }),
    ];
    void this.service.getQuickReplies(uid).then(items => this.custom.set(items));
  }

  private unbind() {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
  }

  // ------------------------------------------------------------------ abas

  selectTab(tab: Tab) {
    this.requestedTab.set(tab);
    this.cancelReply();
    this.search.set('');
    void this.router.navigate([], { queryParams: { aba: tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  goBack() {
    this.navCtrl.back();
  }

  // --------------------------------------------------------- minhas perguntas

  isFresh(q: ProductQuestion): boolean {
    return q.askerUnread || this.fresh().has(q.id);
  }

  /** Está demorando: a pessoa pode seguir pelo chat do anúncio. */
  isSlow(q: ProductQuestion): boolean {
    return q.status === 'open' && this.now() - (q.createdAt?.getTime() ?? this.now()) > SLOW_AFTER_MS;
  }

  async removeMine(q: ProductQuestion) {
    const alert = await this.alertCtrl.create({
      header: 'Apagar pergunta?',
      message: q.status === 'answered'
        ? 'Ela e a resposta da loja saem do anúncio. Dá para perguntar de novo depois.'
        : 'Ela sai da fila da loja. Dá para perguntar de novo depois.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Apagar', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    await this.run(q.id, () => this.service.remove(q.id), 'Pergunta apagada.');
  }

  // -------------------------------------------------------------------- loja

  isLate(q: ProductQuestion): boolean {
    return q.status === 'open' && this.now() - (q.createdAt?.getTime() ?? this.now()) > LATE_AFTER_MS;
  }

  startReply(q: ProductQuestion) {
    this.replying.set(q.id);
    this.onType(q.answer?.text ?? '');
    setTimeout(() => document.getElementById(`reply-${q.id}`)?.focus(), 60);
  }

  cancelReply() {
    this.replying.set(null);
    this.onType('');
  }

  onType(value: string) {
    this.replyDraft = value;
    this.typed.set(value);
  }

  useReply(text: string) {
    this.onType(text);
    setTimeout(() => {
      const id = this.replying();
      const field = id ? document.getElementById(`reply-${id}`) as HTMLTextAreaElement | null : null;
      field?.focus();
      field?.setSelectionRange(text.length, text.length);
    }, 30);
  }

  canSend(): boolean {
    const text = this.typed().trim();
    return !this.busy() && text.length >= QUESTION_LIMITS.answerMin && !this.contact();
  }

  async sendReply(q: ProductQuestion) {
    if (!this.canSend()) return;
    const edited = !!q.answer;
    await this.run(q.id, async () => {
      await this.service.answer(q.id, this.typed().trim());
      this.cancelReply();
    }, edited ? 'Resposta atualizada.' : 'Resposta publicada no anúncio.', 'success');
  }

  async retract(q: ProductQuestion) {
    const alert = await this.alertCtrl.create({
      header: 'Retirar resposta?',
      message: 'A resposta sai do anúncio e a pergunta volta para a fila de quem espera.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Retirar', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    await this.run(q.id, () => this.service.retractAnswer(q.id), 'Resposta retirada.');
  }

  async removeAsStore(q: ProductQuestion) {
    const alert = await this.alertCtrl.create({
      header: 'Excluir pergunta?',
      message: 'Use para pergunta repetida, sem sentido ou fora do assunto do produto. Ela some da sua fila e do anúncio. Se for ofensiva, prefira Denunciar.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Excluir', role: 'destructive' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    await this.run(q.id, () => this.service.remove(q.id), 'Pergunta excluída.');
  }

  async report(q: ProductQuestion) {
    const modal = await this.modalCtrl.create({
      component: ReportModalComponent,
      componentProps: {
        targetType: 'question',
        targetId: q.id,
        sellerId: q.userId,
        targetName: `Pergunta de ${q.userName} em ${q.productName}`.slice(0, 200),
        targetPhoto: q.productPhoto,
      },
    });
    await modal.present();
  }

  // -------------------------------------------------------- respostas rápidas

  async saveQuickReply() {
    const uid = this.uid();
    if (!uid || !this.canSaveReply()) return;
    const next = [this.typed().trim(), ...this.custom()];
    try {
      await this.service.saveQuickReplies(uid, next);
      this.custom.set(next);
      void this.toast('Salva nas suas respostas rápidas.', 'success');
    } catch {
      void this.toast('Não foi possível salvar agora.', 'danger');
    }
  }

  async deleteQuickReply(text: string) {
    const uid = this.uid();
    if (!uid) return;
    const next = this.custom().filter(t => t !== text);
    try {
      await this.service.saveQuickReplies(uid, next);
      this.custom.set(next);
    } catch {
      void this.toast('Não foi possível apagar agora.', 'danger');
    }
  }

  // ------------------------------------------------------------------ apoio

  day(value: Date | null): string {
    return formatDay(value, true) || 'agora';
  }

  plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  private async run(id: string, action: () => Promise<unknown>, success: string, color: 'success' | 'medium' = 'medium') {
    if (this.busy()) return;
    this.busy.set(id);
    try {
      await action();
      void this.toast(success, color);
    } catch (err) {
      console.error(err);
      void this.toast(err instanceof QuestionError ? err.message : 'Não foi possível concluir agora. Tente de novo.', 'danger');
    } finally {
      this.busy.set(null);
    }
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium') {
    const toast = await this.toastCtrl.create({ message, color, duration: 2800, position: 'bottom' });
    await toast.present();
  }
}
