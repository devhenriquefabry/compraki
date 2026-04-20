import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, AlertController, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, refreshOutline, chatbubbles, chatbubblesOutline, flag, flagOutline, ban, banOutline, chatboxOutline, chevronForwardOutline, arrowForwardOutline, searchOutline, gridOutline, cartOutline, closeCircleOutline, timeOutline, arrowBackOutline } from 'ionicons/icons';
import { Subscription, combineLatest } from 'rxjs';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { FirebaseUsersService } from '../../services/firebase-users.service';
import { PresenceService } from '../../services/presence.service';
import { ChatRoom, ChatMessage, ChatParticipant, ChatReport } from '../../interfaces/chat';
import { AppUser } from '../../interfaces/app-user';
import { ChatBoxComponent } from '../../components/chat-box/chat-box.component';
import { AdminHeaderComponent } from '../../components/admin-header/admin-header.component';
import { AdminChatSidebarComponent } from '../../components/admin-chat-sidebar/admin-chat-sidebar.component';

@Component({
  selector: 'app-manage-chats',
  templateUrl: './manage-chats.page.html',
  styleUrls: ['./manage-chats.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, ChatBoxComponent, IonicModule, AdminHeaderComponent, AdminChatSidebarComponent]
})
export class ManageChatsPage implements OnInit, OnDestroy {

  activeTab: 'all' | 'reported' | 'banned' = 'all';
  
  // Modais e Estados de Busca
  isNewChatModalOpen = false;
  userSearchQuery = '';
  
  chats: ChatRoom[] = [];
  reports: ChatReport[] = [];
  users: AppUser[] = [];
  
  selectedChatId: string | null = null;
  activeChatRoom?: ChatRoom;
  activeChatTargetUser?: AppUser;
  
  searchQuery: string = '';
  isLoading = true;
  
  // -- DASHBOARD AUDIT 360 --
  public inspectedMessages: ChatMessage[] = [];
  public heatmap: { day: string, count: number, intensity: number }[] = [];
  private chatSub?: Subscription;
  
  // -- ADMIN CHAT HUB STATES (Sidebar Direita) --
  public isChatOpen = false;
  public activeChatId = '';
  public activeChats: ChatRoom[] = [];
  public isInboxOpen = false;
  public activeSellerFallbackName = '';
  
  private subs = new Subscription();

  constructor(
    private chatService: FirebaseChatService,
    private userService: FirebaseUsersService,
    private presenceService: PresenceService, // Injetado para ativar monitoramento
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {
    addIcons({ add, refreshOutline, chatbubbles, chatbubblesOutline, flag, flagOutline, ban, banOutline, chatboxOutline, chevronForwardOutline, arrowForwardOutline, searchOutline, gridOutline, cartOutline, closeCircleOutline, timeOutline, arrowBackOutline });
  }

  ngOnInit() {
    this.loadData();
    this.monitorAdminChats();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    if (this.chatSub) this.chatSub.unsubscribe();
  }

  loadData() {
    this.isLoading = true;
    
    // Puxa conversas, denúncias e usuários em paralelo
    const chats$ = this.chatService.getAllChatsAdmin();
    const reports$ = this.chatService.getReports();
    const users$ = this.userService.getAllUsers();

    this.subs.add(
      combineLatest([chats$, reports$, users$]).subscribe({
        next: ([chats, reports, users]) => {
          this.chats = chats;
          this.reports = reports;
          this.users = users;
          this.isLoading = false;
          
          if (this.selectedChatId) {
            this.refreshActiveChatDetails();
          }
        },
        error: (err) => {
          console.error("Erro ao carregar dados do dashboard de mods:", err);
          this.isLoading = false;
        }
      })
    );
  }

  get filteredChats() {
    let list = this.chats;

    if (this.activeTab === 'reported') {
      // Filtra chats que possuem denúncias pendentes
      const reportedChatIds = this.reports.filter(r => r.status === 'pending').map(r => r.chatId);
      list = list.filter(c => reportedChatIds.includes(c.id!));
    } else if (this.activeTab === 'banned') {
      // Filtra usuários banidos e mostra as conversas deles
      const bannedUserIds = this.users.filter(u => u.isChatBanned).map(u => u.uid);
      list = list.filter(c => c.participantIds.some(pid => bannedUserIds.includes(pid)));
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(c => 
        c.productName?.toLowerCase().includes(q) || 
        c.participants.some(p => p.name?.toLowerCase().includes(q))
      );
    }

    return list;
  }

  get filteredUsers() {
    if (!this.userSearchQuery.trim()) return this.users;
    const q = this.userSearchQuery.toLowerCase();
    return this.users.filter(u => 
      u.displayName?.toLowerCase().includes(q) || 
      u.email?.toLowerCase().includes(q)
    );
  }

  openNewChatModal() {
    this.isNewChatModalOpen = true;
    this.userSearchQuery = '';
  }

  async startChatWithUser(user: AppUser) {
    this.isNewChatModalOpen = false;
    try {
      this.isLoading = true;
      const chatId = await this.chatService.startChat({
        uid: user.uid,
        name: user.displayName || 'Usuário',
        photoUrl: user.photoURL || undefined
      });
      
      this.selectChat(chatId);
      this.showToast(`Conversa iniciada com ${user.displayName}`);
    } catch (e: any) {
      console.error("Erro ao iniciar chat:", e);
      this.showToast(e.message || 'Erro ao iniciar conversa');
    } finally {
      this.isLoading = false;
    }
  }

  selectChat(chatId: string) {
    this.selectedChatId = chatId;
    this.activeChatRoom = this.chats.find(c => c.id === chatId);
    
    // Limpa dados anteriores
    this.inspectedMessages = [];
    this.heatmap = [];
    if (this.chatSub) this.chatSub.unsubscribe();

    if (this.activeChatRoom) {
      // Subscrição para análise de auditoria (Histórico e Heatmap em tempo real)
      this.chatSub = this.chatService.getMessages(chatId, 100).subscribe(msgs => {
        this.inspectedMessages = msgs;
        this.generateHeatmap(msgs);
      });
    }
  }

  generateHeatmap(msgs: ChatMessage[]) {
    const days = 14;
    const now = new Date();
    const result = [];
    const counts: {[key: string]: number} = {};

    msgs.forEach(m => {
      if (m.createdAt) {
        const d = new Date(m.createdAt.seconds * 1000);
        const key = d.toISOString().split('T')[0];
        counts[key] = (counts[key] || 0) + 1;
      }
    });

    const vals = Object.values(counts);
    const max = vals.length > 0 ? Math.max(...vals) : 1;

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const count = counts[key] || 0;
      
      result.push({
        day: d.toLocaleDateString('pt-BR', { weekday: 'short' }),
        count: count,
        intensity: Math.min(Math.floor((count / (max * 0.4 || 1)) * 4), 4)
      });
    }
    this.heatmap = result;
  }

  clearSelection() {
    this.selectedChatId = null;
    this.activeChatTargetUser = undefined;
  }

  async refreshActiveChatDetails() {
    this.activeChatRoom = this.chats.find(c => c.id === this.selectedChatId);
    if (this.activeChatRoom) {
      // No dashboard admin, o "target" costuma ser o cliente ou vendedor suspeito
      // Vamos assumir que buscamos os dados do usuário que NÃO é o admin logado
      const adminId = this.chatService.getCurrentUser()?.uid;
      const targetId = this.activeChatRoom.participantIds.find(id => id !== adminId);
      if (targetId) {
        this.activeChatTargetUser = this.users.find(u => u.uid === targetId);
      }
    }
  }

  // -- MÉTODOS DO ADMIN CHAT HUB (SIDEBAR) --
  
  monitorAdminChats() {
    this.subs.add(
      this.chatService.getMyChats().subscribe(chats => {
        this.activeChats = chats;
      })
    );
  }

  openChatFromInbox(chatId: string) {
    this.activeChatId = chatId;
    this.isChatOpen = true; 
    this.isInboxOpen = false;
    
    const chat = this.activeChats.find(c => c.id === chatId);
    if (chat && chat.participants) {
      const other = chat.participants.find(p => p.uid !== this.chatService.getCurrentUser()?.uid);
      if (other) this.activeSellerFallbackName = other.name;
    }
  }

  public openInbox() {
    if (window.innerWidth >= 992) {
      this.isChatOpen = true;
      this.activeChatId = '';
    } else {
      this.isInboxOpen = true;
    }
  }

  public goBackToInbox() {
    this.activeChatId = '';
    this.activeSellerFallbackName = '';
  }

  public closeChat() {
    this.isChatOpen = false;
    this.activeChatId = '';
  }

  public getActiveSellerName(): string {
    if (!this.activeChatId) return '';
    const chat = this.activeChats.find(c => c.id === this.activeChatId);
    if (chat && chat.participants) {
      const user = this.chatService.getCurrentUser();
      const other = chat.participants.find(p => p.uid !== user?.uid);
      if (other && other.name) return other.name;
    }
    return this.activeSellerFallbackName;
  }

  getReportsForChat(chatId: string) {
    return this.reports.filter(r => r.chatId === chatId);
  }

  async toggleBan(user: AppUser) {
    const isBanned = user.isChatBanned;
    const alert = await this.alertCtrl.create({
      header: isBanned ? 'Desbanir Usuário' : 'Banir do Chat',
      message: isBanned 
        ? `Deseja permitir que ${user.displayName} volte a enviar mensagens?`
        : `Deseja impedir que ${user.displayName} inicie ou envie mensagens em qualquer chat? Ele ainda poderá realizar compras e vendas.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { 
          text: isBanned ? 'Confirmar Desbanimento' : 'CONFIRMAR BANIMENTO',
          role: isBanned ? '' : 'destructive',
          handler: async () => {
            await this.chatService.toggleUserChatBan(user.uid, !isBanned);
            this.showToast(isBanned ? 'Usuário desbanido.' : 'Usuário banido do chat.');
          }
        }
      ]
    });
    await alert.present();
  }

  async showToast(message: string) {
    const toast = await this.toastCtrl.create({
      message, duration: 2000, position: 'bottom'
    });
    await toast.present();
  }

  getParticipantNames(chat: ChatRoom) {
    return chat.participants.map(p => p.name).join(' e ');
  }

  getOtherParticipant(chat: ChatRoom) {
    const adminId = this.chatService.getCurrentUser()?.uid;
    return chat.participants.find(p => p.uid !== adminId);
  }

  formatDate(timestamp: any) {
    if (!timestamp) return '';
    const d = new Date(timestamp.seconds * 1000);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
}
