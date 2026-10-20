import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NavController } from '@ionic/angular/standalone';
import { IonContent, IonHeader } from '@ionic/angular/standalone';
import { Subscription } from 'rxjs';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { SellerDirectoryService } from '../../services/seller-directory.service';
import { ChatRoom } from '../../interfaces/chat';
import { ChatBoxComponent } from '../../components/chat-box/chat-box.component';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { LayoutService } from '../../core/layout.service';
import {
  chatSellerId, displayOf, initialsOf, isVisibleTo, listTime, otherParticipantOf, unreadOf
} from '../../core/chat-view';

type Filter = 'all' | 'unread' | 'buying' | 'selling';

interface InboxItem {
  id: string;
  name: string;
  photo: string;
  initials: string;
  isStore: boolean;
  selling: boolean;
  product?: string;
  productPhoto?: string;
  preview: string;
  fromMe: boolean;
  started: boolean;
  time: string;
  unread: number;
  closed: boolean;
  haystack: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Mensagens: as conversas da conta com lojas (o que ela compra) e com
 * clientes (o que ela vende).
 *
 * No celular é a lista; tocar abre /chat-details/:id em tela cheia. No
 * desktop são dois painéis — lista à esquerda, conversa à direita, com a
 * conversa aberta em `?c=<id>` para o link e o voltar do navegador.
 */
@Component({
  selector: 'app-chats',
  templateUrl: './chats.page.html',
  styleUrls: ['./chats.page.scss'],
  standalone: true,
  imports: [IonContent, IonHeader, RouterLink, ChatBoxComponent, VnIconComponent]
})
export class ChatsPage implements OnInit, OnDestroy {
  private readonly chatService = inject(FirebaseChatService);
  private readonly directory = inject(SellerDirectoryService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly navCtrl = inject(NavController);
  readonly layout = inject(LayoutService);

  readonly chats = signal<ChatRoom[] | null>(null);
  readonly failed = signal(false);
  readonly uid = signal<string | undefined>(undefined);
  readonly filter = signal<Filter>('all');
  readonly search = signal('');
  readonly activeId = signal<string | null>(null);

  private sub?: Subscription;
  private qpSub?: Subscription;
  /** Atualiza "Ontem", "seg" etc. sem esperar mensagem nova. */
  private readonly tick = signal(Date.now());
  private tickTimer?: ReturnType<typeof setInterval>;

  readonly items = computed<InboxItem[]>(() => {
    const me = this.uid();
    const profiles = this.directory.profiles();
    const now = this.tick();
    return (this.chats() ?? [])
      .filter(c => c.id && isVisibleTo(c, me))
      .map(c => {
        const other = otherParticipantOf(c, me);
        const d = displayOf(c, other, other ? profiles[other.uid] : null);
        const fromMe = !!me && c.lastSenderId === me;
        const started = !!c.lastSenderId || (!!c.lastMessage && c.lastMessage !== 'Chat iniciado. Mande um oi!');
        return {
          id: c.id!,
          name: d.name,
          photo: d.photo,
          initials: initialsOf(d.name),
          isStore: d.isStore,
          selling: !!me && chatSellerId(c) === me,
          product: c.productName,
          productPhoto: c.productPhoto,
          preview: started ? c.lastMessage || '' : 'Conversa aberta. Mande a primeira mensagem.',
          fromMe,
          started,
          time: listTime(c.lastMessageAt, now),
          unread: unreadOf(c, me),
          closed: c.status === 'closed',
          haystack: fold(`${d.name} ${c.productName || ''} ${c.lastMessage || ''}`)
        };
      });
  });

  readonly hasSelling = computed(() => this.items().some(i => i.selling));
  readonly totalUnread = computed(() => this.items().reduce((sum, i) => sum + i.unread, 0));
  readonly counts = computed(() => {
    const all = this.items();
    return {
      unread: all.filter(i => i.unread > 0).length,
      buying: all.filter(i => !i.selling).length,
      selling: all.filter(i => i.selling).length
    };
  });

  readonly visible = computed(() => {
    const q = fold(this.search().trim());
    const f = this.filter();
    return this.items().filter(i =>
      (f === 'all' || (f === 'unread' && i.unread > 0) || (f === 'buying' && !i.selling) || (f === 'selling' && i.selling))
      && (!q || i.haystack.includes(q))
    );
  });

  readonly summary = computed(() => {
    const n = this.totalUnread();
    if (this.chats() === null) return '';
    if (!this.items().length) return 'Nenhuma conversa ainda';
    return n === 0 ? 'Tudo lido' : n === 1 ? '1 mensagem nova' : `${n} mensagens novas`;
  });

  constructor() {
    // Nome e foto vêm do perfil público de cada conta (o gravado na conversa
    // pode estar velho ou ser o "Você" das conversas antigas).
    effect(() => {
      const me = this.uid();
      const ids = (this.chats() ?? []).map(c => otherParticipantOf(c, me)?.uid).filter((x): x is string => !!x);
      if (ids.length) void this.directory.ensure(ids);
    });

    // Voltou para o celular com uma conversa aberta no painel: abre a tela dela.
    effect(() => {
      const id = this.activeId();
      if (id && !this.layout.isDesktop()) {
        this.activeId.set(null);
        void this.router.navigate(['/chat-details', id]);
      }
    });
  }

  async ngOnInit() {
    this.qpSub = this.route.queryParamMap.subscribe(p => {
      const c = p.get('c');
      if (this.layout.isDesktop()) this.activeId.set(c);
    });
    this.tickTimer = setInterval(() => this.tick.set(Date.now()), 60_000);

    const user = await this.chatService.waitForUser();
    this.uid.set(user?.uid);
    this.sub = this.chatService.getMyChats().subscribe({
      next: chats => {
        this.chats.set(chats);
        this.failed.set(false);
      },
      error: e => {
        console.error('Erro ao puxar chats', e);
        this.failed.set(true);
        this.chats.set([]);
      }
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.qpSub?.unsubscribe();
    clearInterval(this.tickTimer);
  }

  open(item: InboxItem) {
    if (this.layout.isDesktop()) {
      this.activeId.set(item.id);
      void this.router.navigate([], { relativeTo: this.route, queryParams: { c: item.id }, replaceUrl: true });
    } else {
      void this.router.navigate(['/chat-details', item.id]);
    }
  }

  closePane() {
    this.activeId.set(null);
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  setFilter(f: Filter) {
    this.filter.set(this.filter() === f && f !== 'all' ? 'all' : f);
  }

  onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }
}
