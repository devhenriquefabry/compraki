import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { 
  chevronBackOutline, 
  chatbubblesOutline, 
  settingsOutline, 
  sparkles, 
  closeOutline, 
  trashOutline, 
  checkboxOutline, 
  squareOutline, 
  personCircle,
  chatbubbles
} from 'ionicons/icons';
import { ChatRoom, ChatParticipant } from '../../interfaces/chat';
import { ChatBoxComponent } from '../chat-box/chat-box.component';
import { FirebaseChatService } from '../../services/firebase-chat.service';

@Component({
  selector: 'app-admin-chat-sidebar',
  templateUrl: './admin-chat-sidebar.component.html',
  styleUrls: ['./admin-chat-sidebar.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, ChatBoxComponent]
})
export class AdminChatSidebarComponent {

  @Input() activeChatId: string = '';
  @Input() activeChats: ChatRoom[] = [];
  @Input() activeSellerName: string = '';
  @Input() isChatOpen: boolean = false;
  @Input() isInboxOpen: boolean = false;

  @Output() chatSelected = new EventEmitter<string>();
  @Output() backToInbox = new EventEmitter<void>();
  @Output() chatClosed = new EventEmitter<void>();
  @Output() inboxDismissed = new EventEmitter<void>();

  activeTab: 'active' | 'closed' = 'active';
  isAiSimulationActive: boolean = false;

  // Gerenciamento de Seleção e Exclusão
  isSelectionMode: boolean = false;
  selectedChatIds: Set<string> = new Set();

  constructor(
    private chatService: FirebaseChatService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {
    // Persistência local do status do AI Simulation
    const savedState = localStorage.getItem('compraki_grok_simulation');
    if (savedState) {
    this.isAiSimulationActive = savedState === 'true';
    }

    // Registro de ícones mandatório para componentes standalone no Ionic 7/8
    addIcons({ 
      chevronBackOutline, 
      chatbubblesOutline, 
      settingsOutline, 
      sparkles, 
      closeOutline, 
      trashOutline, 
      checkboxOutline, 
      squareOutline, 
      personCircle,
      chatbubbles,
      'chevron-back-outline': chevronBackOutline,
      'chatbubbles-outline': chatbubblesOutline,
      'settings-outline': settingsOutline,
      'close-outline': closeOutline,
      'trash-outline': trashOutline,
      'checkbox-outline': checkboxOutline,
      'square-outline': squareOutline,
      'person-circle': personCircle
    });
  }

  toggleAiSimulation(event: any) {
    this.isAiSimulationActive = event.detail.checked;
    localStorage.setItem('compraki_grok_simulation', String(this.isAiSimulationActive));
  }

  get filteredChats(): ChatRoom[] {
    if (this.activeTab === 'closed') {
      return this.activeChats.filter(c => c.status === 'closed');
    }
    // Ativas = sem status ou status 'active'
    return this.activeChats.filter(c => !c.status || c.status === 'active');
  }

  get activeCount(): number {
    return this.activeChats.filter(c => !c.status || c.status === 'active').length;
  }

  get closedCount(): number {
    return this.activeChats.filter(c => c.status === 'closed').length;
  }

  getOtherParticipant(chat: ChatRoom): ChatParticipant | undefined {
    const user = this.chatService.getCurrentUser();
    return chat.participants.find(p => p.uid !== user?.uid);
  }

  onSelectChat(chatId: string) {
    if (this.isSelectionMode) {
      this.toggleChatSelection(chatId);
      return;
    }
    this.chatSelected.emit(chatId);
  }

  toggleSelectionMode() {
    this.isSelectionMode = !this.isSelectionMode;
    if (!this.isSelectionMode) {
      this.selectedChatIds.clear();
    }
  }

  toggleChatSelection(chatId: string) {
    if (this.selectedChatIds.has(chatId)) {
      this.selectedChatIds.delete(chatId);
    } else {
      this.selectedChatIds.add(chatId);
    }
  }

  toggleSelectAll() {
    const allIdsOfTab = this.filteredChats.map(c => c.id!);
    const allSelected = allIdsOfTab.every(id => this.selectedChatIds.has(id));

    if (allSelected) {
      allIdsOfTab.forEach(id => this.selectedChatIds.delete(id));
    } else {
      allIdsOfTab.forEach(id => this.selectedChatIds.add(id));
    }
  }

  isChatSelected(chatId: string): boolean {
    return this.selectedChatIds.has(chatId);
  }

  async onDeleteSelected() {
    if (this.selectedChatIds.size === 0) return;

    // ETAPA 1: Alerta Sério
    const alert1 = await this.alertCtrl.create({
      header: 'ATENÇÃO CRÍTICA!',
      subHeader: `Você está prestes a apagar ${this.selectedChatIds.size} conversas permanentemente.`,
      message: 'Esta ação não poderá ser desfeita. Todo o histórico de mensagens e anexos será perdido para sempre.',
      cssClass: 'serious-alert',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { 
          text: 'Entendi, Continuar', 
          role: 'destructive',
          handler: () => {
            this.confirmFinalDeletion();
          }
        }
      ]
    });

    await alert1.present();
  }

  private async confirmFinalDeletion() {
    // ETAPA 2: Confirmação Absoluta
    const alert2 = await this.alertCtrl.create({
      header: 'Última Confirmação',
      message: 'Tem certeza absoluta de que deseja proceder com a exclusão?',
      buttons: [
        { text: 'Não! Cancelar', role: 'cancel' },
        { 
          text: 'SIM, APAGAR AGORA', 
          role: 'destructive',
          handler: async () => {
            await this.performBulkDelete();
          }
        }
      ]
    });

    await alert2.present();
  }

  private async performBulkDelete() {
    const ids = Array.from(this.selectedChatIds);
    try {
      await this.chatService.deleteChatsBulk(ids);
      
      this.showToast(`${ids.length} conversas apagadas com sucesso.`);
      
      // Limpa estado
      this.selectedChatIds.clear();
      this.isSelectionMode = false;
      
    } catch (e) {
      console.error("Erro na exclusão em massa:", e);
      this.showToast('Erro ao apagar algumas conversas. Tente novamente.', 'danger');
    }
  }

  async showToast(message: string, color: string = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  onBackToInbox() {
    this.backToInbox.emit();
  }

  onCloseChat() {
    this.chatClosed.emit();
  }

  onInboxDismissed() {
    this.inboxDismissed.emit();
  }

  onChatFinalized(chatId: string) {
    // Muda para aba finalizadas e volta para inbox
    this.activeTab = 'closed';
    this.onBackToInbox();
  }

  getFormattedDate(timestamp: any): string {
    if (!timestamp || !timestamp.seconds) return '';
    const date = new Date(timestamp.seconds * 1000);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
    const isYesterday = date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth() && date.getFullYear() === yesterday.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } else if (isYesterday) {
      return 'Ontem';
    } else {
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }
  }
}
