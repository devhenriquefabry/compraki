import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular';
import { Subscription, firstValueFrom } from 'rxjs';

import { HelpAnswerComponent } from '../../components/help-answer/help-answer.component';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { getFirebaseAuth, onAuthUserChanged } from '../../core/auth-state';
import { HelpHit, findArticle, findTopic, suggestHelp } from '../../core/help-content';
import {
  SALE_STAGE_LABEL, STAGE_LABEL, formatBRL, formatDay, orderStage, sellerAmount, sellerItems, toDate,
} from '../../core/order-stage';
import { SUPPORT, formatFileSize, isOpenStatus } from '../../core/support-config';
import { SupportTopic, supportTopic, supportTopicsFor } from '../../core/support-topics';
import { Order } from '../../interfaces/order';
import { SupportAttachment, SupportTicket } from '../../interfaces/support';
import { OrdersService } from '../../services/orders.service';
import { SalesService } from '../../services/sales.service';
import { SupportService } from '../../services/support.service';

type Step = 'topic' | 'order' | 'details' | 'sent';
type Profile = 'buy' | 'sell';

interface OrderChoice {
  id: string;
  shortId: string;
  photo: string | null;
  items: string;
  stageLabel: string;
  amount: number;
  date: string;
}

interface Upload {
  key: string;
  name: string;
  size: number;
  preview: string | null;
  state: 'uploading' | 'done' | 'error';
  attachment?: SupportAttachment;
}

interface Draft {
  ticketId: string;
  profile: Profile;
  topicId: string;
  orderId: string | null;
  subject: string;
  message: string;
  attachments: SupportAttachment[];
  savedAt: number;
}

const DRAFT_KEY = 'vn_support_draft';
const DRAFT_MAX_AGE = 2 * 60 * 60 * 1000;

/**
 * Abrir atendimento em passos: assunto → pedido (se o assunto pede) → detalhes.
 * Na etapa de detalhes a Central de ajuda sugere respostas enquanto a pessoa
 * escreve ("Isso resolve?"), os anexos sobem na hora e o rascunho fica
 * guardado na sessão, para o caso de ela sair para ler uma resposta.
 *
 * Entradas por link: `?pedido=<id>&perfil=buy|sell` (botão do pedido),
 * `?assunto=<id>` (assunto já escolhido), `?de=<id da pergunta>` (veio da
 * Central) e `?relacionado=<id>` (novo atendimento depois de um encerrado).
 */
@Component({
  selector: 'app-support-new',
  templateUrl: './support-new.page.html',
  styleUrls: ['./support-new.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, RouterLink, VnIconComponent, HelpAnswerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportNewPage {
  private readonly support = inject(SupportService);
  private readonly orders = inject(OrdersService);
  private readonly sales = inject(SalesService);
  private readonly navCtrl = inject(NavController);
  private readonly router = inject(Router);

  readonly info = SUPPORT;
  readonly fileSize = formatFileSize;
  readonly email = getFirebaseAuth().currentUser?.email ?? null;

  readonly step = signal<Step>('topic');
  readonly profile = signal<Profile>('buy');
  readonly topic = signal<SupportTopic | null>(null);
  readonly orderId = signal<string | null>(null);

  readonly orderList = signal<OrderChoice[] | null>(null);
  readonly ordersFailed = signal(false);

  readonly subject = signal('');
  readonly message = signal('');
  readonly uploads = signal<Upload[]>([]);
  readonly fileError = signal<string | null>(null);

  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly protocol = signal('');
  readonly createdId = signal('');

  readonly openTickets = signal<SupportTicket[]>([]);
  readonly sheetHit = signal<HelpHit | null>(null);

  private ticketId = this.support.newTicketId();
  private fromHelpArticle: string | null = null;
  private relatedId: string | null = null;
  private uid: string | null = null;
  private restoring = false;
  private done = false;

  readonly topics = computed(() => supportTopicsFor(this.profile()));

  readonly selectedOrder = computed(() => {
    const id = this.orderId();
    return id ? this.orderList()?.find(o => o.id === id) ?? null : null;
  });

  /** Já existe atendimento aberto sobre o mesmo assunto e pedido. */
  readonly duplicate = computed(() => {
    const topic = this.topic();
    if (!topic) return null;
    return this.openTickets().find(t => isOpenStatus(t.status) && t.topic === topic.id && (t.orderId ?? null) === (this.orderId() ?? null)) ?? null;
  });

  readonly suggestions = computed<HelpHit[]>(() =>
    this.step() === 'details' ? suggestHelp(`${this.subject()} ${this.message().slice(0, 160)}`, 3) : []);

  readonly helpTopic = computed(() => findTopic(this.topic()?.helpTopicId ?? null));

  readonly uploading = computed(() => this.uploads().some(u => u.state === 'uploading'));

  readonly canSubmit = computed(() =>
    this.step() === 'details'
    && !this.sending()
    && !this.uploading()
    && this.subject().trim().length >= SUPPORT.subjectMin
    && this.message().trim().length >= SUPPORT.messageMin);

  readonly messageLeft = computed(() => Math.max(0, SUPPORT.messageMin - this.message().trim().length));

  readonly stepNo = computed(() => (this.step() === 'topic' ? 1 : this.step() === 'order' ? 2 : 3));

  constructor() {
    // Atendimentos abertos, só para avisar de duplicidade.
    let mine: Subscription | undefined;
    const stopAuth = onAuthUserChanged(user => {
      this.uid = user?.uid ?? null;
      mine?.unsubscribe();
      if (!user) return;
      mine = this.support.watchMyTickets(user.uid, 30).subscribe({
        next: list => this.openTickets.set(list),
        error: () => this.openTickets.set([]),
      });
    });

    inject(DestroyRef).onDestroy(() => {
      stopAuth();
      mine?.unsubscribe();
      this.uploads().forEach(u => u.preview && URL.revokeObjectURL(u.preview));
    });

    this.init(inject(ActivatedRoute).snapshot.queryParamMap);

    // Rascunho: a cada mudança. Sai da tela com o atendimento enviado, apaga.
    effect(() => {
      const topic = this.topic();
      const state = {
        profile: this.profile(), topicId: topic?.id ?? '', orderId: this.orderId(),
        subject: this.subject(), message: this.message(),
        attachments: this.uploads().filter(u => u.state === 'done').map(u => u.attachment!),
      };
      if (this.restoring || this.done || !topic) return;
      this.saveDraft({ ticketId: this.ticketId, savedAt: Date.now(), ...state });
    });
  }

  // ------------------------------------------------------------------ entrada

  private init(params: { get(name: string): string | null }): void {
    const perfil = params.get('perfil');
    const assunto = supportTopic(params.get('assunto'));
    const pedido = params.get('pedido');
    this.fromHelpArticle = findArticle(params.get('de') ?? '')?.article.id ?? null;
    this.relatedId = params.get('relacionado');

    if (perfil === 'sell' || perfil === 'buy') this.profile.set(perfil);
    else if (assunto?.profile === 'sell') this.profile.set('sell');

    const explicit = !!(assunto || pedido);
    if (!explicit) {
      const draft = this.loadDraft();
      if (draft) {
        this.restoring = true;
        this.ticketId = draft.ticketId;
        this.profile.set(draft.profile);
        this.topic.set(supportTopic(draft.topicId) ?? null);
        this.orderId.set(draft.orderId);
        this.subject.set(draft.subject);
        this.message.set(draft.message);
        this.uploads.set(draft.attachments.map((a, i) => ({
          key: `draft${i}`, name: a.name, size: a.size, preview: null, state: 'done' as const, attachment: a,
        })));
        this.restoring = false;
        if (this.topic()) {
          if (this.orderId()) void this.loadOrders();
          this.step.set('details');
        }
      }
      return;
    }

    if (pedido) {
      this.orderId.set(pedido);
      void this.loadOrders();
    }
    if (assunto) {
      this.topic.set(assunto);
      if (assunto.needsOrder && !pedido) {
        void this.loadOrders();
        this.step.set('order');
      } else {
        this.step.set('details');
      }
    }
  }

  // ------------------------------------------------------------------- passos

  setProfile(profile: Profile): void {
    if (this.profile() === profile) return;
    this.profile.set(profile);
    this.topic.set(null);
    this.orderId.set(null);
    this.orderList.set(null);
  }

  pickTopic(topic: SupportTopic): void {
    this.topic.set(topic);
    if (topic.needsOrder && !this.orderId()) {
      void this.loadOrders();
      this.step.set('order');
    } else {
      if (this.orderId() && this.orderList() === null) void this.loadOrders();
      this.step.set('details');
    }
  }

  pickOrder(id: string | null): void {
    this.orderId.set(id);
    this.step.set('details');
  }

  changeTopic(): void {
    this.step.set('topic');
  }

  changeOrder(): void {
    if (this.orderList() === null) void this.loadOrders();
    this.step.set('order');
  }

  back(): void {
    switch (this.step()) {
      case 'details':
        this.step.set(this.topic()?.needsOrder ? 'order' : 'topic');
        break;
      case 'order':
        this.step.set('topic');
        break;
      default:
        if (window.history.length > 1) this.navCtrl.back();
        else void this.navCtrl.navigateRoot('/support');
    }
  }

  async loadOrders(): Promise<void> {
    const uid = this.uid ?? getFirebaseAuth().currentUser?.uid;
    if (!uid) return;
    this.ordersFailed.set(false);
    this.orderList.set(null);
    try {
      const buying = this.profile() === 'buy';
      const list = await firstValueFrom(buying ? this.orders.getUserOrders(uid) : this.sales.getSellerSales(uid));
      this.orderList.set(list.slice(0, 20).map(o => this.choiceOf(o, uid, buying)));
    } catch (err) {
      console.error('[atendimento] não carregou os pedidos', err);
      this.ordersFailed.set(true);
      this.orderList.set([]);
    }
  }

  private choiceOf(order: Order, uid: string, buying: boolean): OrderChoice {
    const items = buying ? order.items || [] : sellerItems(order, uid);
    const first = items[0]?.productData;
    const rest = items.length - 1;
    const name = first?.name || 'Pedido';
    const labels = buying ? STAGE_LABEL : SALE_STAGE_LABEL;
    return {
      id: order.id ?? '',
      shortId: (order.id ?? '').substring(0, 8).toUpperCase(),
      photo: first?.photoURL?.[0] ?? null,
      items: rest > 0 ? `${name} e mais ${rest} ${rest === 1 ? 'item' : 'itens'}` : name,
      stageLabel: labels[orderStage(order)],
      amount: buying ? order.total || 0 : sellerAmount(order, uid),
      date: formatDay(toDate(order.createdAt), true),
    };
  }

  money(value: number): string {
    return formatBRL(value);
  }

  // ------------------------------------------------------------------- anexos

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.fileError.set(null);

    for (const file of files) {
      if (this.uploads().length >= SUPPORT.maxAttachments) {
        this.fileError.set(`Você pode anexar até ${SUPPORT.maxAttachments} arquivos.`);
        break;
      }
      const key = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      this.uploads.update(list => [...list, { key, name: file.name, size: file.size, preview, state: 'uploading' }]);
      try {
        const attachment = await this.support.uploadAttachment(this.ticketId, file);
        this.patchUpload(key, { state: 'done', attachment });
      } catch (err) {
        this.removeUpload(key);
        this.fileError.set(err instanceof Error ? err.message : 'Não foi possível anexar este arquivo.');
      }
    }
  }

  private patchUpload(key: string, patch: Partial<Upload>): void {
    this.uploads.update(list => list.map(u => (u.key === key ? { ...u, ...patch } : u)));
  }

  removeUpload(key: string): void {
    const found = this.uploads().find(u => u.key === key);
    if (found?.preview) URL.revokeObjectURL(found.preview);
    this.uploads.update(list => list.filter(u => u.key !== key));
  }

  // ------------------------------------------------------------------- enviar

  async submit(): Promise<void> {
    const topic = this.topic();
    if (!topic || !this.canSubmit()) return;

    this.sending.set(true);
    this.error.set(null);
    try {
      const result = await this.support.createTicket({
        ticketId: this.ticketId,
        topic: topic.id,
        role: this.profile() === 'sell' ? 'seller' : 'buyer',
        subject: this.subject().trim(),
        message: this.message().trim(),
        orderId: this.orderId(),
        fromHelpArticle: this.fromHelpArticle,
        relatedTicketId: this.relatedId,
        attachments: this.uploads().filter(u => u.state === 'done').map(u => u.attachment!),
      });
      this.done = true;
      this.clearDraft();
      this.protocol.set(result.protocol);
      this.createdId.set(result.id);
      this.step.set('sent');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Não foi possível enviar agora. Tente de novo.');
    } finally {
      this.sending.set(false);
    }
  }

  track(): void {
    void this.router.navigate(['/support', this.createdId()], { replaceUrl: true });
  }

  openSheet(hit: HelpHit): void {
    this.sheetHit.set(hit);
  }

  helpQuery(hit: HelpHit): { assunto: string; pergunta: string } {
    return { assunto: hit.topic.id, pergunta: hit.article.id };
  }

  // ----------------------------------------------------------------- rascunho

  private saveDraft(draft: Draft): void {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch { /* sem armazenamento (aba privada): o rascunho só não sobrevive */ }
  }

  private loadDraft(): Draft | null {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw) as Draft;
      if (!draft.ticketId || Date.now() - draft.savedAt > DRAFT_MAX_AGE || !supportTopic(draft.topicId)) return null;
      return draft;
    } catch {
      return null;
    }
  }

  private clearDraft(): void {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch { /* idem */ }
  }
}
