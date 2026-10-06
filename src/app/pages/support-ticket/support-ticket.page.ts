import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AlertController, IonContent, IonicModule, NavController, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { SupportFileComponent } from '../../components/support-file/support-file.component';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { STAGE_LABEL, SALE_STAGE_LABEL, formatBRL } from '../../core/order-stage';
import {
  SUPPORT, SUPPORT_STATUS_LABEL, formatFileSize, isOpenStatus, relativeTime,
} from '../../core/support-config';
import { SupportAttachment, SupportReply, SupportTicket } from '../../interfaces/support';
import { SupportService } from '../../services/support.service';

interface Pending {
  key: string;
  name: string;
  size: number;
  preview: string | null;
  state: 'uploading' | 'done';
  attachment?: SupportAttachment;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * A conversa de um atendimento: o que a pessoa escreveu, o que a Vineon
 * respondeu e os marcos (resolvido, reaberto). Tempo real. A pessoa pode
 * responder, anexar, marcar como resolvido e, resolvido, avaliar.
 */
@Component({
  selector: 'app-support-ticket',
  templateUrl: './support-ticket.page.html',
  styleUrls: ['./support-ticket.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, RouterLink, VnIconComponent, SupportFileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportTicketPage {
  private readonly support = inject(SupportService);
  private readonly navCtrl = inject(NavController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  readonly info = SUPPORT;
  readonly statusLabel = SUPPORT_STATUS_LABEL;
  readonly fileSize = formatFileSize;
  readonly stars = [1, 2, 3, 4, 5];

  /** `undefined` = carregando; `null` = não existe (ou não é desta pessoa). */
  readonly ticket = signal<SupportTicket | null | undefined>(undefined);
  readonly replies = signal<SupportReply[]>([]);
  readonly loadFailed = signal(false);

  readonly text = signal('');
  readonly pending = signal<Pending[]>([]);
  readonly fileError = signal<string | null>(null);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly acting = signal(false);

  readonly score = signal(0);
  readonly comment = signal('');
  readonly rating = signal(false);

  private readonly content = viewChild(IonContent);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly subs: Subscription[] = [];
  private markedRead = false;

  /** Resolvido há mais de 7 dias: não reabre, abre outro. */
  readonly canReopen = computed(() => {
    const t = this.ticket();
    if (!t || t.status !== 'resolved') return true;
    const at = t.resolvedAt?.getTime();
    return !at || Date.now() - at <= SUPPORT.reopenDays * 24 * 60 * 60 * 1000;
  });

  readonly canReply = computed(() => {
    const t = this.ticket();
    return !!t && t.status !== 'closed' && this.canReopen();
  });

  readonly open = computed(() => {
    const t = this.ticket();
    return !!t && isOpenStatus(t.status);
  });

  readonly uploading = computed(() => this.pending().some(p => p.state === 'uploading'));
  readonly canSend = computed(() =>
    this.canReply() && !this.sending() && !this.uploading()
    && (this.text().trim().length > 0 || this.pending().length > 0));

  readonly orderLabel = computed(() => {
    const o = this.ticket()?.orderSnapshot;
    if (!o) return null;
    const labels = o.asRole === 'seller' ? SALE_STAGE_LABEL : STAGE_LABEL;
    return { ...o, stageLabel: o.stage ? labels[o.stage] : '', totalText: formatBRL(o.total) };
  });

  readonly orderLink = computed(() => {
    const t = this.ticket();
    if (!t?.orderId || !t.orderSnapshot) return null;
    return t.orderSnapshot.asRole === 'seller'
      ? { path: ['/sale-details', t.orderId], query: null }
      : { path: ['/my-orders'], query: t.orderSnapshot.stage ? { aba: t.orderSnapshot.stage } : null };
  });

  constructor() {
    this.subs.push(
      this.support.watchTicket(this.id).subscribe({
        next: t => this.ticket.set(t),
        error: err => {
          // Atendimento de outra pessoa ou apagado: a regra recusa a leitura.
          console.error('[atendimento] não abriu', err);
          this.ticket.set(null);
        },
      }),
      this.support.watchReplies(this.id).subscribe({
        next: list => {
          this.replies.set(list);
          this.loadFailed.set(false);
        },
        error: err => {
          console.error('[atendimento] não carregou a conversa', err);
          this.loadFailed.set(true);
        },
      }),
    );
    inject(DestroyRef).onDestroy(() => {
      this.subs.forEach(s => s.unsubscribe());
      this.pending().forEach(p => p.preview && URL.revokeObjectURL(p.preview));
    });

    // Abriu a conversa: tira a marca de "resposta nova" (uma vez por visita).
    effect(() => {
      const t = this.ticket();
      if (t?.userUnread && !this.markedRead) {
        this.markedRead = true;
        void this.support.markReadByUser(this.id).catch(err => console.warn('[atendimento] não marcou como lido', err));
      }
    });

    // Mensagem nova: rola até o fim.
    let last = 0;
    effect(() => {
      const count = this.replies().length;
      if (count !== last) {
        last = count;
        setTimeout(() => void this.content()?.scrollToBottom(count > 1 ? 250 : 0), 60);
      }
    });
  }

  // -------------------------------------------------------------- exibição

  stamp(date: Date | null): string {
    if (!date) return '';
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return time;
    const day = `${date.getDate()} ${MONTHS[date.getMonth()]}${date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : ''}`;
    return `${day} · ${time}`;
  }

  ago(date: Date | null): string {
    return relativeTime(date);
  }

  eventText(r: SupportReply): string {
    const mine = r.eventBy === 'user';
    switch (r.event) {
      case 'resolved': return mine ? 'Você marcou como resolvido' : 'A Vineon marcou como resolvido';
      case 'reopened': return mine ? 'Você reabriu o atendimento' : 'A Vineon reabriu o atendimento';
      case 'closed': return 'Atendimento encerrado';
      default: return '';
    }
  }

  // ---------------------------------------------------------------- ações

  async send(): Promise<void> {
    if (!this.canSend()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      await this.support.reply(this.id, {
        message: this.text().trim(),
        attachments: this.pending().filter(p => p.state === 'done').map(p => p.attachment!),
      });
      this.text.set('');
      this.pending().forEach(p => p.preview && URL.revokeObjectURL(p.preview));
      this.pending.set([]);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Não foi possível enviar agora.');
    } finally {
      this.sending.set(false);
    }
  }

  async markResolved(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Marcar como resolvido?',
      message: `Se precisar, você pode reabrir em até ${SUPPORT.reopenDays} dias, só escrevendo aqui.`,
      buttons: [
        { text: 'Ainda não', role: 'cancel' },
        { text: 'Sim, resolvido', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    this.acting.set(true);
    try {
      await this.support.reply(this.id, { status: 'resolved' });
    } catch (err) {
      await this.toast(err instanceof Error ? err.message : 'Não foi possível concluir agora.');
    } finally {
      this.acting.set(false);
    }
  }

  focusComposer(): void {
    document.getElementById('st-text')?.focus();
  }

  async sendRating(): Promise<void> {
    if (!this.score() || this.rating()) return;
    this.rating.set(true);
    try {
      await this.support.rate(this.id, this.score(), this.comment());
      await this.toast('Obrigado pela avaliação!');
    } catch (err) {
      console.error('[atendimento] não salvou a avaliação', err);
      await this.toast('Não foi possível enviar a avaliação agora.');
    } finally {
      this.rating.set(false);
    }
  }

  async copyProtocol(): Promise<void> {
    const protocol = this.ticket()?.protocol;
    if (!protocol) return;
    try {
      await navigator.clipboard.writeText(protocol);
      await this.toast('Protocolo copiado.');
    } catch {
      await this.toast(`Protocolo: ${protocol}`);
    }
  }

  newFromThis(): Record<string, string> {
    const t = this.ticket();
    return t ? { assunto: t.topic, perfil: t.userRole === 'seller' ? 'sell' : 'buy', relacionado: t.id } : {};
  }

  // --------------------------------------------------------------- anexos

  pick(): void {
    this.fileInput()?.nativeElement.click();
  }

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.fileError.set(null);

    for (const file of files) {
      if (this.pending().length >= SUPPORT.maxAttachments) {
        this.fileError.set(`Você pode anexar até ${SUPPORT.maxAttachments} arquivos por mensagem.`);
        break;
      }
      const key = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      this.pending.update(list => [...list, { key, name: file.name, size: file.size, preview, state: 'uploading' }]);
      try {
        const attachment = await this.support.uploadAttachment(this.id, file);
        this.pending.update(list => list.map(p => (p.key === key ? { ...p, state: 'done', attachment } : p)));
      } catch (err) {
        this.removePending(key);
        this.fileError.set(err instanceof Error ? err.message : 'Não foi possível anexar este arquivo.');
      }
    }
  }

  removePending(key: string): void {
    const found = this.pending().find(p => p.key === key);
    if (found?.preview) URL.revokeObjectURL(found.preview);
    this.pending.update(list => list.filter(p => p.key !== key));
  }

  goBack(): void {
    if (window.history.length > 1) this.navCtrl.back();
    else void this.navCtrl.navigateRoot('/support');
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 2400, position: 'bottom' });
    await toast.present();
  }
}
