import {
  Component, OnInit, OnDestroy, Input, ViewChild, ElementRef, Output, EventEmitter,
  HostListener, inject, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonSpinner, AlertController, ToastController } from '@ionic/angular/standalone';
import { Subscription, firstValueFrom } from 'rxjs';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { GrokAiService } from '../../services/grok-ai.service';
import { FirebaseProducts } from '../../services/firebase-products';
import { SellerDirectoryService } from '../../services/seller-directory.service';
import { NotificationCenterService } from '../../services/notification-center.service';
import { ChatRoom, ChatMessage, ChatParticipant } from '../../interfaces/chat';
import { VnIconComponent } from '../vn-icon/vn-icon.component';
import {
  chatSellerId, clockTime, dayLabel, displayOf, initialsOf, otherParticipantOf, toMillis, unreadOf
} from '../../core/chat-view';

/** Uma linha da conversa: separador de dia, marca de "novas" ou mensagem. */
type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'new'; key: string; count: number }
  | { kind: 'msg'; key: string; msg: ChatMessage; mine: boolean; first: boolean; last: boolean; time: string; read: boolean };

/** Mensagens do mesmo lado com menos de 3 min entre si formam um bloco. */
const GROUP_GAP_MS = 3 * 60_000;

/**
 * A conversa em si: cabeçalho com quem está do outro lado e o anúncio, as
 * mensagens e o campo de escrever. Usada pela rota /chat-details, pelo painel
 * de Mensagens no desktop, pelo anúncio, pela página da loja e pelo admin.
 *
 * O host decide a altura; a caixa ocupa 100% e rola só a lista.
 */
@Component({
  selector: 'app-chat-box',
  templateUrl: './chat-box.component.html',
  styleUrls: ['./chat-box.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonSpinner, VnIconComponent]
})
export class ChatBoxComponent implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly directory = inject(SellerDirectoryService);
  private readonly notifications = inject(NotificationCenterService);

  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;
  @ViewChild('composer') composer?: ElementRef<HTMLTextAreaElement>;

  private _chatId: string = '';
  @Input()
  set chatId(value: string) {
    if (value && value !== this._chatId) {
      this._chatId = value;
      this.loadChat();
    } else {
      this._chatId = value;
    }
  }
  get chatId(): string {
    return this._chatId;
  }
  /** Botão de voltar no cabeçalho (tela cheia do celular). */
  @Input() backable = false;
  /** Botão de fechar no cabeçalho (painel do anúncio, janela da loja). */
  @Input() closable = false;
  @Input() showHeader = true;
  /**
   * Mostra a conversa do ponto de vista desta conta (as mensagens dela à
   * direita). O admin observa uma conversa da qual não participa: com a loja
   * aqui, cliente fica à esquerda e loja à direita.
   */
  @Input() viewAs?: string;
  @Input() aiSimulationActive: boolean = false;
  @Output() onClose = new EventEmitter<void>();
  @Output() onBack = new EventEmitter<void>();
  @Output() onChatClosed = new EventEmitter<string>(); // Emite chatId quando conversa é finalizada

  chatRoom?: ChatRoom;
  messages: ChatMessage[] = [];
  outgoingMessages: ChatMessage[] = [];
  rows: Row[] = [];
  newMessage: string = '';
  isAiTyping: boolean = false;

  selectedImage: string | null = null;
  isChatClosed: boolean = false;
  menuOpen = false;

  currentUserId?: string;
  otherParticipant?: ChatParticipant;
  other = { name: '', photo: '', isStore: false, initials: '' };
  /** Quem está logado é a loja desta conversa. */
  iAmSeller = false;
  /** Participa da conversa (o admin só observa). */
  isParticipant = false;

  isLoading = true;
  /** Mensagens novas que chegaram com a pessoa lendo lá em cima. */
  pendingBelow = 0;
  readonly canRecord = typeof window !== 'undefined' && 'ontouchstart' in window;
  readonly quickReplies = ['Ainda está disponível?', 'Qual o prazo de entrega?', 'Aceita uma proposta?'];

  private sub?: Subscription;
  private roomSub?: Subscription;
  /** Não lidas no momento em que a conversa abriu — posição da marca "novas". */
  private unreadAtOpen: number | null = null;
  private marking = false;
  private firstPaint = true;
  private lastCount = 0;

  // Audio Logic
  isRecording = false;
  mediaRecorder?: MediaRecorder;
  audioChunks: Blob[] = [];
  recordingDuration = 0;
  recordInterval: any;
  isDraggingToCancel = false;

  constructor(
    private chatService: FirebaseChatService,
    private grokService: GrokAiService,
    private productService: FirebaseProducts,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {
    // Identifica o usuário imediatamente no construtor para que o setter de chatId possa usá-lo
    this.currentUserId = this.chatService.getCurrentUser()?.uid;
  }

  get allMessages(): ChatMessage[] {
    // A mensagem otimista some assim que a real (mesmo clientId) chega.
    const filteredReal = this.messages.filter(m =>
      !this.outgoingMessages.some(out => out.clientId && m.clientId && out.clientId === m.clientId)
    );
    return [...filteredReal, ...this.outgoingMessages];
  }

  ngOnInit() {
    if (this.chatId && !this.chatRoom) this.loadChat();
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.roomSub?.unsubscribe();
    if (this.recordInterval) clearInterval(this.recordInterval);
  }

  async loadChat() {
    if (!this.chatId) return;

    this.isLoading = true;
    this.messages = [];
    this.outgoingMessages = [];
    this.rows = [];
    this.chatRoom = undefined;
    this.otherParticipant = undefined;
    this.unreadAtOpen = null;
    this.firstPaint = true;
    this.pendingBelow = 0;
    this.lastCount = 0;
    this.menuOpen = false;
    this.sub?.unsubscribe();
    this.roomSub?.unsubscribe();

    // Logo ao abrir o app a sessão ainda pode estar sendo restaurada: sem o
    // uid certo, toda mensagem parecia "do outro lado".
    if (!this.currentUserId) {
      const user = await this.chatService.waitForUser();
      if (!user) return;
      this.currentUserId = user.uid;
    }

    const chatId = this.chatId;
    this.notifications.markReadForLink(`/chat-details/${chatId}`);

    this.roomSub = this.chatService.watchChat(chatId).subscribe({
      next: room => {
        if (chatId !== this.chatId) return;
        this.chatRoom = room;
        if (room) this.applyRoom(room);
        this.rebuildRows();
      },
      error: e => console.error('Conversa indisponível', e)
    });

    this.sub = this.chatService.getMessages(chatId).subscribe({
      next: (msgs) => {
        if (chatId !== this.chatId) return;
        this.messages = msgs.sort((a, b) => (toMillis(a.createdAt) ?? Infinity) - (toMillis(b.createdAt) ?? Infinity));
        this.isLoading = false;
        this.rebuildRows();
        this.afterMessages();
      },
      error: (e) => {
        console.error("Error reading messages", e);
        this.isLoading = false;
      }
    });
  }

  /** De que lado a conversa é desenhada (quem fica à direita). */
  private get viewer(): string | undefined {
    return this.viewAs || this.currentUserId;
  }

  private applyRoom(room: ChatRoom) {
    const me = this.currentUserId;
    this.isParticipant = !!me && (room.participantIds?.includes(me) ?? false);
    this.otherParticipant = otherParticipantOf(room, this.viewer);
    this.isChatClosed = room.status === 'closed';
    this.iAmSeller = !!me && chatSellerId(room) === me;

    const otherUid = this.otherParticipant?.uid;
    if (otherUid) {
      void this.directory.ensure([otherUid]).then(() => this.refreshOther());
    }
    this.refreshOther();

    if (this.unreadAtOpen === null) this.unreadAtOpen = unreadOf(room, me);
    this.markReadIfVisible();
  }

  private refreshOther() {
    if (!this.chatRoom) return;
    const profile = this.otherParticipant ? this.directory.profiles()[this.otherParticipant.uid] : null;
    const d = displayOf(this.chatRoom, this.otherParticipant, profile);
    this.other = { ...d, initials: initialsOf(d.name) };
    this.cdr.markForCheck();
  }

  /** Conversa na tela: o que chegou já está lido. */
  private markReadIfVisible() {
    if (!this.isParticipant || this.marking || !this.chatRoom) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (unreadOf(this.chatRoom, this.currentUserId) === 0) return;
    this.marking = true;
    this.chatService.markRead(this.chatId)
      .catch(e => console.warn('Não marcou a conversa como lida', e))
      .finally(() => { this.marking = false; });
  }

  @HostListener('document:visibilitychange')
  onVisibility() {
    this.markReadIfVisible();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.selectedImage) this.closeImage();
    else this.menuOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.menuOpen) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.cb-menu-wrap')) this.menuOpen = false;
  }

  /** Monta as linhas: dia, marca de novas e blocos por remetente. */
  private rebuildRows() {
    const me = this.viewer;
    const msgs = this.allMessages;
    const otherUid = this.otherParticipant?.uid;
    const otherRead = otherUid ? toMillis(this.chatRoom?.readAt?.[otherUid]) : null;

    // A marca "novas" fica antes da N-ésima última mensagem do outro lado.
    let newBefore = -1;
    const unread = this.unreadAtOpen ?? 0;
    if (unread > 0) {
      let seen = 0;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].senderId !== me) seen++;
        if (seen === unread) { newBefore = i; break; }
      }
    }

    const rows: Row[] = [];
    let lastDay = '';
    const now = Date.now();
    msgs.forEach((msg, i) => {
      const ms = toMillis(msg.createdAt) ?? now;
      const day = new Date(ms).toDateString();
      if (day !== lastDay) {
        rows.push({ kind: 'day', key: 'd' + day, label: dayLabel(ms, now) });
        lastDay = day;
      }
      if (i === newBefore) rows.push({ kind: 'new', key: 'new', count: unread });

      const prev = msgs[i - 1];
      const next = msgs[i + 1];
      const prevMs = prev ? toMillis(prev.createdAt) ?? now : 0;
      const nextMs = next ? toMillis(next.createdAt) ?? now : 0;
      const sameAsPrev = !!prev && prev.senderId === msg.senderId && ms - prevMs < GROUP_GAP_MS
        && new Date(prevMs).toDateString() === day && i !== newBefore;
      const sameAsNext = !!next && next.senderId === msg.senderId && nextMs - ms < GROUP_GAP_MS
        && new Date(nextMs).toDateString() === day && i + 1 !== newBefore;
      const mine = msg.senderId === me;
      rows.push({
        kind: 'msg',
        key: msg.clientId || msg.id || 'i' + i,
        msg, mine,
        first: !sameAsPrev,
        last: !sameAsNext,
        time: clockTime(toMillis(msg.createdAt)),
        read: mine && !msg.status && otherRead != null && ms <= otherRead
      });
    });
    this.rows = rows;
  }

  /** Rolagem depois de chegar mensagem: fundo, a marca "novas" ou o aviso. */
  private afterMessages() {
    const count = this.allMessages.length;
    const grew = count > this.lastCount;
    const lastIsMine = this.allMessages[count - 1]?.senderId === this.currentUserId;
    this.lastCount = count;

    if (this.firstPaint) {
      this.firstPaint = false;
      setTimeout(() => {
        const marker = this.scroller?.nativeElement.querySelector('.cb-new') as HTMLElement | null;
        if (marker) this.scrollTo(marker.offsetTop - 16, false);
        else this.scrollToBottom(false);
      }, 30);
      return;
    }
    if (!grew) return;
    if (lastIsMine || this.isNearBottom()) {
      setTimeout(() => this.scrollToBottom(true), 30);
    } else {
      this.pendingBelow++;
    }
    this.markReadIfVisible();
  }

  private isNearBottom(): boolean {
    const el = this.scroller?.nativeElement;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }

  onScroll() {
    if (this.pendingBelow && this.isNearBottom()) this.pendingBelow = 0;
  }

  private scrollTo(top: number, smooth: boolean) {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }

  scrollToBottom(smooth = true) {
    const el = this.scroller?.nativeElement;
    if (el) this.scrollTo(el.scrollHeight, smooth);
    this.pendingBelow = 0;
  }

  // --- ESCREVER ---

  onComposerKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.sendMessage();
    }
  }

  autoGrow() {
    const el = this.composer?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  useQuickReply(text: string) {
    this.newMessage = text;
    setTimeout(() => {
      this.composer?.nativeElement.focus();
      this.autoGrow();
    });
  }

  private recipients(): string[] | undefined {
    return this.chatRoom?.participantIds?.filter(id => id !== this.currentUserId);
  }

  private pushOutgoing(msg: ChatMessage) {
    this.outgoingMessages.push(msg);
    this.rebuildRows();
    this.afterMessages();
  }

  private dropOutgoing(msg: ChatMessage) {
    this.outgoingMessages = this.outgoingMessages.filter(m => m !== msg);
    this.rebuildRows();
  }

  async sendMessage() {
    const text = this.newMessage.trim();
    if (!text || this.isChatClosed) return;
    this.newMessage = '';
    setTimeout(() => this.autoGrow());

    const clientId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const tempMsg: ChatMessage = {
      senderId: this.currentUserId!,
      text,
      type: 'text',
      createdAt: { seconds: Date.now() / 1000 },
      status: 'sending',
      clientId
    };
    this.pushOutgoing(tempMsg);

    try {
      await this.chatService.sendMessage(this.chatId, { text, type: 'text', clientId }, this.recipients());
      this.dropOutgoing(tempMsg);

      // Gatilho da IA (Grok) simulando resposta do vendedor se ativado
      if (this.aiSimulationActive && this.otherParticipant?.uid) {
        this.isAiTyping = true;
        this.scrollToBottom();

        let productDesc = '';
        if (this.chatRoom?.productId) {
          try {
            const prod = await firstValueFrom(this.productService.getById(this.chatRoom.productId));
            if (prod) productDesc = prod.description || '';
          } catch (e) {
            console.warn("Não foi possível carregar descrição para IA", e);
          }
        }

        const response = await this.grokService.simulateSellerResponse(
          this.allMessages,
          this.chatRoom?.productName || 'produto',
          this.currentUserId!,
          productDesc
        );

        await this.chatService.sendSystemMessage(this.chatId, this.otherParticipant.uid, response);
        this.isAiTyping = false;
        this.scrollToBottom();
      }
    } catch (e: any) {
      console.error("Failed", e);
      tempMsg.status = 'error';
      this.rebuildRows();
      this.isAiTyping = false;
      if (e?.message) void this.showToast(e.message, 'danger');
    }
  }

  async retry(msg: ChatMessage) {
    this.dropOutgoing(msg);
    if (msg.type === 'text') {
      this.newMessage = msg.text;
      await this.sendMessage();
    }
  }

  // --- IMAGEM ---
  async onFileSelected(event: any) {
    const file: File | undefined = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      void this.showToast('Escolha uma foto (JPG, PNG ou WebP).', 'danger');
      return;
    }

    const clientId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const tempMsg: ChatMessage = {
      senderId: this.currentUserId!,
      text: '',
      type: 'image',
      mediaUrl: URL.createObjectURL(file),
      createdAt: { seconds: Date.now() / 1000 },
      status: 'sending',
      clientId
    };
    this.pushOutgoing(tempMsg);

    try {
      const path = `chats/${this.chatId}/${Date.now()}_${file.name.replace(/[^\w.-]/g, '_')}`;
      const url = await this.chatService.uploadFile(file, path);
      await this.chatService.sendMessage(this.chatId, { text: '', type: 'image', mediaUrl: url, clientId }, this.recipients());
      this.dropOutgoing(tempMsg);
    } catch (e) {
      console.error("Upload error", e);
      tempMsg.status = 'error';
      this.rebuildRows();
    }
  }

  // --- ÁUDIO (segurar para gravar, arrastar para a esquerda cancela) ---
  async startRecording(event: any) {
    event.preventDefault();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
      this.mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        void this.handleAudioStop();
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingDuration = 0;
      this.isDraggingToCancel = false;

      this.recordInterval = setInterval(() => this.recordingDuration++, 1000);
    } catch (e) {
      console.error("Mic access denied", e);
      void this.showToast('Libere o microfone nas permissões do navegador para gravar áudio.', 'danger');
    }
  }

  handleTouchMove(event: TouchEvent) {
    if (!this.isRecording) return;
    this.isDraggingToCancel = event.touches[0].clientX < 100;
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      clearInterval(this.recordInterval);
    }
  }

  async handleAudioStop() {
    if (this.isDraggingToCancel) return;

    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
    if (audioBlob.size < 1000) return;

    const clientId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const tempMsg: ChatMessage = {
      senderId: this.currentUserId!,
      text: '',
      type: 'audio',
      mediaUrl: URL.createObjectURL(audioBlob),
      createdAt: { seconds: Date.now() / 1000 },
      status: 'sending',
      clientId
    };
    this.pushOutgoing(tempMsg);

    try {
      const path = `chats/${this.chatId}/${Date.now()}_audio.webm`;
      const url = await this.chatService.uploadFile(audioBlob, path);
      await this.chatService.sendMessage(this.chatId, { text: '', type: 'audio', mediaUrl: url, clientId }, this.recipients());
      this.dropOutgoing(tempMsg);
    } catch (e) {
      console.error("Audio upload error", e);
      tempMsg.status = 'error';
      this.rebuildRows();
    }
  }

  /**
   * Rola o chat até uma mensagem específica pelo ID.
   * Útil para o Audit Hub e navegação no Heatmap.
   */
  public scrollToMessage(messageId: string) {
    const root = this.scroller?.nativeElement;
    if (!root || !messageId) return;

    const id = messageId.startsWith('msg-') ? messageId : `msg-${messageId}`;
    const el = root.querySelector<HTMLElement>(`[id="${id}"]`);
    if (el) {
      this.scrollTo(el.offsetTop - 120, true);
      el.classList.add('highlight-pulse');
      setTimeout(() => el.classList.remove('highlight-pulse'), 2000);
    }
  }

  openImage(url: string) {
    this.selectedImage = url;
  }

  closeImage() {
    this.selectedImage = null;
  }

  formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  trackRow(_: number, row: Row) {
    return row.key;
  }

  // --- MENU ---

  toggleMenu(event: Event) {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  goToProduct() {
    this.menuOpen = false;
    if (this.chatRoom?.productId) {
      this.router.navigate(['/product-details', this.chatRoom.productId]);
    }
  }

  get storeLink(): string[] | null {
    return this.other.isStore && this.otherParticipant ? ['/seller-profile', this.otherParticipant.uid] : null;
  }

  async promptCloseChat() {
    this.menuOpen = false;
    const alert = await this.alertCtrl.create({
      header: 'Encerrar esta conversa?',
      message: 'Ninguém mais poderá mandar mensagens aqui. O histórico continua salvo para os dois lados.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Encerrar conversa', role: 'destructive', handler: () => { void this.confirmCloseChat(); } }
      ]
    });
    await alert.present();
  }

  private async confirmCloseChat() {
    try {
      await this.chatService.closeChat(this.chatId);
      this.isChatClosed = true;
      void this.showToast('Conversa encerrada.', 'dark');
      setTimeout(() => this.onChatClosed.emit(this.chatId), 600);
    } catch (e) {
      console.error('Erro ao finalizar conversa:', e);
      void this.showToast('Não deu para encerrar a conversa. Tente de novo.', 'danger');
    }
  }

  async openReportModal() {
    this.menuOpen = false;
    if (!this.otherParticipant) return;

    const alert = await this.alertCtrl.create({
      header: 'Denunciar conversa',
      message: `O que aconteceu com ${this.other.name}?`,
      inputs: [
        { name: 'reason', type: 'radio', label: 'Spam ou mensagens repetidas', value: 'spam', checked: true },
        { name: 'reason', type: 'radio', label: 'Ofensa ou comportamento inadequado', value: 'abuse' },
        { name: 'reason', type: 'radio', label: 'Tentativa de golpe', value: 'scam' },
        { name: 'reason', type: 'radio', label: 'Outro motivo', value: 'other' }
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Continuar',
          handler: (reason) => {
            if (reason === 'other') this.showOtherDetailsInput(reason);
            else this.submitReport(reason);
          }
        }
      ]
    });

    await alert.present();
  }

  private async showOtherDetailsInput(reason: string) {
    const alert = await this.alertCtrl.create({
      header: 'Conte o que aconteceu',
      inputs: [
        { name: 'details', type: 'textarea', placeholder: 'Descreva em poucas linhas' }
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Enviar denúncia', handler: (data) => { this.submitReport(reason, data.details); } }
      ]
    });
    await alert.present();
  }

  private async submitReport(reason: any, details?: string) {
    if (!this.currentUserId || !this.otherParticipant || !this.chatId) return;

    try {
      await this.chatService.reportUser({
        senderId: this.currentUserId,
        senderName: this.chatService.getCurrentUser()?.displayName || 'Usuário',
        reportedUserId: this.otherParticipant.uid,
        chatId: this.chatId,
        productName: this.chatRoom?.productName,
        reason: reason as any,
        details: details
      });
      void this.showToast('Denúncia enviada. A equipe da Vineon vai analisar.', 'dark');
    } catch (e) {
      console.error("Erro ao enviar denúncia:", e);
      void this.showToast('Não deu para enviar a denúncia. Tente de novo.', 'danger');
    }
  }

  private async showToast(message: string, color: 'dark' | 'danger') {
    const toast = await this.toastCtrl.create({ message, duration: 3000, color, position: 'top' });
    await toast.present();
  }
}
