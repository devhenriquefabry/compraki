import { Component, OnInit, OnDestroy, Input, ViewChild, ElementRef, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton, IonFooter, IonInput, IonButton, IonIcon, IonAvatar, IonSpinner, IonImg, IonCard, IonText, IonThumbnail, IonLabel, IonItem, AlertController, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { send, mic, micOutline, imageOutline, trash, closeCircle, play, stop, checkmarkCircle, checkmarkDoneOutline, alertCircleOutline, flagOutline } from 'ionicons/icons';
import { Subscription, firstValueFrom } from 'rxjs';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { GrokAiService } from '../../services/grok-ai.service';
import { FirebaseProducts } from '../../services/firebase-products';
import { ChatRoom, ChatMessage, ChatParticipant } from '../../interfaces/chat';

@Component({
  selector: 'app-chat-box',
  templateUrl: './chat-box.component.html',
  styleUrls: ['./chat-box.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton, IonFooter, IonInput, IonButton, IonIcon, IonAvatar, IonSpinner, IonImg, IonCard, IonText, IonThumbnail, IonLabel, IonItem]
})
export class ChatBoxComponent implements OnInit, OnDestroy {
  @ViewChild(IonContent, { static: false }) content!: IonContent;
  
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
  @Output() onClose = new EventEmitter<void>();
  @Output() onChatClosed = new EventEmitter<string>(); // Emite chatId quando conversa é finalizada
  @Input() aiSimulationActive: boolean = false;

  chatRoom?: ChatRoom;
  messages: ChatMessage[] = [];
  outgoingMessages: ChatMessage[] = [];
  newMessage: string = '';
  isAiTyping: boolean = false;
  
  // Estado para o visualizador de imagem ampliada
  selectedImage: string | null = null;

  // Estado da finalização de conversa
  closingState: 'idle' | 'confirming' | 'loading' | 'success' = 'idle';
  isChatClosed: boolean = false;

  get allMessages(): ChatMessage[] {
    // Esconde a mensagem real do Firebase enquanto a versão "sending" (ajustada pelo delay de 1s)
    // ainda estiver presente na lista de outgoingMessages para evitar duplicidade visual.
    // Usamos o clientId como identificador único e infalível.
    const filteredReal = this.messages.filter(m => {
       const isOutgoing = this.outgoingMessages.some(out => 
          out.clientId && m.clientId && out.clientId === m.clientId
       );
       return !isOutgoing;
    });
    return [...filteredReal, ...this.outgoingMessages];
  }
  
  currentUserId?: string;
  otherParticipant?: ChatParticipant;
  
  isLoading = true;
  private sub!: Subscription;

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
    addIcons({ send, mic, micOutline, imageOutline, trash, closeCircle, play, stop, checkmarkCircle, checkmarkDoneOutline, alertCircleOutline, flagOutline });
    // Identifica o usuário imediatamente no construtor para que o setter de chatId possa usá-lo
    this.currentUserId = this.chatService.getCurrentUser()?.uid;
  }

  async ngOnInit() {
    // Se o chatId já veio via input, o setter já chamou o loadChat() com o currentUserId pronto.
    // Caso contrário (o que não deve ocorrer no nosso fluxo atual), chamamos aqui por segurança.
    if (this.chatId && !this.chatRoom) {
       this.loadChat();
    }
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
    if (this.recordInterval) clearInterval(this.recordInterval);
  }

  async loadChat() {
    if (!this.chatId) return;

    this.isLoading = true;
    this.messages = [];
    this.outgoingMessages = [];
    this.chatRoom = undefined;
    
    if (this.sub) {
      this.sub.unsubscribe();
    }

    // Espera o Firebase Auth confirmar o usuário caso o construtor tenha sido muito rápido
    if (!this.currentUserId) {
       const user = await this.chatService.waitForUser();
       if (user) {
          this.currentUserId = user.uid;
       } else {
          return; // Se realmente estiver deslogado, aborta
       }
    }

    this.chatRoom = await this.chatService.getChatDetails(this.chatId);
    if (this.chatRoom) {
       this.otherParticipant = this.chatRoom.participants.find(p => p.uid !== this.currentUserId);
       this.isChatClosed = this.chatRoom.status === 'closed';
    }
    this.closingState = 'idle';
    
    this.sub = this.chatService.getMessages(this.chatId).subscribe({
        next: (msgs) => {
            this.messages = msgs;
            this.isLoading = false;
            setTimeout(() => this.scrollToBottom(), 150);
        },
        error: (e) => {
            console.error("Error reading messages", e);
            this.isLoading = false;
        }
    });
  }

  async sendMessage() {
    if (!this.newMessage.trim()) return;
    const text = this.newMessage.trim();
    this.newMessage = '';
    
    const clientId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Optimistic UI
    const tempMsg: ChatMessage = {
      senderId: this.currentUserId!,
      text: text,
      type: 'text',
      createdAt: { seconds: Date.now() / 1000 },
      status: 'sending',
      clientId: clientId
    };
    this.outgoingMessages.push(tempMsg);
    this.scrollToBottom();

    try {
      await this.chatService.sendMessage(this.chatId, { text, type: 'text', clientId });
      setTimeout(() => {
        this.outgoingMessages = this.outgoingMessages.filter(m => m !== tempMsg);
        this.scrollToBottom();
      }, 1000);
      
      // Gatilho da IA (Grok) simulando resposta do vendedor se ativado
      if (this.aiSimulationActive && this.otherParticipant?.uid) {
         this.isAiTyping = true;
         this.scrollToBottom();
         
         // Busca detalhes do produto para dar contexto à IA
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
         
         // Injeta a mensagem enviada "pelo" Vendedor na base do Firebase
         await this.chatService.sendSystemMessage(this.chatId, this.otherParticipant.uid, response);
         this.isAiTyping = false;
         this.scrollToBottom();
      }

    } catch(e) {
      console.error("Failed", e);
      tempMsg.status = 'error';
      this.newMessage = text;
      this.isAiTyping = false;
    }
  }

  // --- IMAGE LOGIC ---
  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const clientId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const tempMsg: ChatMessage = {
      senderId: this.currentUserId!,
      text: 'Enviando imagem...',
      type: 'image',
      mediaUrl: '', // Placeholder
      createdAt: { seconds: Date.now() / 1000 },
      status: 'sending',
      clientId: clientId
    };
    this.outgoingMessages.push(tempMsg);
    this.scrollToBottom();

    try {
      const path = `chats/${this.chatId}/${Date.now()}_${file.name}`;
      const url = await this.chatService.uploadFile(file, path);
      await this.chatService.sendMessage(this.chatId, { text: '', type: 'image', mediaUrl: url, clientId });
      setTimeout(() => {
        this.outgoingMessages = this.outgoingMessages.filter(m => m !== tempMsg);
        this.scrollToBottom();
      }, 1000);
    } catch (e) {
      console.error("Upload error", e);
      tempMsg.status = 'error';
    }
  }

  // --- AUDIO LOGIC (Gesto Soltar/Lixeira) ---
  // Nota: Ionic hammerjs ou gestos simples de touch
  async startRecording(event: any) {
    event.preventDefault();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      
      this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
      this.mediaRecorder.onstop = () => this.handleAudioStop();

      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingDuration = 0;
      this.isDraggingToCancel = false;

      this.recordInterval = setInterval(() => this.recordingDuration++, 1000);
    } catch (e) {
      console.error("Mic access denied", e);
    }
  }

  handleTouchMove(event: TouchEvent) {
    if (!this.isRecording) return;
    const touch = event.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    
    // Se arrastar para a esquerda (onde colocaremos a lixeira visualmente)
    // Aqui fazemos uma lógica simplista de distância ou checagem de elemento
    if (touch.clientX < 100) { 
       this.isDraggingToCancel = true;
    } else {
       this.isDraggingToCancel = false;
    }
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

    const clientId = `aud_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const tempMsg: ChatMessage = {
       senderId: this.currentUserId!,
       text: 'Enviando áudio...',
       type: 'audio',
       mediaUrl: '', // Placeholder
       createdAt: { seconds: Date.now() / 1000 },
       status: 'sending',
       clientId: clientId
    };
    this.outgoingMessages.push(tempMsg);
    this.scrollToBottom();

    try {
       const path = `chats/${this.chatId}/${Date.now()}_audio.webm`;
       const url = await this.chatService.uploadFile(audioBlob, path);
       await this.chatService.sendMessage(this.chatId, { text: '', type: 'audio', mediaUrl: url, clientId });
       setTimeout(() => {
         this.outgoingMessages = this.outgoingMessages.filter(m => m !== tempMsg);
         this.scrollToBottom();
       }, 1000);
    } catch (e) {
       console.error("Audio upload error", e);
       tempMsg.status = 'error';
    }
  }

  scrollToBottom() {
    if (this.content) {
      this.content.scrollToBottom(300);
    }
  }

  /**
   * Rola o chat até uma mensagem específica pelo ID.
   * Útil para o Audit Hub e navegação no Heatmap.
   */
  public scrollToMessage(messageId: string) {
    if (!this.content || !messageId) return;
    
    const id = messageId.startsWith('msg-') ? messageId : `msg-${messageId}`;
    const el = document.getElementById(id);
    
    if (el) {
      // Usamos offsetTop para calcular o ponto exato da mensagem no scroll
      // Subtraímos um pouco para não colar no topo (ex: 100px para o header de produto)
      const y = el.offsetTop - 120; 
      this.content.scrollToPoint(0, y > 0 ? y : 0, 500);
      
      // Pequeno feedback visual na mensagem alvo
      el.classList.add('highlight-pulse');
      setTimeout(() => el.classList.remove('highlight-pulse'), 2000);
    }
  }

  // ====== Controle do Visualizador de Imagem ======
  
  openImage(url: string) {
    this.selectedImage = url;
  }

  closeImage() {
    this.selectedImage = null;
  }

  formatTime(timestamp: any): string {
    if(!timestamp || !timestamp.seconds) return '';
    const d = new Date(timestamp.seconds * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  trackByMessages(index: number, msg: ChatMessage) {
    // Usando clientId se disponível, senão fallback para id original do doc ou índice visual
    return msg.clientId || msg.id || index;
  }

  // ====== Finalização de Conversa ======

  promptCloseChat() {
    this.closingState = 'confirming';
  }

  cancelCloseChat() {
    this.closingState = 'idle';
  }

  async confirmCloseChat() {
    this.closingState = 'loading';
    try {
      await this.chatService.closeChat(this.chatId);
      this.closingState = 'success';
      this.isChatClosed = true;
      // Após 2s, emite evento para o sidebar mudar para a aba de finalizadas
      setTimeout(() => {
        this.onChatClosed.emit(this.chatId);
      }, 2000);
    } catch (e) {
      console.error('Erro ao finalizar conversa:', e);
      this.closingState = 'idle';
    }
  }

  goToProduct() {
     if (this.chatRoom?.productId) {
       this.router.navigate(['/product-details', this.chatRoom.productId]);
     }
   }

  async openReportModal() {
    if (!this.otherParticipant) return;

    const alert = await this.alertCtrl.create({
      header: 'Denunciar Usuário',
      message: `Por que você deseja denunciar ${this.otherParticipant.name}?`,
      inputs: [
        { name: 'reason', type: 'radio', label: 'Spam / Mensagens repetitivas', value: 'spam', checked: true },
        { name: 'reason', type: 'radio', label: 'Comportamento inadequado / Ofensivo', value: 'abuse' },
        { name: 'reason', type: 'radio', label: 'Tentativa de golpe / Fraude', value: 'scam' },
        { name: 'reason', type: 'radio', label: 'Outro motivo', value: 'other' }
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { 
          text: 'Próximo', 
          handler: (reason) => {
            if (reason === 'other') {
              this.showOtherDetailsInput(reason);
            } else {
              this.submitReport(reason);
            }
          }
        }
      ]
    });

    await alert.present();
  }

  private async showOtherDetailsInput(reason: string) {
    const alert = await this.alertCtrl.create({
      header: 'Detalhes da Denúncia',
      message: 'Explique brevemente o que aconteceu:',
      inputs: [
        { name: 'details', type: 'textarea', placeholder: 'Detalhes aqui...' }
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { 
          text: 'Enviar Denúncia', 
          handler: (data) => {
            this.submitReport(reason, data.details);
          }
        }
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

      const toast = await this.toastCtrl.create({
        message: 'Denúncia enviada com sucesso. O administrador irá analisar.',
        duration: 3000,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    } catch (e) {
      console.error("Erro ao enviar denúncia:", e);
    }
  }
}
// Forçando re-build limpo do Angular
