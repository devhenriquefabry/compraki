import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { SupportFileComponent } from '../../components/support-file/support-file.component';
import { getCurrentUser } from '../../core/auth-state';
import { SALE_STAGE_LABEL, STAGE_LABEL, formatBRL, normalizeSearch } from '../../core/order-stage';
import {
  SUPPORT, SUPPORT_PRIORITY_LABEL, SUPPORT_STAFF_STATUS_LABEL, formatFileSize, isOpenStatus, relativeTime,
} from '../../core/support-config';
import { SUPPORT_MACROS, SupportMacro, fillMacro } from '../../core/support-macros';
import { SupportAttachment, SupportNote, SupportReply, SupportStatus, SupportTicket } from '../../interfaces/support';
import { SupportService } from '../../services/support.service';

type Filter = 'new' | 'waiting_staff' | 'waiting_customer' | 'done' | 'all';
type Owner = 'all' | 'mine' | 'free';
type Tone = 'ok' | 'warn' | 'danger' | 'muted';

interface Pending {
  key: string;
  name: string;
  size: number;
  state: 'uploading' | 'done';
  attachment?: SupportAttachment;
}

interface Sla {
  label: string;
  tone: Tone;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const HOUR = 3_600_000;

/**
 * Aba "Atendimento" do painel: a fila do "Fale com a Vineon".
 *
 * Esquerda, a fila (mais urgente primeiro, com o prazo da 1ª resposta);
 * direita, a conversa com o cliente, o contexto do pedido, notas internas e
 * respostas prontas. Resposta e mudança de status passam pela function
 * `replySupportTicket` (que avisa o cliente por app e e-mail); atribuição,
 * prioridade e notas são escrita direta. O ticket aberto fica em `?ticket=<id>`.
 */
@Component({
  selector: 'app-manage-support',
  templateUrl: './manage-support.page.html',
  styleUrls: ['./manage-support.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, SupportFileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageSupportPage {
  private readonly support = inject(SupportService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly info = SUPPORT;
  readonly statusLabel = SUPPORT_STAFF_STATUS_LABEL;
  readonly priorityLabel = SUPPORT_PRIORITY_LABEL;
  readonly macros = SUPPORT_MACROS;
  readonly fileSize = formatFileSize;

  // ----------------------------------------------------------------- fila
  readonly tickets = signal<SupportTicket[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly filter = signal<Filter>('waiting_staff');
  readonly owner = signal<Owner>('all');
  readonly search = signal('');
  readonly selectedId = signal<string | null>(null);

  // --------------------------------------------------------------- detalhe
  readonly replies = signal<SupportReply[]>([]);
  readonly notes = signal<SupportNote[]>([]);
  readonly repliesFailed = signal(false);

  readonly text = signal('');
  readonly pending = signal<Pending[]>([]);
  readonly fileError = signal<string | null>(null);
  readonly sending = signal(false);
  readonly busy = signal(false);
  readonly sendError = signal<string | null>(null);

  readonly noteText = signal('');
  readonly notesOpen = signal(false);
  readonly savingNote = signal(false);

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly me = getCurrentUser();
  private detailSubs: Subscription[] = [];
  private markedRead = new Set<string>();
  private stop?: () => void;

  /** Para as contagens e os prazos recalcularem sozinhos com o passar das horas. */
  readonly now = signal(Date.now());

  // ------------------------------------------------------------- derivados

  private matchesFilter(t: SupportTicket, filter: Filter): boolean {
    switch (filter) {
      case 'new': return t.status === 'waiting_staff' && !t.firstResponseAt;
      case 'waiting_staff': return t.status === 'waiting_staff';
      case 'waiting_customer': return t.status === 'waiting_customer';
      case 'done': return t.status === 'resolved' || t.status === 'closed';
      default: return true;
    }
  }

  readonly counts = computed(() => {
    const all = this.tickets();
    const count = (f: Filter) => all.filter(t => this.matchesFilter(t, f)).length;
    return {
      new: count('new'),
      waiting_staff: count('waiting_staff'),
      waiting_customer: count('waiting_customer'),
      done: count('done'),
      all: all.length,
    };
  });

  readonly overdue = computed(() => {
    const now = this.now();
    return this.tickets().filter(t => t.status === 'waiting_staff' && !t.firstResponseAt && t.firstResponseDueAt && t.firstResponseDueAt.getTime() < now).length;
  });

  readonly list = computed(() => {
    const term = normalizeSearch(this.search().trim());
    const uid = this.me?.uid;
    const rank = (t: SupportTicket) => (t.status === 'waiting_staff' ? 0 : t.status === 'waiting_customer' ? 1 : 2);
    // O mais urgente primeiro: sem resposta ainda, pelo prazo; senão, quem espera há mais tempo.
    const urgency = (t: SupportTicket) =>
      (t.firstResponseAt ? t.lastReplyAt : t.firstResponseDueAt ?? t.createdAt)?.getTime() ?? 0;

    return this.tickets()
      .filter(t => this.matchesFilter(t, this.filter()))
      .filter(t => this.owner() === 'all' || (this.owner() === 'mine' ? t.assigneeId === uid : !t.assigneeId))
      .filter(t => !term || normalizeSearch([
        t.protocol, t.userName, t.userEmail, t.subject, t.topicLabel, t.orderSnapshot?.shortId, t.assigneeName,
      ].filter(Boolean).join(' ')).includes(term))
      .sort((a, b) => {
        const byRank = rank(a) - rank(b);
        if (byRank) return byRank;
        return rank(a) === 0 ? urgency(a) - urgency(b) : (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);
      });
  });

  readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? this.tickets().find(t => t.id === id) ?? null : null;
  });

  readonly selectedMissing = computed(() => !!this.selectedId() && !this.loading() && !this.selected());

  readonly isMine = computed(() => !!this.selected() && this.selected()!.assigneeId === this.me?.uid);

  /** Quantos atendimentos a mesma pessoa já abriu. */
  readonly previous = computed(() => {
    const t = this.selected();
    return t ? this.tickets().filter(o => o.userId === t.userId && o.id !== t.id).length : 0;
  });

  readonly order = computed(() => {
    const o = this.selected()?.orderSnapshot;
    if (!o) return null;
    const labels = o.asRole === 'seller' ? SALE_STAGE_LABEL : STAGE_LABEL;
    return { ...o, stageLabel: o.stage ? labels[o.stage] : '', totalText: formatBRL(o.total) };
  });

  readonly uploading = computed(() => this.pending().some(p => p.state === 'uploading'));

  readonly canSend = computed(() =>
    !!this.selected() && this.selected()!.status !== 'closed' && !this.sending() && !this.uploading()
    && (this.text().trim().length > 0 || this.pending().length > 0));

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      this.stop?.();
      this.detailSubs.forEach(s => s.unsubscribe());
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => this.selectedId.set(params.get('ticket')));
    this.listen();

    // Abriu outro atendimento: carrega a conversa e as notas dele.
    effect(() => {
      const id = this.selectedId();
      untracked(() => this.openDetail(id));
    });

    // Chegou mensagem: rola até o fim.
    let seen = 0;
    effect(() => {
      const count = this.replies().length;
      if (count !== seen) {
        seen = count;
        setTimeout(() => {
          const el = this.thread()?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }, 50);
      }
    });

    // Atendimento aberto pela equipe: tira a marca de "cliente escreveu".
    effect(() => {
      const t = this.selected();
      if (t?.staffUnread && !this.markedRead.has(t.id)) {
        this.markedRead.add(t.id);
        void this.support.markReadByStaff(t.id).catch(err => console.warn('[atendimento] não marcou como lido', err));
      }
    });
  }

  private listen(): void {
    this.stop?.();
    this.loading.set(true);
    this.error.set('');
    const sub = this.support.watchAllTickets().subscribe({
      next: list => {
        this.tickets.set(list);
        this.loading.set(false);
      },
      error: err => {
        console.error('[atendimento] fila não carregou', err);
        this.error.set('Não foi possível carregar os atendimentos. As regras e o índice do Firestore já foram publicados?');
        this.loading.set(false);
      },
    });
    this.stop = () => sub.unsubscribe();
  }

  reload(): void {
    this.listen();
  }

  private openDetail(id: string | null): void {
    this.detailSubs.forEach(s => s.unsubscribe());
    this.detailSubs = [];
    this.replies.set([]);
    this.notes.set([]);
    this.repliesFailed.set(false);
    this.text.set('');
    this.pending.set([]);
    this.fileError.set(null);
    this.sendError.set(null);
    this.noteText.set('');
    if (!id) return;

    this.detailSubs.push(
      this.support.watchReplies(id).subscribe({
        next: list => this.replies.set(list),
        error: err => {
          console.error('[atendimento] conversa não carregou', err);
          this.repliesFailed.set(true);
        },
      }),
      this.support.watchNotes(id).subscribe({
        next: list => this.notes.set(list),
        error: err => console.warn('[atendimento] notas não carregaram', err),
      }),
    );
  }

  // ------------------------------------------------------------- navegação

  open(id: string): void {
    void this.router.navigate([], { queryParams: { ticket: id }, queryParamsHandling: 'merge' });
  }

  back(): void {
    void this.router.navigate([], { queryParams: { ticket: null }, queryParamsHandling: 'merge' });
  }

  // ----------------------------------------------------------------- exibição

  sla(t: SupportTicket): Sla {
    const now = this.now();
    if (t.status === 'resolved' || t.status === 'closed') return { label: this.statusLabel[t.status], tone: 'muted' };
    if (t.status === 'waiting_customer') return { label: `Cliente há ${this.span(now - (t.lastReplyAt?.getTime() ?? now))}`, tone: 'muted' };

    if (!t.firstResponseAt && t.firstResponseDueAt) {
      const diff = t.firstResponseDueAt.getTime() - now;
      if (diff < 0) return { label: `Atrasado ${this.span(-diff)}`, tone: 'danger' };
      return { label: `Vence em ${this.span(diff)}`, tone: diff < 4 * HOUR ? 'warn' : 'ok' };
    }
    return { label: `Cliente respondeu há ${this.span(now - (t.lastReplyAt?.getTime() ?? now))}`, tone: 'warn' };
  }

  private span(ms: number): string {
    const h = Math.round(ms / HOUR);
    if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
    if (h < 24) return `${h} h`;
    return `${Math.round(h / 24)} d`;
  }

  ago(date: Date | null): string {
    return relativeTime(date, new Date(this.now()));
  }

  stamp(date: Date | null): string {
    if (!date) return '—';
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return `hoje, ${time}`;
    return `${date.getDate()} ${MONTHS[date.getMonth()]}${date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : ''}, ${time}`;
  }

  eventText(r: SupportReply): string {
    const who = r.eventBy === 'user' ? 'O cliente' : 'A equipe';
    switch (r.event) {
      case 'resolved': return `${who} marcou como resolvido`;
      case 'reopened': return `${who} reabriu o atendimento`;
      case 'closed': return 'Atendimento encerrado';
      default: return '';
    }
  }

  // ----------------------------------------------------------------- ações

  async send(resolve = false): Promise<void> {
    const t = this.selected();
    if (!t || !this.canSend()) return;
    this.sending.set(true);
    this.sendError.set(null);
    try {
      await this.support.reply(t.id, {
        message: this.text().trim(),
        attachments: this.pending().filter(p => p.state === 'done').map(p => p.attachment!),
        status: resolve ? 'resolved' : undefined,
      });
      this.text.set('');
      this.pending.set([]);
    } catch (err) {
      this.sendError.set(err instanceof Error ? err.message : 'Não foi possível enviar agora.');
    } finally {
      this.sending.set(false);
    }
  }

  applyMacro(id: string): void {
    const t = this.selected();
    const macro: SupportMacro | undefined = this.macros.find(m => m.id === id);
    if (!t || !macro) return;
    const filled = fillMacro(macro.text, { name: t.userName, protocol: t.protocol, orderShortId: t.orderSnapshot?.shortId, subject: t.subject });
    this.text.update(current => (current.trim() ? `${current.trimEnd()}\n\n${filled}` : filled));
    document.getElementById('ms-text')?.focus();
  }

  async setStatus(status: SupportStatus): Promise<void> {
    const t = this.selected();
    if (!t || this.busy()) return;
    if (status === 'closed') {
      const alert = await this.alertCtrl.create({
        header: 'Encerrar atendimento?',
        message: 'O cliente não poderá mais responder neste atendimento (ele pode abrir outro). Use quando o caso acabou de vez.',
        buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Encerrar', role: 'confirm' }],
      });
      await alert.present();
      if ((await alert.onDidDismiss()).role !== 'confirm') return;
    }
    this.busy.set(true);
    try {
      await this.support.reply(t.id, { status });
    } catch (err) {
      await this.toast(err instanceof Error ? err.message : 'Não foi possível mudar o status.');
    } finally {
      this.busy.set(false);
    }
  }

  async assignToMe(): Promise<void> {
    const t = this.selected();
    if (!t || !this.me) return;
    await this.run(() => this.support.assign(t.id, { id: this.me!.uid, name: (this.me!.displayName || this.me!.email || 'Equipe').split(' ')[0] }));
  }

  async release(): Promise<void> {
    const t = this.selected();
    if (t) await this.run(() => this.support.assign(t.id, null));
  }

  async togglePriority(): Promise<void> {
    const t = this.selected();
    if (t) await this.run(() => this.support.setPriority(t.id, t.priority === 'high' ? 'normal' : 'high'));
  }

  async addNote(): Promise<void> {
    const t = this.selected();
    const text = this.noteText().trim();
    if (!t || !text || this.savingNote()) return;
    this.savingNote.set(true);
    try {
      await this.support.addNote(t.id, text);
      this.noteText.set('');
    } catch (err) {
      await this.toast(err instanceof Error ? err.message : 'Não foi possível salvar a nota.');
    } finally {
      this.savingNote.set(false);
    }
  }

  async copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      await this.toast(`${label} copiado.`);
    } catch {
      await this.toast(value);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (err) {
      console.error('[atendimento] ação falhou', err);
      await this.toast('Não foi possível concluir. Confira se as regras do Firestore foram publicadas.');
    } finally {
      this.busy.set(false);
    }
  }

  // ----------------------------------------------------------------- anexos

  pick(): void {
    this.fileInput()?.nativeElement.click();
  }

  async onFiles(event: Event): Promise<void> {
    const t = this.selected();
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!t) return;
    this.fileError.set(null);

    for (const file of files) {
      if (this.pending().length >= SUPPORT.maxAttachments) {
        this.fileError.set(`No máximo ${SUPPORT.maxAttachments} anexos por mensagem.`);
        break;
      }
      const key = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      this.pending.update(list => [...list, { key, name: file.name, size: file.size, state: 'uploading' }]);
      try {
        // A pasta é sempre a da pessoa dona do atendimento.
        const attachment = await this.support.uploadAttachment(t.id, file, t.userId);
        this.pending.update(list => list.map(p => (p.key === key ? { ...p, state: 'done', attachment } : p)));
      } catch (err) {
        this.pending.update(list => list.filter(p => p.key !== key));
        this.fileError.set(err instanceof Error ? err.message : 'Não foi possível anexar.');
      }
    }
  }

  removePending(key: string): void {
    this.pending.update(list => list.filter(p => p.key !== key));
  }

  isOpen(t: SupportTicket): boolean {
    return isOpenStatus(t.status);
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 2600, position: 'bottom' });
    await toast.present();
  }
}
