import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, AlertController, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, addCircle, refreshOutline, chatbubbles, chatbubblesOutline, flag, flagOutline, ban, banOutline, chatboxOutline, chevronForwardOutline, arrowForwardOutline, searchOutline, gridOutline, cartOutline, cameraOutline, micOutline, trashOutline, closeCircleOutline, timeOutline, arrowBackOutline, swapHorizontalOutline, optionsOutline } from 'ionicons/icons';
import { Subscription, combineLatest } from 'rxjs';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { FirebaseUsersService } from '../../services/firebase-users.service';
import { PresenceService } from '../../services/presence.service';
import { ChatRoom, ChatMessage, ChatParticipant, ChatReport } from '../../interfaces/chat';
import { AppUser } from '../../interfaces/app-user';
import { ChatBoxComponent } from '../../components/chat-box/chat-box.component';
import { AdminHeaderComponent } from '../../components/admin-header/admin-header.component';
import { AdminChatSidebarComponent } from '../../components/admin-chat-sidebar/admin-chat-sidebar.component';
import { AdminChatFilterModalComponent } from '../../components/admin-chat-filter-modal/admin-chat-filter-modal.component';
import { AdminMetricCardComponent } from '../../components/admin-metric-card/admin-metric-card.component';
import { AdminPanelHeroComponent } from '../../components/admin-panel-hero/admin-panel-hero.component';

@Component({
  selector: 'app-manage-chats',
  templateUrl: './manage-chats.page.html',
  styleUrls: ['./manage-chats.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, ChatBoxComponent, IonicModule, AdminHeaderComponent, AdminChatSidebarComponent, AdminChatFilterModalComponent, AdminMetricCardComponent, AdminPanelHeroComponent]
})
export class ManageChatsPage implements OnInit, OnDestroy {
  @ViewChild(ChatBoxComponent) chatBox?: ChatBoxComponent; 


  activeTab: 'all' | 'reported' | 'banned' = 'all';
  
  // Modais e Estados de Busca
  public searchQuery: string = '';
  public userSearchQuery: string = '';
  public isLoading: boolean = true;
  public isNewChatModalOpen: boolean = false;

  // -- MATRIZ DE FILTROS 360 --
  public chatFilterState = {
    status: 'all',          // all, active, reported, banned, closed
    chatType: 'all',        // all, product, general
    dateRange: 'all',       // all, today, 7days, 30days
    participantId: 'all',   // specific UID
    sortBy: 'newest'        // newest, oldest, activity
  };

  public get participantsList() {
    return this.users.map(u => ({ id: u.uid, name: u.displayName || u.email || 'Usuário Sem Nome' }));
  }
  
  chats: ChatRoom[] = [];
  reports: ChatReport[] = [];
  users: AppUser[] = [];
  
  selectedChatId: string | null = null;
  activeChatRoom?: ChatRoom;
  activeChatTargetUser?: AppUser;
  
  public currentUserId: string = '';
  
  // -- DASHBOARD METRICS --
  get totalChatsCount() { return this.chats.length; }
  get activeReportsCount() { return this.reports.filter(r => r.status === 'pending').length; }
  get businessChatsCount() { return this.chats.filter(c => !!c.productId).length; }
  get restrictedUsersCount() { return this.users.filter(u => !!u.isChatBanned).length; }
  
  // -- BATCH OPERATIONS --
  public selectedChatIds: Set<string> = new Set();
  public isAllSelected: boolean = false;
  get selectedCount() { return this.selectedChatIds.size; }
  
  public totalMessagesCount: number = 0;
  public totalImagesCount: number = 0;
  public totalAudiosCount: number = 0;

  // -- DASHBOARD AUDIT 360 --
  public inspectedMessages: ChatMessage[] = [];
  public heatmap: { day: string; dayNum: number; fullDate: string; count: number; intensity: number; messages: ChatMessage[] }[] = [];
  public selectedHeatmapDay: any = null;
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
    addIcons({ 
      add, 
      addCircle, 
      refreshOutline, 
      chatbubbles, 
      chatbubblesOutline, 
      flag, 
      flagOutline, 
      ban, 
      banOutline, 
      chatboxOutline, 
      chevronForwardOutline, 
      arrowForwardOutline, 
      searchOutline, 
      gridOutline, 
      cartOutline, 
      cameraOutline, 
      micOutline, 
      trashOutline, 
      closeCircleOutline, 
      timeOutline, 
      arrowBackOutline, 
      swapHorizontalOutline, 
      optionsOutline,
      'add-circle': addCircle,
      'refresh-outline': refreshOutline,
      'chatbubbles-outline': chatbubblesOutline,
      'flag-outline': flagOutline,
      'ban-outline': banOutline,
      'chatbox-outline': chatboxOutline,
      'chevron-forward-outline': chevronForwardOutline,
      'arrow-forward-outline': arrowForwardOutline,
      'search-outline': searchOutline,
      'grid-outline': gridOutline,
      'cart-outline': cartOutline,
      'camera-outline': cameraOutline,
      'mic-outline': micOutline,
      'trash-outline': trashOutline,
      'close-circle-outline': closeCircleOutline,
      'time-outline': timeOutline,
      'arrow-back-outline': arrowBackOutline,
      'swap-horizontal-outline': swapHorizontalOutline,
      'options-outline': optionsOutline
    });
  }

  ngOnInit() {
    this.currentUserId = this.chatService.getCurrentUser()?.uid || '';
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

    // Carrega contagem de mensagens separadamente (Aggregation query)
    this.chatService.getTotalMessagesCount().then(count => this.totalMessagesCount = count);
    this.chatService.getTotalMediaCount('image').then(count => this.totalImagesCount = count);
    this.chatService.getTotalMediaCount('audio').then(count => this.totalAudiosCount = count);
  }

  get filteredChats() {
    let list = this.chats;

    // 1. Filtro por Aba Superior (Legacy Compatibility)
    if (this.activeTab === 'reported') {
      const reportedChatIds = this.reports.filter(r => r.status === 'pending').map(r => r.chatId);
      list = list.filter(c => reportedChatIds.includes(c.id!));
    } else if (this.activeTab === 'banned') {
      const bannedUserIds = this.users.filter(u => u.isChatBanned).map(u => u.uid);
      list = list.filter(c => c.participantIds.some(pid => bannedUserIds.includes(pid)));
    }

    // 2. Filtros Avançados (Matriz 360)
    if (this.chatFilterState.status !== 'all') {
      if (this.chatFilterState.status === 'reported') {
        const reportedIds = this.reports.filter(r => r.status === 'pending').map(r => r.chatId);
        list = list.filter(c => reportedIds.includes(c.id!));
      } else if (this.chatFilterState.status === 'banned') {
        const bannedIds = this.users.filter(u => u.isChatBanned).map(u => u.uid);
        list = list.filter(c => c.participantIds.some(pid => bannedIds.includes(pid)));
      } else if (this.chatFilterState.status === 'active') {
        list = list.filter(c => c.status === 'active');
      } else if (this.chatFilterState.status === 'closed') {
        list = list.filter(c => c.status === 'closed');
      }
    }

    if (this.chatFilterState.chatType !== 'all') {
      const isProduct = this.chatFilterState.chatType === 'product';
      list = list.filter(c => isProduct ? !!c.productId : !c.productId);
    }

    if (this.chatFilterState.participantId !== 'all') {
      list = list.filter(c => c.participantIds.includes(this.chatFilterState.participantId));
    }

    if (this.chatFilterState.dateRange !== 'all') {
      const now = new Date().getTime();
      const oneDay = 24 * 60 * 60 * 1000;
      let threshold = 0;
      if (this.chatFilterState.dateRange === 'today') threshold = now - oneDay;
      else if (this.chatFilterState.dateRange === '7days') threshold = now - (7 * oneDay);
      else if (this.chatFilterState.dateRange === '30days') threshold = now - (30 * oneDay);
      
      list = list.filter(c => {
        const created = this.chatService.convertTimestampToDate(c.createdAt).getTime();
        return created >= threshold;
      });
    }

    // 3. Busca por Texto
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(c => 
        c.productName?.toLowerCase().includes(q) || 
        c.participants.some(p => p.name?.toLowerCase().includes(q))
      );
    }

    // 4. Ordenação
    list = [...list].sort((a, b) => {
      if (this.chatFilterState.sortBy === 'newest') {
        const dateB = this.chatService.convertTimestampToDate(b.lastMessageAt || b.createdAt).getTime();
        const dateA = this.chatService.convertTimestampToDate(a.lastMessageAt || a.createdAt).getTime();
        return dateB - dateA;
      } else if (this.chatFilterState.sortBy === 'oldest') {
        return this.chatService.convertTimestampToDate(a.createdAt).getTime() - 
               this.chatService.convertTimestampToDate(b.createdAt).getTime();
      }
      return 0;
    });

    return list;
  }

  // -- BATCH METHODS --
  toggleChatSelection(chatId: string) {
    if (this.selectedChatIds.has(chatId)) {
      this.selectedChatIds.delete(chatId);
    } else {
      this.selectedChatIds.add(chatId);
    }
  }

  isChatSelected(chatId: string): boolean {
    return this.selectedChatIds.has(chatId);
  }

  toggleSelectAll(event: any) {
    const isChecked = event.detail.checked;
    this.isAllSelected = isChecked;
    
    if (isChecked) {
      this.filteredChats.forEach(c => {
        if (c.id) this.selectedChatIds.add(c.id);
      });
    } else {
      this.selectedChatIds.clear();
    }
  }

  async deleteSelectedChats() {
    if (this.selectedCount === 0) return;

    const alert = await this.alertCtrl.create({
      header: 'Confirmar Exclusão',
      mode: 'ios',
      message: `Deseja realmente excluir ${this.selectedCount} conversas permanentemente? Esta ação não pode ser desfeita.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Excluir em Lote',
          role: 'destructive',
          handler: async () => {
             await this.performBulkDelete();
          }
        }
      ]
    });

    await alert.present();
  }

  private async performBulkDelete() {
    try {
      const idsToDelete = Array.from(this.selectedChatIds);
      this.isLoading = true;
      
      await this.chatService.deleteChatsBulk(idsToDelete);
      
      this.selectedChatIds.clear();
      this.isAllSelected = false;
      this.isLoading = false;
      this.showToast(`${idsToDelete.length} conversas excluídas com sucesso.`);
    } catch (err) {
      console.error("Erro na exclusão em lote:", err);
      this.isLoading = false;
      this.showToast("Falha ao excluir algumas conversas.", 'danger');
    }
  }

  applyFilters() {
    // Apenas para triggar a reavaliação se necessário, mas o getter já cuida disso se o objeto mudar
    // Como o ngModel está bindado diretamente, o getter filteredChats reage automaticamente
  }

  clearFilters() {
    this.chatFilterState = {
      status: 'all',
      chatType: 'all',
      dateRange: 'all',
      participantId: 'all',
      sortBy: 'newest'
    };
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
    this.selectedHeatmapDay = null;
    if (this.chatSub) this.chatSub.unsubscribe();

    if (this.activeChatRoom) {
      // Subscrição para análise de auditoria (Histórico e Heatmap em tempo real)
      this.chatSub = this.chatService.getMessages(chatId, 100).subscribe(msgs => {
        this.inspectedMessages = msgs;
        this.generateHeatmap(msgs);
        
        // Se houver um dia selecionado, atualiza as mensagens dele
        if (this.selectedHeatmapDay) {
          const updatedDay = this.heatmap.find(d => d.fullDate === this.selectedHeatmapDay.fullDate);
          if (updatedDay) this.selectedHeatmapDay = updatedDay;
        }
      });
    }
  }

  toggleHeatmapDay(day: any) {
    if (this.selectedHeatmapDay?.fullDate === day.fullDate) {
      this.selectedHeatmapDay = null;
    } else {
      this.selectedHeatmapDay = day;
      
      // Sincronização Temporal: Rola o chat até a primeira mensagem do dia
      if (day.messages && day.messages.length > 0 && this.chatBox) {
        const firstMsgId = day.messages[0].id || day.messages[0].clientId;
        if (firstMsgId) {
          this.chatBox.scrollToMessage(firstMsgId);
        }
      }
    }
  }

  trackHeatDay(_i: number, d: { fullDate: string }): string {
    return d.fullDate;
  }


  generateHeatmap(msgs: ChatMessage[]) {
    const days = 14;
    const now = new Date();
    const result = [];
    
    // Mapeia mensagens por dia para facilitar o agrupamento
    const msgGroups: {[key: string]: ChatMessage[]} = {};
    msgs.forEach(m => {
      if (m.createdAt) {
        const d = new Date(m.createdAt.seconds * 1000);
        const key = d.toISOString().split('T')[0];
        if (!msgGroups[key]) msgGroups[key] = [];
        msgGroups[key].push(m);
      }
    });

    const max = Math.max(...Object.values(msgGroups).map(g => g.length), 1);

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const dayMsgs = msgGroups[key] || [];
      
      result.push({
        day: d.toLocaleDateString('pt-BR', { weekday: 'short' }),
        dayNum: d.getDate(),
        fullDate: key,
        count: dayMsgs.length,
        intensity: dayMsgs.length > 0 ? Math.min(Math.floor((dayMsgs.length / (max * 0.4 || 1)) * 4), 4) : 0,
        messages: dayMsgs
      });
    }
    this.heatmap = result;
  }


  clearSelection() {
    this.selectedChatId = null;
    this.activeChatTargetUser = undefined;
  }

  getParticipantName(uid: string): string {
    if (!this.activeChatRoom || !this.activeChatRoom.participants) return 'Usuário';
    const participant = this.activeChatRoom.participants.find(p => p.uid === uid);
    return participant ? participant.name : 'Usuário';
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
    this.activeChatId = '';
    this.isChatOpen = false;
    this.isInboxOpen = true;
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

  async showToast(message: string, color: string = 'success') {
    const toast = await this.toastCtrl.create({
      message, duration: 2000, color, position: 'bottom'
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
