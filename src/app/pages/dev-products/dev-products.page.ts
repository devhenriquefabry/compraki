import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { FirebaseProducts } from '../../services/firebase-products';
import { FirebaseUsersService } from '../../services/firebase-users.service';
import { Product } from '../../interfaces/product';
import { Subscription, Observable, of } from 'rxjs';
import { AlertController, ToastController } from '@ionic/angular';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { User } from 'firebase/auth';
import { ChatRoom, ChatParticipant } from '../../interfaces/chat';
import { AdminStatsGridComponent } from '../../components/admin-stats-grid/admin-stats-grid.component';
import { AdminFilterModalComponent } from '../../components/admin-filter-modal/admin-filter-modal.component';
import { AdminProductCardComponent } from '../../components/admin-product-card/admin-product-card.component';
import { AdminChatSidebarComponent } from '../../components/admin-chat-sidebar/admin-chat-sidebar.component';
import { AdminHeaderComponent } from '../../components/admin-header/admin-header.component';
import { ProductDetailModalComponent } from '../../components/product-detail-modal/product-detail-modal.component';

@Component({
  selector: 'app-dev-products',
  templateUrl: './dev-products.page.html',
  styleUrls: ['./dev-products.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AdminStatsGridComponent,
    AdminFilterModalComponent,
    AdminProductCardComponent,
    AdminChatSidebarComponent,
    AdminHeaderComponent,
    ProductDetailModalComponent
  ]
})
export class DevProductsPage implements OnInit, OnDestroy {

  public products: (Product & { selected?: boolean })[] = [];
  public filteredProducts: (Product & { selected?: boolean })[] = [];
  public searchTerm: string = '';
  public isLoading: boolean = true;
  public showFilters: boolean = false;
  public selectedProduct: any = null;

  public isChatOpen = false;
  public activeChatId = '';

  // Filtros Avançados
  public filterState = {
    condition: 'todos',
    stockStatus: 'todos',
    minPrice: null as number | null,
    maxPrice: null as number | null,
    sellerId: 'todos',
    sortBy: 'newest'
  };
  
  // Dashboard Stats
  public stats = {
    totalItems: 0,
    totalValue: 0,
    newItems: 0,
    outOfStockItems: 0
  };

  // Financial Stats
  public financialStats = {
    avgTicket: 0,
    soldRevenue: 0,
    unitsSold: 0,
    stockValue: 0
  };

  // Shipping Stats (Mock/Derivado provisoriamente pois não há serviço de ordens)
  public shippingStats = {
    pendingDelivery: 0,
    lateDelivery: 0,
    lateToday: 0,
    pendingValue: 0
  };

  public activeChats: ChatRoom[] = [];
  public isInboxOpen = false;

  private productSub?: Subscription;
  private userSub?: Subscription;
  private chatListSub?: Subscription;

  public usersMap: { [key: string]: string } = {};
  public sellersList: { id: string, name: string }[] = [];
  public currentUser$: Observable<User | null>;

  constructor(
    private firebaseProducts: FirebaseProducts,
    private firebaseUsers: FirebaseUsersService,
    private chatService: FirebaseChatService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) { 
    this.currentUser$ = of(this.chatService.getCurrentUser());
  }

  ngOnInit() {
    this.loadUsers();
    this.loadProducts();
    this.monitorChats();
    this.restoreChatState();
  }

  private saveChatState() {
    localStorage.setItem('compraki_chat_open', JSON.stringify(this.isChatOpen));
    localStorage.setItem('compraki_active_chat_id', this.activeChatId || '');
    localStorage.setItem('compraki_active_seller_name', this.activeSellerFallbackName || '');
  }

  private restoreChatState() {
    try {
      const isWindowLarge = window.innerWidth >= 992;
      const wasOpen = localStorage.getItem('compraki_chat_open');
      const savedId = localStorage.getItem('compraki_active_chat_id');
      const savedName = localStorage.getItem('compraki_active_seller_name');

      if (wasOpen === 'true' && isWindowLarge) {
        this.isChatOpen = true;
        this.activeChatId = savedId || '';
        this.activeSellerFallbackName = savedName || '';
      }
    } catch (e) {
      console.warn("Falha ao restaurar estado do chat", e);
    }
  }

  ngOnDestroy() {
    this.productSub?.unsubscribe();
    this.userSub?.unsubscribe();
    this.chatListSub?.unsubscribe();
  }

  monitorChats() {
    this.chatListSub = this.chatService.getMyChats().subscribe(chats => {
      this.activeChats = chats;
    });
  }

  getOtherParticipant(chat: ChatRoom): ChatParticipant | undefined {
    const user = this.chatService.getCurrentUser();
    return chat.participants.find(p => p.uid !== user?.uid);
  }

  openChatFromInbox(chatId: string) {
    this.activeChatId = chatId;
    this.isChatOpen = true; 
    this.isInboxOpen = false;

    // Tenta carregar o nome do fallback se já conhecermos o chat
    const chat = this.activeChats.find(c => c.id === chatId);
    if (chat && chat.participants) {
      const other = chat.participants.find(p => p.uid !== this.chatService.getCurrentUser()?.uid);
      if (other) this.activeSellerFallbackName = other.name;
    }
    this.saveChatState();
  }

  public openInbox() {
    if (window.innerWidth >= 992) {
      this.isChatOpen = true;
      this.activeChatId = '';
    } else {
      this.isInboxOpen = true;
    }
    this.saveChatState();
  }

  public goBackToInbox() {
    this.activeChatId = '';
    this.activeSellerFallbackName = '';
    this.saveChatState();
  }

  loadUsers() {
    this.userSub = this.firebaseUsers.getAllUsers().subscribe(users => {
      this.sellersList = [];
      users.forEach(u => {
        if (u.uid) {
          this.usersMap[u.uid] = u.displayName || 'Sem Nome';
          this.sellersList.push({ id: u.uid, name: u.displayName || 'Sem Nome' });
        }
      });
    });
  }

  loadProducts() {
    this.isLoading = true;
    this.productSub = this.firebaseProducts.getAll().subscribe({
      next: (data) => {
        this.products = data.map(p => {
          // Converte Timestamps do Firestore para objetos Date do JS
          const createdAt = p.createdAt?.toDate ? p.createdAt.toDate() : p.createdAt;
          const updatedAt = p.updatedAt?.toDate ? p.updatedAt.toDate() : p.updatedAt;
          
          return { 
            ...p, 
            createdAt,
            updatedAt,
            selected: false 
          };
        });
        this.calculateStats();
        this.applyFilters();
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Erro ao carregar produtos:', err);
        this.isLoading = false;
      }
    });
  }

  calculateStats() {
    // Stats refletem a base total do sistema para monitoramento real
    this.stats = {
      totalItems: this.products.length,
      totalValue: this.products.reduce((acc, p) => acc + (p.price || 0), 0),
      newItems: this.products.filter(p => p.condition === 'novo').length,
      outOfStockItems: this.products.filter(p => (p.stock || 0) <= 0).length
    };

    // Financial Stats
    const totalSold = this.products.reduce((acc, p) => acc + (p.soldCount || 0), 0);
    const soldRevenue = this.products.reduce((acc, p) => acc + ((p.soldCount || 0) * (p.price || 0)), 0);
    const stockValue = this.products.reduce((acc, p) => acc + ((p.stock || 0) * (p.price || 0)), 0);
    this.financialStats = {
      avgTicket: this.products.length > 0 ? this.stats.totalValue / this.products.length : 0,
      soldRevenue,
      unitsSold: totalSold,
      stockValue
    };

    // Shipping Stats Mock Baseados nas vendas
    // Supondo que 10% das vendas estejam pendentes de envio
    const mockPendingSales = Math.floor(totalSold * 0.1) || (totalSold > 0 ? 1 : 0);
    this.shippingStats = {
      pendingDelivery: mockPendingSales,
      lateDelivery: Math.floor(mockPendingSales * 0.2),
      lateToday: Math.floor(mockPendingSales * 0.05),
      pendingValue: mockPendingSales > 0 ? (this.financialStats.avgTicket * mockPendingSales) : 0
    };
  }

  applyFilters() {
    const term = this.searchTerm.toLowerCase().trim();
    
    this.filteredProducts = this.products.filter(p => {
      // 1. Busca por Texto (Nome, Desc, Vendedor)
      const matchesSearch = !term || 
        p.name.toLowerCase().includes(term) || 
        p.description?.toLowerCase().includes(term) ||
        this.usersMap[p.sellerId || '']?.toLowerCase().includes(term);

      // 2. Filtro de Condição
      const matchesCondition = this.filterState.condition === 'todos' || p.condition === this.filterState.condition;

      // 3. Filtro de Estoque
      const matchesStock = this.filterState.stockStatus === 'todos' || 
        (this.filterState.stockStatus === 'disponivel' ? (p.stock || 0) > 0 : (p.stock || 0) === 0);

      // 4. Filtro de Vendedor
      const matchesSeller = this.filterState.sellerId === 'todos' || p.sellerId === this.filterState.sellerId;

      // 5. Filtro de Preço
      const matchesMinPrice = this.filterState.minPrice === null || p.price >= this.filterState.minPrice;
      const matchesMaxPrice = this.filterState.maxPrice === null || p.price <= this.filterState.maxPrice;

      return matchesSearch && matchesCondition && matchesStock && matchesSeller && matchesMinPrice && matchesMaxPrice;
    });

    // 1. Aplica a ordenação selecionada pelo usuário
    this.filteredProducts.sort((a, b) => {
      switch (this.filterState.sortBy) {
        case 'priceLow':
          return (a.price || 0) - (b.price || 0);
        case 'priceHigh':
          return (b.price || 0) - (a.price || 0);
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'mostSold':
          return (b.soldCount || 0) - (a.soldCount || 0);
        case 'newest':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    // 2. Ordenação Secundária (Regra de Ouro): Disponíveis primeiro, Esgotados por último
    // Isso garante que os esgotados fiquem no fim idependente da ordenação escolhida acima
    this.filteredProducts.sort((a, b) => {
      const stockA = a.stock || 0;
      const stockB = b.stock || 0;
      if (stockA > 0 && stockB <= 0) return -1;
      if (stockA <= 0 && stockB > 0) return 1;
      return 0;
    });
  }

  clearFilters() {
    this.filterState = {
      condition: 'todos',
      stockStatus: 'todos',
      minPrice: null,
      maxPrice: null,
      sellerId: 'todos',
      sortBy: 'newest'
    };
    this.searchTerm = '';
    this.applyFilters();
  }

  toggleSelectAll(event: any) {
    const isChecked = event.detail.checked;
    this.filteredProducts.forEach(p => p.selected = isChecked);
  }

  get selectedCount(): number {
    return this.products.filter(p => p.selected).length;
  }

  async deleteBatch() {
    const selectedIds = this.products.filter(p => p.selected).map(p => p.id!);
    if (selectedIds.length === 0) return;

    const alert = await this.alertCtrl.create({
      header: 'Confirmar Exclusão',
      message: `Deseja realmente excluir ${selectedIds.length} produtos permanentemente?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { 
          text: 'Excluir', 
          role: 'destructive',
          handler: async () => {
            await this.performDelete(selectedIds);
          }
        }
      ]
    });

    await alert.present();
  }

  private async performDelete(ids: string[]) {
    try {
      for (const id of ids) {
        await this.firebaseProducts.delete(id);
      }
      this.showToast(`${ids.length} produtos excluídos com sucesso.`);
    } catch (err) {
      console.error('Erro na exclusão em lote:', err);
      this.showToast('Erro ao excluir alguns produtos.', 'danger');
    }
  }

  activeSellerFallbackName: string = '';

  public async startChat(product: Product) {
    if (!product.sellerId) {
      console.error("Produto sem vendedor definido.");
      return; 
    }

    // Backup imediato do nome para evitar cabeçalho vazio durante o carregamento do Firestore
    this.activeSellerFallbackName = this.usersMap[product.sellerId] || 'Vendedor';

    try {
      const chatId = await this.chatService.startChat(
         { uid: product.sellerId, name: this.activeSellerFallbackName },
         { id: product.id!, name: product.name, photo: product['photoURL']?.[0] }
      );
      
      // Força o Angular a destruir o componente <app-chat-box> antigo e criar um novo
      // para evitar que o Angular ignore a mudança de @Input em ciclos assíncronos.
      this.activeChatId = ''; 
      setTimeout(() => {
        this.activeChatId = chatId;
        this.isChatOpen = true;
        this.saveChatState();
      });
      
    } catch (e) {
       console.error("Falha ao iniciar chat", e);
       this.showToast('Erro ao abrir chat. Tente novamente.', 'danger');
    }
  }

  public openProductDetail(product: Product) {
    this.selectedProduct = product;
  }

  public closeProductDetail() {
    this.selectedProduct = null;
  }

  public onDetailChatRequested() {
    if (this.selectedProduct) {
      const p = this.selectedProduct;
      this.closeProductDetail();
      this.startChat(p);
    }
  }

  public closeChat() {
    this.isChatOpen = false;
    this.activeChatId = '';
  }

  public getActiveSellerName(): string {
    if (!this.activeChatId) return '';
    
    // 1. Tenta buscar na lista de chats carregados (Sincronizado)
    const chat = this.activeChats.find(c => c.id === this.activeChatId);
    if (chat && chat.participants) {
      const user = this.chatService.getCurrentUser();
      const other = chat.participants.find(p => p.uid !== user?.uid);
      if (other && other.name) return other.name;
    }

    // 2. Fallback: Retorna o nome que capturamos ao clicar (Imediato)
    return this.activeSellerFallbackName;
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
}
