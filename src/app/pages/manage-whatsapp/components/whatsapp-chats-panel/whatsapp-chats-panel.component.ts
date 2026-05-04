import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { environment } from '../../../../../environments/environment';
import { MediaCacheService } from '../../../../services/media-cache.service';
import { WhatsappInstancesService } from '../../../../services/whatsapp-instances.service';
import {
  WhatsappChatRow,
  WhatsappInstanceView,
  WhatsappMessagePageMeta,
  WhatsappMessageRow,
  getErrorMessage,
  isInstanceConnected
} from '../../manage-whatsapp.types';
import { WhatsappGalleryModalComponent } from '../whatsapp-gallery-modal/whatsapp-gallery-modal.component';
import { WhatsappImageViewerComponent } from '../whatsapp-image-viewer/whatsapp-image-viewer.component';
import { WhatsappLockModalComponent } from '../whatsapp-lock-modal/whatsapp-lock-modal.component';

@Component({
  selector: 'app-whatsapp-chats-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    WhatsappGalleryModalComponent,
    WhatsappImageViewerComponent,
    WhatsappLockModalComponent
  ],
  templateUrl: './whatsapp-chats-panel.component.html',
  styleUrls: ['./whatsapp-chats-panel.component.scss']
})
export class WhatsappChatsPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() instances: WhatsappInstanceView[] = [];
  @Input() active = true;

  public errorMessage = '';
  public chatsInstanceName = '';
  public loadingChats = false;
  public loadingMessages = false;
  public checkingChatLock = false;
  public chatRows: WhatsappChatRow[] = [];
  public messageRows: WhatsappMessageRow[] = [];
  public selectedChatJid = '';
  public selectedChatTitle = '';
  public selectedChatAvatarUrl = '';
  public chatSearchTerm = '';
  public currentMessagesPage = 1;
  public totalMessagesPages = 1;
  public loadingOlderMessages = false;
  public composerText = '';
  public isComposerSending = false;

  public lockModalOpen = false;
  public lockModalIntent: 'lock' | 'unlock' = 'unlock';
  public lockCodeInput = '';
  public lockMaskedNumber = '';
  public lockStatusByInstance: Record<string, boolean> = {};
  public lockActionLoading = false;
  public lockModalMessage = '';

  public audioPlayingId = '';
  public audioCurrentTimeById: Record<string, number> = {};
  public audioDurationById: Record<string, number> = {};
  /** Áudio só pode tocar após buffer/decodificação (`canplaythrough`). */
  public audioDecodeStateById: Record<string, 'loading' | 'ready' | 'error'> = {};
  public imageLoadStateById: Record<string, 'loading' | 'loaded' | 'error'> = {};
  public videoLoadStateById: Record<string, 'loading' | 'loaded' | 'error'> = {};

  public imageViewerUrl = '';
  public galleryOpen = false;
  public galleryRows: WhatsappMessageRow[] = [];
  public galleryLoadingOlder = false;
  public galleryHasMore = false;

  private galleryPageCursor = 1;
  private activeAudioEl: HTMLAudioElement | null = null;
  private liveSyncTimer: ReturnType<typeof setInterval> | null = null;
  private liveSyncInFlight = false;
  private resolvingMediaIds = new Set<string>();
  private failedMediaIds = new Set<string>();
  /** Retentativas automáticas ao falhar carregamento de imagem/figurinha (backoff). */
  private readonly maxImageAutoRetries = 12;
  private imageAutoRetryAttemptById = new Map<string, number>();
  private imageAutoRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private componentDestroyed = false;
  /** Evita aplicar resposta de fetch antigo ao trocar de conversa. */
  private loadingThreadGeneration = 0;

  @ViewChild('threadMessages') private threadMessagesRef?: ElementRef<HTMLDivElement>;
  @ViewChild('composerImageInput') private composerImageInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('composerFileInput') private composerFileInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('composerAudioInput') private composerAudioInputRef?: ElementRef<HTMLInputElement>;

  isInstanceConnected = isInstanceConnected;

  constructor(
    private whatsappService: WhatsappInstancesService,
    private mediaCache: MediaCacheService
  ) {}

  ngOnInit(): void {
    this.autoSelectConnectedInstance();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['instances'] && !changes['instances'].firstChange) {
      this.autoSelectConnectedInstance();
    }
    if (changes['active']) {
      if (this.active) {
        this.startLiveSync();
        if (this.chatsInstanceName.trim()) {
          void this.enforceLockBeforeOpeningChats(this.chatsInstanceName.trim());
        }
      } else {
        this.stopLiveSync();
      }
    }
  }

  ngOnDestroy(): void {
    this.componentDestroyed = true;
    this.stopLiveSync();
    this.stopActiveAudio();
    for (const t of this.imageAutoRetryTimers.values()) {
      clearTimeout(t);
    }
    this.imageAutoRetryTimers.clear();
  }

  get filteredChatRows(): WhatsappChatRow[] {
    const term = this.chatSearchTerm.trim().toLowerCase();
    if (!term) return this.chatRows;
    return this.chatRows.filter(row =>
      row.title.toLowerCase().includes(term)
      || row.preview.toLowerCase().includes(term)
      || row.remoteJid.toLowerCase().includes(term)
    );
  }

  get selectedChatSubtitle(): string {
    return this.selectedChatJid || '';
  }

  get galleryMediaRows(): WhatsappMessageRow[] {
    return this.galleryRows;
  }

  trackMessageRow(row: WhatsappMessageRow): string {
    return row.id;
  }

  onChatsInstanceChange(): void {
    this.loadingThreadGeneration += 1;
    this.stopLiveSync();
    this.chatRows = [];
    this.messageRows = [];
    this.selectedChatJid = '';
    this.selectedChatTitle = '';
    this.selectedChatAvatarUrl = '';
    this.stopActiveAudio();
    this.failedMediaIds.clear();
    this.mediaCache.clearFailedIds();
    if (this.chatsInstanceName.trim()) {
      void this.enforceLockBeforeOpeningChats(this.chatsInstanceName.trim());
    }
  }

  async loadChats(): Promise<void> {
    const instanceName = this.chatsInstanceName.trim();
    if (!instanceName) {
      this.errorMessage = 'Selecione uma instância conectada para ver as conversas.';
      return;
    }

    this.loadingChats = true;
    this.errorMessage = '';

    try {
      const raw = await this.whatsappService.listEvolutionChats(instanceName);
      this.chatRows = this.normalizeEvolutionChatsPayload(raw);
      if (this.selectedChatJid && !this.chatRows.some(c => c.remoteJid === this.selectedChatJid)) {
        this.stopLiveSync();
        this.selectedChatJid = '';
        this.selectedChatTitle = '';
        this.selectedChatAvatarUrl = '';
        this.messageRows = [];
      } else if (this.selectedChatJid) {
        const selected = this.chatRows.find(c => c.remoteJid === this.selectedChatJid);
        if (selected) {
          this.selectedChatTitle = selected.title;
          this.selectedChatAvatarUrl = selected.avatarUrl || '';
        }
      }
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
      this.chatRows = [];
    } finally {
      this.loadingChats = false;
    }
  }

  selectChat(row: WhatsappChatRow): void {
    this.stopActiveAudio();
    this.loadingThreadGeneration += 1;
    const threadGen = this.loadingThreadGeneration;
    this.selectedChatJid = row.remoteJid;
    this.selectedChatTitle = row.title;
    this.selectedChatAvatarUrl = row.avatarUrl || '';
    this.messageRows = [];
    this.loadingMessages = true;
    this.audioDecodeStateById = {};
    this.audioDurationById = {};
    this.audioCurrentTimeById = {};
    this.currentMessagesPage = 1;
    this.totalMessagesPages = 1;
    this.composerText = '';
    this.failedMediaIds.clear();
    this.mediaCache.clearFailedIds();
    this.startLiveSync();
    void this.loadMessagesForSelectedChat(1, false, threadGen);
  }

  async loadMessagesForSelectedChat(page = 1, appendOlder = false, threadGen?: number): Promise<void> {
    const instanceName = this.chatsInstanceName.trim();
    const remoteJid = this.selectedChatJid;
    if (!instanceName || !remoteJid) {
      if (!appendOlder) {
        this.loadingMessages = false;
      }
      return;
    }

    const capturedJid = remoteJid;
    const capturedThreadGen = appendOlder ? -1 : threadGen ?? this.loadingThreadGeneration;

    if (appendOlder) {
      this.loadingOlderMessages = true;
    } else {
      this.loadingMessages = true;
    }
    this.errorMessage = '';

    try {
      if (!appendOlder) {
        this.stopActiveAudio();
      }
      if (!appendOlder && page === 1) {
        this.failedMediaIds.clear();
      }
      const box = this.threadMessagesRef?.nativeElement;
      const previousScrollHeight = appendOlder && box ? box.scrollHeight : 0;
      const previousScrollTop = appendOlder && box ? box.scrollTop : 0;

      const raw = await this.whatsappService.listEvolutionMessages(instanceName, capturedJid, 70, page);
      if (!appendOlder) {
        if (this.selectedChatJid !== capturedJid || this.loadingThreadGeneration !== capturedThreadGen) {
          return;
        }
      }
      const incomingRows = this.normalizeEvolutionMessagesPayload(raw);
      const meta = this.extractMessagesPageMeta(raw);
      this.currentMessagesPage = meta.currentPage;
      this.totalMessagesPages = meta.totalPages;

      if (appendOlder) {
        const merged = [...incomingRows, ...this.messageRows];
        this.messageRows = this.dedupeAndSortMessages(merged);
      } else {
        this.messageRows = incomingRows;
        this.startLiveSync();
      }

      const targetRows = appendOlder ? incomingRows : this.messageRows.slice(-25);
      void this.prefetchRenderableMedia(targetRows);

      this.syncThreadScroll(appendOlder, previousScrollHeight, previousScrollTop);
    } catch (error) {
      if (!appendOlder && this.selectedChatJid === capturedJid && this.loadingThreadGeneration === capturedThreadGen) {
        this.errorMessage = getErrorMessage(error);
        this.messageRows = [];
      } else if (appendOlder) {
        this.errorMessage = getErrorMessage(error);
      }
    } finally {
      if (appendOlder) {
        this.loadingOlderMessages = false;
      } else if (this.selectedChatJid === capturedJid && this.loadingThreadGeneration === capturedThreadGen) {
        this.loadingMessages = false;
      }
    }
  }

  async loadOlderMessages(): Promise<void> {
    if (this.loadingOlderMessages || this.loadingMessages) return;
    if (!this.selectedChatJid) return;
    if (this.currentMessagesPage >= this.totalMessagesPages) return;
    const nextPage = this.currentMessagesPage + 1;
    await this.loadMessagesForSelectedChat(nextPage, true);
  }

  onThreadScroll(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.scrollTop <= 80) {
      void this.loadOlderMessages();
    }
  }

  async sendComposerMessage(): Promise<void> {
    const instanceName = this.chatsInstanceName.trim();
    const text = this.composerText.trim();
    if (!instanceName || !this.selectedChatJid || !text) return;

    if (this.selectedChatJid.includes('@g.us')) {
      this.errorMessage = 'Envio para grupos ainda não está habilitado nesta tela.';
      return;
    }

    const phoneNumber = this.selectedChatJid.split('@')[0].replace(/\D/g, '');
    if (!phoneNumber) {
      this.errorMessage = 'Não foi possível identificar o número deste chat.';
      return;
    }

    this.isComposerSending = true;
    this.errorMessage = '';
    try {
      await this.whatsappService.sendTestMessage({ instanceName, phoneNumber, message: text });
      this.composerText = '';
      await this.loadMessagesForSelectedChat(1, false);
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.isComposerSending = false;
    }
  }

  onComposerFeature(feature: 'audio' | 'image' | 'attach'): void {
    if (!this.canSendToCurrentChat()) return;

    if (feature === 'image') {
      this.composerImageInputRef?.nativeElement.click();
      return;
    }
    if (feature === 'attach') {
      this.composerFileInputRef?.nativeElement.click();
      return;
    }
    this.composerAudioInputRef?.nativeElement.click();
  }

  async onComposerImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    await this.sendSelectedMediaFile(file, 'image');
    if (input) input.value = '';
  }

  async onComposerFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    await this.sendSelectedMediaFile(file, 'document');
    if (input) input.value = '';
  }

  async onComposerAudioSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    await this.sendSelectedMediaFile(file, 'audio');
    if (input) input.value = '';
  }

  onComposerEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.shiftKey) return;
    keyboardEvent.preventDefault();
    void this.sendComposerMessage();
  }

  async onLockInstanceClick(): Promise<void> {
    const instanceName = this.chatsInstanceName.trim();
    if (!instanceName) {
      this.errorMessage = 'Selecione uma instância para trancar as conversas.';
      return;
    }
    await this.requestAccessCode(instanceName, 'lock');
  }

  async submitLockCode(): Promise<void> {
    const instanceName = this.chatsInstanceName.trim();
    const code = this.lockCodeInput.trim();
    if (!instanceName || !code) {
      this.lockModalMessage = 'Informe o código recebido no WhatsApp da instância.';
      return;
    }

    this.lockActionLoading = true;
    this.lockModalMessage = '';
    try {
      const result = await this.whatsappService.confirmInstanceAccessCode(instanceName, code, this.lockModalIntent);
      this.lockStatusByInstance[instanceName] = result.locked === true;
      this.lockModalOpen = false;
      this.lockCodeInput = '';
      if (this.lockModalIntent === 'lock') {
        // sem mensagem de sucesso global aqui, apenas fecha
      } else {
        await this.loadChats();
      }
    } catch (error) {
      this.lockModalMessage = getErrorMessage(error);
    } finally {
      this.lockActionLoading = false;
    }
  }

  closeLockModal(): void {
    if (this.lockActionLoading) return;
    this.lockModalOpen = false;
    this.lockCodeInput = '';
    this.lockModalMessage = '';
  }

  getAudioDecodeState(messageId: string): 'loading' | 'ready' | 'error' {
    return this.audioDecodeStateById[messageId] || 'loading';
  }

  onAudioLoadStart(messageId: string): void {
    this.audioDecodeStateById[messageId] = 'loading';
  }

  onAudioCanPlayThrough(messageId: string, el: HTMLAudioElement): void {
    this.audioDecodeStateById[messageId] = 'ready';
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    if (duration > 0) {
      this.audioDurationById[messageId] = Math.max(0, duration);
    }
  }

  /** Alguns navegadores disparam `canplay` com buffer suficiente sem `canplaythrough`. */
  onAudioCanPlay(messageId: string, el: HTMLAudioElement): void {
    if (el.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      this.onAudioCanPlayThrough(messageId, el);
    }
  }

  onAudioError(messageId: string): void {
    this.audioDecodeStateById[messageId] = 'error';
  }

  async toggleAudioPlayback(messageId: string, el: HTMLAudioElement): Promise<void> {
    if (this.getAudioDecodeState(messageId) !== 'ready') return;
    if (el.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;

    if (this.activeAudioEl && this.activeAudioEl !== el) {
      this.activeAudioEl.pause();
    }

    if (el.paused) {
      try {
        await el.play();
        this.activeAudioEl = el;
        this.audioPlayingId = messageId;
      } catch {
        this.errorMessage = 'Não foi possível reproduzir este áudio no momento.';
      }
      return;
    }

    el.pause();
    if (this.audioPlayingId === messageId) {
      this.audioPlayingId = '';
    }
  }

  onAudioLoadedMetadata(messageId: string, el: HTMLAudioElement): void {
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    this.audioDurationById[messageId] = Math.max(0, duration);
  }

  onAudioTimeUpdate(messageId: string, el: HTMLAudioElement): void {
    const current = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    this.audioCurrentTimeById[messageId] = Math.max(0, current);
    if (!el.paused) {
      this.audioPlayingId = messageId;
      this.activeAudioEl = el;
    }
  }

  onAudioEnded(messageId: string): void {
    this.audioPlayingId = '';
    const duration = this.audioDurationById[messageId] || 0;
    this.audioCurrentTimeById[messageId] = duration;
    if (this.activeAudioEl && this.audioPlayingId !== messageId) {
      this.activeAudioEl = null;
    }
  }

  onAudioSeek(messageId: string, el: HTMLAudioElement, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) return;
    const duration = this.audioDurationById[messageId] || 0;
    if (duration <= 0) return;
    const percent = Number(input.value);
    const nextTime = Math.min(duration, Math.max(0, (percent / 100) * duration));
    el.currentTime = nextTime;
    this.audioCurrentTimeById[messageId] = nextTime;
  }

  isAudioPlaying(messageId: string): boolean {
    return this.audioPlayingId === messageId;
  }

  getAudioProgressPercent(messageId: string): number {
    const duration = this.audioDurationById[messageId] || 0;
    const current = this.audioCurrentTimeById[messageId] || 0;
    if (duration <= 0) return 0;
    return Math.min(100, Math.max(0, (current / duration) * 100));
  }

  getAudioCurrentLabel(messageId: string): string {
    return this.formatAudioTime(this.audioCurrentTimeById[messageId] || 0);
  }

  getAudioDurationLabel(messageId: string): string {
    return this.formatAudioTime(this.audioDurationById[messageId] || 0);
  }

  getImageLoadState(messageId: string): 'loading' | 'loaded' | 'error' {
    return this.imageLoadStateById[messageId] || 'loading';
  }

  onImageLoaded(messageId: string): void {
    this.imageLoadStateById[messageId] = 'loaded';
    this.clearImageAutoRetry(messageId);
  }

  onImageError(messageId: string): void {
    const nextAttempt = (this.imageAutoRetryAttemptById.get(messageId) || 0) + 1;
    this.imageAutoRetryAttemptById.set(messageId, nextAttempt);
    if (nextAttempt > this.maxImageAutoRetries) {
      this.imageLoadStateById[messageId] = 'error';
      return;
    }
    this.imageLoadStateById[messageId] = 'loading';
    const prev = this.imageAutoRetryTimers.get(messageId);
    if (prev) clearTimeout(prev);
    const delayMs = Math.min(25_000, Math.round(450 * Math.pow(1.85, nextAttempt - 1)));
    const timer = setTimeout(() => {
      this.imageAutoRetryTimers.delete(messageId);
      if (this.componentDestroyed) return;
      const row = this.findMediaRowById(messageId);
      if (!row?.mediaUrl) {
        this.imageLoadStateById[messageId] = 'error';
        return;
      }
      void this.retryImageLoad(row, false);
    }, delayMs);
    this.imageAutoRetryTimers.set(messageId, timer);
  }

  private clearImageAutoRetry(messageId: string): void {
    const t = this.imageAutoRetryTimers.get(messageId);
    if (t) clearTimeout(t);
    this.imageAutoRetryTimers.delete(messageId);
    this.imageAutoRetryAttemptById.delete(messageId);
  }

  private findMediaRowById(messageId: string): WhatsappMessageRow | undefined {
    return (
      this.messageRows.find(r => r.id === messageId) ??
      this.galleryRows.find(r => r.id === messageId)
    );
  }

  async retryImageLoad(row: WhatsappMessageRow, manual = true): Promise<void> {
    if (!row.mediaUrl) return;
    if (manual) {
      this.clearImageAutoRetry(row.id);
    }
    this.imageLoadStateById[row.id] = 'loading';

    const instanceName = this.chatsInstanceName.trim();
    if (instanceName && row.rawMessage && this.needsMediaResolve(row)) {
      try {
        const useCache = environment.mediaCacheEnabled !== false;
        if (useCache) {
          const resolved = await this.mediaCache.getOrResolveMedia(instanceName, row.rawMessage);
          if (resolved?.url) {
            row.mediaUrl = resolved.url;
            if (resolved.mimetype) row.mediaMimeType = resolved.mimetype;
            this.failedMediaIds.delete(row.id);
            return;
          }
        } else {
          const resolved = await this.whatsappService.resolveEvolutionMedia(instanceName, row.rawMessage);
          const url = resolved?.url || resolved?.dataUrl;
          if (url) {
            row.mediaUrl = url;
            if (resolved?.mimetype) row.mediaMimeType = resolved.mimetype;
            this.failedMediaIds.delete(row.id);
            return;
          }
        }
      } catch {
        // continua no fallback abaixo
      }
    }

    if (row.mediaUrl.startsWith('data:')) {
      row.mediaUrl = `${row.mediaUrl}`;
      return;
    }

    // Fallback para URLs já renderizáveis, forçando novo fetch.
    const separator = row.mediaUrl.includes('?') ? '&' : '?';
    row.mediaUrl = `${row.mediaUrl}${separator}retry=${Date.now()}`;
  }

  onVideoLoaded(messageId: string): void {
    this.videoLoadStateById[messageId] = 'loaded';
  }

  onVideoError(messageId: string): void {
    this.videoLoadStateById[messageId] = 'error';
  }

  async openGallery(): Promise<void> {
    this.galleryOpen = true;
    this.galleryRows = this.collectMediaRows(this.messageRows);
    this.galleryPageCursor = this.currentMessagesPage;
    this.galleryHasMore = this.galleryPageCursor < this.totalMessagesPages;
    if (this.galleryHasMore) {
      await this.loadOlderGalleryMedia();
    }
  }

  closeGallery(): void {
    this.galleryOpen = false;
  }

  async loadOlderGalleryMedia(): Promise<void> {
    if (!this.galleryOpen) return;
    if (this.galleryLoadingOlder) return;
    if (!this.galleryHasMore) return;
    if (!this.selectedChatJid || !this.chatsInstanceName.trim()) return;

    this.galleryLoadingOlder = true;
    try {
      let nextPage = this.galleryPageCursor + 1;
      if (nextPage > this.totalMessagesPages) {
        this.galleryHasMore = false;
        return;
      }

      const maxPagesPerBatch = 3;
      let loadedPages = 0;
      while (nextPage <= this.totalMessagesPages && loadedPages < maxPagesPerBatch) {
        const raw = await this.whatsappService.listEvolutionMessages(
          this.chatsInstanceName.trim(),
          this.selectedChatJid,
          70,
          nextPage
        );
        const incomingRows = this.normalizeEvolutionMessagesPayload(raw);
        const mediaRows = this.collectMediaRows(incomingRows);
        this.galleryRows = this.mergeGalleryRows(this.galleryRows, mediaRows);
        void this.prefetchRenderableMedia(mediaRows);
        nextPage++;
        loadedPages++;
      }

      this.galleryPageCursor = Math.min(nextPage - 1, this.totalMessagesPages);
      this.galleryHasMore = this.galleryPageCursor < this.totalMessagesPages;
    } finally {
      this.galleryLoadingOlder = false;
    }
  }

  openImageViewer(url: string, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!url) return;
    this.imageViewerUrl = url;
  }

  onGalleryOpenImage(payload: { url: string; event?: Event }): void {
    this.openImageViewer(payload.url, payload.event);
  }

  closeImageViewer(): void {
    this.imageViewerUrl = '';
  }

  @HostListener('document:keydown.escape')
  onEscapeCloseViewer(): void {
    if (this.imageViewerUrl) {
      this.imageViewerUrl = '';
      return;
    }
    if (this.galleryOpen) {
      this.galleryOpen = false;
    }
  }

  private autoSelectConnectedInstance(): void {
    if (!this.chatsInstanceName) {
      const connected = this.instances.find(instance => isInstanceConnected(instance.status));
      if (connected) {
        this.chatsInstanceName = connected.name;
        if (this.active) {
          this.onChatsInstanceChange();
        }
      }
    }
  }

  private canSendToCurrentChat(): boolean {
    if (!this.chatsInstanceName.trim() || !this.selectedChatJid) {
      this.errorMessage = 'Selecione uma conversa para enviar mídia.';
      return false;
    }
    if (this.selectedChatJid.includes('@g.us')) {
      this.errorMessage = 'Envio para grupos ainda não está habilitado nesta tela.';
      return false;
    }
    return true;
  }

  private getCurrentChatPhoneNumber(): string {
    return this.selectedChatJid.split('@')[0].replace(/\D/g, '');
  }

  private async sendSelectedMediaFile(
    file: File,
    mediaType: 'image' | 'audio' | 'document'
  ): Promise<void> {
    if (!this.canSendToCurrentChat()) return;

    const instanceName = this.chatsInstanceName.trim();
    const phoneNumber = this.getCurrentChatPhoneNumber();
    if (!phoneNumber) {
      this.errorMessage = 'Não foi possível identificar o número deste chat.';
      return;
    }

    this.isComposerSending = true;
    this.errorMessage = '';
    try {
      const base64 = await this.readFileAsBase64(file);
      await this.whatsappService.sendMediaMessage({
        instanceName,
        phoneNumber,
        mediaBase64: base64,
        mimetype: file.type || 'application/octet-stream',
        fileName: file.name || `arquivo-${Date.now()}`,
        caption: mediaType === 'image' ? this.composerText.trim() : '',
        mediaType
      });
      this.composerText = '';
      await this.loadMessagesForSelectedChat(1, false);
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.isComposerSending = false;
    }
  }

  private startLiveSync(): void {
    if (!this.shouldRunLiveSync()) {
      this.stopLiveSync();
      return;
    }
    if (this.liveSyncTimer) return;

    this.liveSyncTimer = setInterval(() => {
      void this.refreshMessagesLive();
    }, 4500);
  }

  private stopLiveSync(): void {
    if (this.liveSyncTimer) {
      clearInterval(this.liveSyncTimer);
      this.liveSyncTimer = null;
    }
    this.liveSyncInFlight = false;
  }

  private shouldRunLiveSync(): boolean {
    return this.active && !!this.chatsInstanceName.trim() && !!this.selectedChatJid;
  }

  private async enforceLockBeforeOpeningChats(instanceName: string): Promise<void> {
    this.checkingChatLock = true;
    this.errorMessage = '';
    try {
      const status = await this.whatsappService.getInstanceLockStatus(instanceName);
      this.lockStatusByInstance[instanceName] = status.locked === true;
      if (status.locked) {
        this.messageRows = [];
        this.chatRows = [];
        this.selectedChatJid = '';
        this.selectedChatTitle = '';
        this.selectedChatAvatarUrl = '';
        await this.requestAccessCode(instanceName, 'unlock');
        return;
      }
      await this.loadChats();
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.checkingChatLock = false;
    }
  }

  private async requestAccessCode(instanceName: string, intent: 'lock' | 'unlock'): Promise<void> {
    this.lockActionLoading = true;
    this.lockModalMessage = '';
    try {
      const response = await this.whatsappService.requestInstanceAccessCode(instanceName, intent);
      this.lockModalIntent = intent;
      this.lockMaskedNumber = response.maskedNumber;
      this.lockCodeInput = '';
      this.lockModalOpen = true;
      this.lockModalMessage = '';
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.lockActionLoading = false;
    }
  }

  private async refreshMessagesLive(): Promise<void> {
    if (!this.shouldRunLiveSync()) return;
    if (this.liveSyncInFlight) return;
    if (this.loadingMessages || this.loadingOlderMessages || this.isComposerSending) return;

    this.liveSyncInFlight = true;
    try {
      const raw = await this.whatsappService.listEvolutionMessages(
        this.chatsInstanceName.trim(),
        this.selectedChatJid,
        70,
        1
      );
      const incomingRows = this.normalizeEvolutionMessagesPayload(raw);
      if (!incomingRows.length) return;

      const existingIds = new Set(this.messageRows.map(row => row.id));
      const newRows = incomingRows.filter(row => !existingIds.has(row.id));
      if (!newRows.length) return;

      const box = this.threadMessagesRef?.nativeElement;
      const shouldStickToBottom = box
        ? (box.scrollHeight - box.scrollTop - box.clientHeight) <= 120
        : true;

      this.messageRows = this.dedupeAndSortMessages([...this.messageRows, ...incomingRows]);
      void this.prefetchRenderableMedia(newRows.slice(-25));

      if (shouldStickToBottom) {
        setTimeout(() => {
          const target = this.threadMessagesRef?.nativeElement;
          if (!target) return;
          target.scrollTop = target.scrollHeight;
        }, 0);
      }
    } catch {
      // modo ao vivo silencioso
    } finally {
      this.liveSyncInFlight = false;
    }
  }

  private collectMediaRows(rows: WhatsappMessageRow[]): WhatsappMessageRow[] {
    return rows
      .filter(
        row =>
          (row.mediaType === 'image' ||
            row.mediaType === 'video' ||
            row.mediaType === 'sticker') &&
          !!row.mediaUrl
      )
      .sort((a, b) => b.sortKey - a.sortKey);
  }

  private mergeGalleryRows(existing: WhatsappMessageRow[], incoming: WhatsappMessageRow[]): WhatsappMessageRow[] {
    const map = new Map<string, WhatsappMessageRow>();
    for (const row of existing) map.set(row.id, row);
    for (const row of incoming) map.set(row.id, row);
    return Array.from(map.values()).sort((a, b) => b.sortKey - a.sortKey);
  }

  private stopActiveAudio(): void {
    if (this.activeAudioEl) {
      this.activeAudioEl.pause();
    }
    this.activeAudioEl = null;
    this.audioPlayingId = '';
  }

  private formatAudioTime(totalSeconds: number): string {
    const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
    const min = Math.floor(safe / 60);
    const sec = safe % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  private readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.replace(/^data:[^;]+;base64,/, '');
        if (!base64) {
          reject(new Error('Não foi possível ler o arquivo selecionado.'));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Falha ao processar arquivo.'));
      reader.readAsDataURL(file);
    });
  }

  private syncThreadScroll(appendOlder: boolean, previousHeight: number, previousTop: number): void {
    setTimeout(() => {
      const box = this.threadMessagesRef?.nativeElement;
      if (!box) return;
      if (appendOlder) {
        const delta = box.scrollHeight - previousHeight;
        box.scrollTop = previousTop + delta;
        return;
      }
      box.scrollTop = box.scrollHeight;
    }, 0);
  }

  private needsMediaResolve(row: WhatsappMessageRow): boolean {
    if (!row.mediaType) return false;
    const url = (row.mediaUrl || '').toLowerCase().trim();
    if (!url) return true;
    if (url.startsWith('data:')) return false;
    if (url.includes('.enc')) return true;
    return (
      url.includes('mmg.whatsapp.net') ||
      url.includes('pps.whatsapp.net') ||
      url.includes('whatsapp.net')
    );
  }

  private async prefetchRenderableMedia(rows: WhatsappMessageRow[]): Promise<void> {
    const instanceName = this.chatsInstanceName.trim();
    if (!instanceName) return;

    const useCache = environment.mediaCacheEnabled !== false;

    for (const row of rows) {
      if (!this.needsMediaResolve(row) || !row.rawMessage) continue;
      if (this.resolvingMediaIds.has(row.id)) continue;
      if (this.failedMediaIds.has(row.id)) continue;
      this.resolvingMediaIds.add(row.id);
      try {
        if (useCache) {
          const resolved = await this.mediaCache.getOrResolveMedia(instanceName, row.rawMessage);
          if (resolved?.url) {
            row.mediaUrl = resolved.url;
            if (resolved.mimetype) row.mediaMimeType = resolved.mimetype;
            if (row.mediaType === 'image' || row.mediaType === 'sticker') {
              this.imageLoadStateById[row.id] = 'loading';
            }
            if (row.mediaType === 'video') this.videoLoadStateById[row.id] = 'loading';
            if (row.mediaType === 'audio') this.audioDecodeStateById[row.id] = 'loading';
            this.failedMediaIds.delete(row.id);
          } else {
            this.failedMediaIds.add(row.id);
          }
        } else {
          const resolved = await this.whatsappService.resolveEvolutionMedia(instanceName, row.rawMessage);
          const url = resolved?.url || resolved?.dataUrl;
          if (url) {
            row.mediaUrl = url;
            if (resolved?.mimetype) row.mediaMimeType = resolved.mimetype;
            if (row.mediaType === 'image' || row.mediaType === 'sticker') {
              this.imageLoadStateById[row.id] = 'loading';
            }
            if (row.mediaType === 'video') this.videoLoadStateById[row.id] = 'loading';
            if (row.mediaType === 'audio') this.audioDecodeStateById[row.id] = 'loading';
            this.failedMediaIds.delete(row.id);
          } else {
            this.failedMediaIds.add(row.id);
          }
        }
      } catch {
        this.failedMediaIds.add(row.id);
      } finally {
        this.resolvingMediaIds.delete(row.id);
      }
    }
  }

  private normalizeEvolutionChatsPayload(raw: unknown): WhatsappChatRow[] {
    const list = this.extractChatsArray(raw);
    const rows: WhatsappChatRow[] = [];

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const remoteJid = this.extractRemoteJid(rec);
      if (!remoteJid) continue;

      const title = this.extractChatDisplayTitle(rec, remoteJid);
      const preview = this.extractChatPreview(rec);
      const avatarUrl = this.extractChatAvatarUrl(rec);

      rows.push({
        remoteJid,
        title,
        preview: preview || 'Toque para abrir a conversa',
        initial: this.messageInitialFromJid(remoteJid, title),
        avatarUrl
      });
    }

    return rows;
  }

  private normalizeEvolutionMessagesPayload(raw: unknown): WhatsappMessageRow[] {
    const list = this.extractMessagesArray(raw);
    const rows: WhatsappMessageRow[] = [];

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const key = rec['key'] && typeof rec['key'] === 'object' ? (rec['key'] as Record<string, unknown>) : {};
      const fromMe = key['fromMe'] === true;
      const id = this.pickString(key, ['id']) || `msg-${i}`;

      const messageBlock = rec['message'] ?? rec;
      const parsed = this.extractMessageContentFromPayload(messageBlock);
      const text = parsed.text.trim();
      const hasMedia = Boolean(parsed.mediaType && parsed.mediaUrl);
      if (!text && !hasMedia) continue;

      const tsNum = this.coerceTimestamp(rec['messageTimestamp'] ?? rec['msgTimestamp']);
      const sortKey = tsNum > 0 ? tsNum : i;
      const timeLabel = tsNum > 0 ? this.shortTime(tsNum) : '';

      rows.push({
        id,
        fromMe,
        text,
        timeLabel,
        sortKey,
        mediaType: parsed.mediaType,
        mediaUrl: parsed.mediaUrl,
        mediaMimeType: parsed.mediaMimeType,
        caption: parsed.caption,
        rawMessage: rec
      });
    }

    rows.sort((a, b) => a.sortKey - b.sortKey);
    return rows;
  }

  private extractMessagesPageMeta(raw: unknown): WhatsappMessagePageMeta {
    const fallback: WhatsappMessagePageMeta = { currentPage: 1, totalPages: 1 };
    const r = raw as Record<string, unknown>;
    if (!r || typeof r !== 'object') return fallback;

    const messageObj = r['messages'];
    if (messageObj && typeof messageObj === 'object') {
      const meta = messageObj as Record<string, unknown>;
      const currentPage = this.toPositiveInt(meta['currentPage']) || 1;
      const totalPages = this.toPositiveInt(meta['pages']) || this.toPositiveInt(meta['totalPages']) || 1;
      return { currentPage, totalPages };
    }

    const currentPage = this.toPositiveInt(r['currentPage']) || 1;
    const totalPages = this.toPositiveInt(r['pages']) || this.toPositiveInt(r['totalPages']) || 1;
    return { currentPage, totalPages };
  }

  private dedupeAndSortMessages(rows: WhatsappMessageRow[]): WhatsappMessageRow[] {
    const map = new Map<string, WhatsappMessageRow>();
    for (const row of rows) map.set(row.id, row);
    return Array.from(map.values()).sort((a, b) => a.sortKey - b.sortKey);
  }

  private toPositiveInt(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    }
    return 0;
  }

  private extractChatsArray(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    const r = raw as Record<string, unknown>;
    if (r && Array.isArray(r['chats'])) return r['chats'] as unknown[];
    if (r && Array.isArray(r['data'])) return r['data'] as unknown[];
    if (r && Array.isArray(r['records'])) return r['records'] as unknown[];
    if (r && r['response'] && typeof r['response'] === 'object') {
      const response = r['response'] as Record<string, unknown>;
      if (Array.isArray(response['chats'])) return response['chats'] as unknown[];
      if (Array.isArray(response['data'])) return response['data'] as unknown[];
      if (Array.isArray(response['records'])) return response['records'] as unknown[];
    }
    if (r && r['data'] && typeof r['data'] === 'object') {
      const data = r['data'] as Record<string, unknown>;
      if (Array.isArray(data['chats'])) return data['chats'] as unknown[];
      if (Array.isArray(data['records'])) return data['records'] as unknown[];
    }
    if (r && (r['remoteJid'] || r['id'] || r['jid'] || r['key'])) return [r];
    return [];
  }

  private extractMessagesArray(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    const r = raw as Record<string, unknown>;
    if (r && Array.isArray(r['messages'])) return r['messages'] as unknown[];
    if (r && r['messages'] && typeof r['messages'] === 'object') {
      const messagesObj = r['messages'] as Record<string, unknown>;
      if (Array.isArray(messagesObj['records'])) return messagesObj['records'] as unknown[];
      if (Array.isArray(messagesObj['data'])) return messagesObj['data'] as unknown[];
      if (Array.isArray(messagesObj['messages'])) return messagesObj['messages'] as unknown[];
    }
    if (r && Array.isArray(r['data'])) return r['data'] as unknown[];
    if (r && Array.isArray(r['records'])) return r['records'] as unknown[];
    if (r && r['data'] && typeof r['data'] === 'object') {
      const data = r['data'] as Record<string, unknown>;
      if (Array.isArray(data['messages'])) return data['messages'] as unknown[];
      if (Array.isArray(data['records'])) return data['records'] as unknown[];
    }
    if (r && r['response'] && Array.isArray((r['response'] as { messages?: unknown[] }).messages)) {
      return (r['response'] as { messages: unknown[] }).messages;
    }
    if (r && r['response'] && typeof r['response'] === 'object') {
      const response = r['response'] as Record<string, unknown>;
      if (Array.isArray(response['data'])) return response['data'] as unknown[];
      if (Array.isArray(response['records'])) return response['records'] as unknown[];
    }
    if (r && r['key'] && r['message']) return [r];
    return [];
  }

  private extractChatPreview(rec: Record<string, unknown>): string {
    const last = rec['lastMessage'] ?? rec['message'];
    if (last && typeof last === 'object') {
      const lm = last as Record<string, unknown>;
      const inner = lm['message'] ?? lm;
      return this.extractMessageTextFromPayload(inner).slice(0, 120);
    }
    return '';
  }

  private extractMessageTextFromPayload(message: unknown): string {
    return this.extractMessageContentFromPayload(message).text;
  }

  private extractMessageContentFromPayload(message: unknown): {
    text: string;
    mediaType?: 'image' | 'video' | 'audio' | 'sticker';
    mediaUrl?: string;
    mediaMimeType?: string;
    caption?: string;
  } {
    if (!message || typeof message !== 'object') return { text: '' };
    const original = message as Record<string, unknown>;

    const topLevelText = this.pickString(original, ['text', 'body', 'message', 'content']);
    if (topLevelText) return { text: topLevelText };

    let m: Record<string, unknown> = original;

    const wrapperKeys = [
      'ephemeralMessage',
      'viewOnceMessage',
      'viewOnceMessageV2',
      'viewOnceMessageV2Extension',
      'editedMessage',
      'documentWithCaptionMessage'
    ];

    let safety = 0;
    while (safety < 6) {
      safety++;
      let advanced = false;
      for (const key of wrapperKeys) {
        const wrapper = m[key];
        if (wrapper && typeof wrapper === 'object') {
          const nested = (wrapper as Record<string, unknown>)['message'];
          if (nested && typeof nested === 'object') {
            m = nested as Record<string, unknown>;
            advanced = true;
            break;
          }
        }
      }
      if (!advanced) break;
    }

    if (typeof m['conversation'] === 'string') return { text: m['conversation'] as string };

    const extended = m['extendedTextMessage'];
    if (extended && typeof extended === 'object') {
      const t = this.pickString(extended as Record<string, unknown>, ['text', 'caption']);
      if (t) return { text: t };
    }

    const imageMessage = m['imageMessage'];
    if (imageMessage && typeof imageMessage === 'object') {
      const image = imageMessage as Record<string, unknown>;
      const caption = this.pickString(image, ['caption']);
      const mediaUrl = this.pickString(image, ['url']);
      return {
        text: caption || '[Imagem]',
        mediaType: 'image',
        mediaUrl: mediaUrl || undefined,
        mediaMimeType: this.pickString(image, ['mimetype', 'mimeType']) || undefined,
        caption: caption || undefined
      };
    }

    const videoMessage = m['videoMessage'];
    if (videoMessage && typeof videoMessage === 'object') {
      const video = videoMessage as Record<string, unknown>;
      const caption = this.pickString(video, ['caption']);
      const mediaUrl = this.pickString(video, ['url']);
      return {
        text: caption || '[Vídeo]',
        mediaType: 'video',
        mediaUrl: mediaUrl || undefined,
        mediaMimeType: this.pickString(video, ['mimetype', 'mimeType']) || undefined,
        caption: caption || undefined
      };
    }

    const documentMessage = m['documentMessage'];
    if (documentMessage && typeof documentMessage === 'object') {
      const caption = this.pickString(documentMessage as Record<string, unknown>, ['caption', 'fileName']);
      return { text: caption || '[Documento]' };
    }

    const buttonsResponse = m['buttonsResponseMessage'];
    if (buttonsResponse && typeof buttonsResponse === 'object') {
      const text = this.pickString(buttonsResponse as Record<string, unknown>, ['selectedDisplayText']);
      if (text) return { text };
    }

    const listResponse = m['listResponseMessage'];
    if (listResponse && typeof listResponse === 'object') {
      const text = this.pickString(listResponse as Record<string, unknown>, ['title', 'description']);
      if (text) return { text };
    }

    const templateReply = m['templateButtonReplyMessage'];
    if (templateReply && typeof templateReply === 'object') {
      const text = this.pickString(templateReply as Record<string, unknown>, ['selectedDisplayText']);
      if (text) return { text };
    }

    const audioMessage = m['audioMessage'];
    if (audioMessage && typeof audioMessage === 'object') {
      const audio = audioMessage as Record<string, unknown>;
      const mediaUrl = this.pickString(audio, ['url']);
      return {
        text: '',
        mediaType: 'audio',
        mediaUrl: mediaUrl || undefined,
        mediaMimeType: this.pickString(audio, ['mimetype', 'mimeType']) || undefined
      };
    }

    const pttMessage = m['pttMessage'];
    if (pttMessage && typeof pttMessage === 'object') {
      const ptt = pttMessage as Record<string, unknown>;
      const mediaUrl = this.pickString(ptt, ['url']);
      return {
        text: '',
        mediaType: 'audio',
        mediaUrl: mediaUrl || undefined,
        mediaMimeType: this.pickString(ptt, ['mimetype', 'mimeType']) || undefined
      };
    }
    const stickerMessage = m['stickerMessage'];
    if (stickerMessage && typeof stickerMessage === 'object') {
      const sticker = stickerMessage as Record<string, unknown>;
      const mediaUrl = this.pickString(sticker, ['url']);
      return {
        text: '[Figurinha]',
        mediaType: 'sticker',
        mediaUrl: mediaUrl || undefined,
        mediaMimeType: this.pickString(sticker, ['mimetype', 'mimeType']) || undefined
      };
    }
    if (m['contactMessage']) return { text: '[Contato]' };
    if (m['locationMessage']) return { text: '[Localização]' };
    if (m['pollCreationMessage'] || m['pollUpdateMessage']) return { text: '[Enquete]' };
    if (m['reactionMessage']) return { text: '[Reação]' };
    if (m['protocolMessage']) return { text: '[Mensagem de sistema]' };

    return { text: '[Mensagem sem pré-visualização]' };
  }

  private pickString(rec: Record<string, unknown>, keys: string[]): string {
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  private pickNestedString(rec: Record<string, unknown>, path: string[]): string {
    let cur: unknown = rec;
    for (const key of path) {
      if (!cur || typeof cur !== 'object') return '';
      cur = (cur as Record<string, unknown>)[key];
    }
    return typeof cur === 'string' && cur.trim() ? cur.trim() : '';
  }

  private fallbackTitleFromJid(jid: string): string {
    const base = jid.split('@')[0] || jid;
    return base.replace(/\D/g, '') || jid;
  }

  private extractRemoteJid(rec: Record<string, unknown>): string {
    // Alguns payloads trazem `id` como identificador interno e não como JID.
    // Por isso, preferimos campos explícitos de JID e só depois usamos fallback.
    const direct = this.pickString(rec, ['remoteJid', 'jid', 'chatId', 'conversationId']);
    const normalizedDirect = this.normalizeJidLike(direct);
    if (normalizedDirect) return normalizedDirect;

    const nestedCandidates = [
      this.pickNestedString(rec, ['key', 'remoteJid']),
      this.pickNestedString(rec, ['id', 'remoteJid']),
      this.pickNestedString(rec, ['id', '_serialized']),
      this.pickNestedString(rec, ['chat', 'id']),
      this.pickNestedString(rec, ['chat', 'jid']),
      this.pickNestedString(rec, ['contact', 'jid']),
      this.pickNestedString(rec, ['contact', 'id'])
    ].filter(Boolean);

    const normalizedNested = nestedCandidates
      .map(value => this.normalizeJidLike(value))
      .find(Boolean);
    if (normalizedNested) return normalizedNested;

    // Fallback final: usa id/key apenas se não houver alternativa.
    const looseFallback = this.pickString(rec, ['id', 'keyId']);
    const normalizedFallback = this.normalizeJidLike(looseFallback);
    if (normalizedFallback) return normalizedFallback;

    return this.normalizeJidLike(nestedCandidates[0]) || '';
  }

  private messageInitialFromJid(jid: string, title: string): string {
    const t = title.trim();
    if (t.length > 0) return t.charAt(0).toUpperCase();
    const digits = jid.replace(/\D/g, '');
    return digits.slice(-2) || '?';
  }

  private extractChatAvatarUrl(rec: Record<string, unknown>): string {
    const direct = this.pickString(rec, ['profilePicUrl', 'profilePictureUrl', 'avatarUrl', 'imageUrl']);
    if (direct) return direct;

    const nestedCandidates = [
      this.pickNestedString(rec, ['contact', 'profilePicUrl']),
      this.pickNestedString(rec, ['contact', 'profilePictureUrl']),
      this.pickNestedString(rec, ['contact', 'avatarUrl']),
      this.pickNestedString(rec, ['profilePic', 'url']),
      this.pickNestedString(rec, ['imgUrl'])
    ];

    return nestedCandidates.find(Boolean) || '';
  }

  private coerceTimestamp(value: unknown): number {
    if (typeof value === 'number' && value > 0) {
      return value < 1e12 ? value * 1000 : value;
    }
    return 0;
  }

  private shortTime(tsMs: number): string {
    try {
      const d = new Date(tsMs);
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  private extractChatDisplayTitle(rec: Record<string, unknown>, remoteJid: string): string {
    const direct = this.pickString(rec, [
      'pushName',
      'name',
      'subject',
      'contactName',
      'displayName',
      'conversationName',
      'notify'
    ]);
    if (direct) return direct;

    const nestedCandidates = [
      this.pickNestedString(rec, ['contact', 'name']),
      this.pickNestedString(rec, ['contact', 'pushName']),
      this.pickNestedString(rec, ['contact', 'notify']),
      this.pickNestedString(rec, ['contact', 'fullName']),
      this.pickNestedString(rec, ['contact', 'waName'])
    ].filter(Boolean);
    if (nestedCandidates.length > 0) return nestedCandidates[0];

    return this.fallbackTitleFromJid(remoteJid);
  }

  private normalizeJidLike(value: string): string {
    const raw = value.trim();
    if (!raw) return '';

    if (raw.includes('@')) {
      return raw.toLowerCase();
    }

    // IDs internos alfanuméricos longos (sem @) não devem virar telefone.
    if (!/^\d+$/.test(raw)) return '';

    if (raw.length < 8) return '';

    // Se vier só número, assumimos contato padrão do WhatsApp.
    return `${raw}@s.whatsapp.net`;
  }
}
