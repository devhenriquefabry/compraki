import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlertController, IonSpinner, ToastController } from '@ionic/angular/standalone';
import { Subscription, combineLatest } from 'rxjs';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { FirebaseUsersService } from '../../services/firebase-users.service';
import { ChatMessage, ChatReport, ChatRoom } from '../../interfaces/chat';
import { AppUser } from '../../interfaces/app-user';
import { ChatBoxComponent } from '../../components/chat-box/chat-box.component';
import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { chatSellerId, initialsOf, listTime, toMillis } from '../../core/chat-view';

type Status = 'all' | 'reported' | 'restricted' | 'closed' | 'mine';
type Kind = 'all' | 'product' | 'direct';
type Period = 'all' | '1' | '7' | '30';

interface Person {
  uid: string;
  name: string;
  email: string;
  photo: string;
  initials: string;
  role: 'Loja' | 'Cliente' | 'Participante';
  isStore: boolean;
  banned: boolean;
  user?: AppUser;
}

interface Row {
  id: string;
  chat: ChatRoom;
  seller?: Person;
  buyer?: Person;
  people: Person[];
  product?: string;
  productPhoto?: string;
  preview: string;
  lastFrom: string;
  time: string;
  lastMs: number;
  createdMs: number;
  pending: number;
  restricted: boolean;
  closed: boolean;
  mine: boolean;
  haystack: string;
}

const REASON: Record<string, string> = {
  spam: 'Spam ou mensagens repetidas',
  abuse: 'Ofensa ou comportamento inadequado',
  scam: 'Tentativa de golpe',
  other: 'Outro motivo',
};

const DAY_MS = 86_400_000;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Conversas (admin): moderação das conversas entre compradores e lojas.
 *
 * Mesma casca do Atendimento: fila à esquerda (busca, situação, tipo,
 * período) e, à direita, o dossiê da conversa — quem são os dois lados, as
 * denúncias com resolver/ignorar, a atividade dos últimos 14 dias e a
 * conversa em si, com a loja à direita e o cliente à esquerda. Abaixo de
 * 992px, uma coisa de cada vez.
 */
@Component({
  selector: 'app-manage-chats',
  templateUrl: './manage-chats.page.html',
  styleUrls: ['./manage-chats.page.scss'],
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, IonSpinner, ChatBoxComponent, VnIconComponent]
})
export class ManageChatsPage implements OnInit, OnDestroy {
  private readonly chatService = inject(FirebaseChatService);
  private readonly userService = inject(FirebaseUsersService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @ViewChild(ChatBoxComponent) chatBox?: ChatBoxComponent;

  readonly reasonLabel = REASON;

  readonly chats = signal<ChatRoom[]>([]);
  readonly reports = signal<ChatReport[]>([]);
  readonly users = signal<AppUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly totalMessages = signal<number | null>(null);
  readonly me = signal('');

  readonly search = signal('');
  readonly status = signal<Status>('all');
  readonly kind = signal<Kind>('all');
  readonly period = signal<Period>('all');

  readonly selectedId = signal<string | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly selecting = signal(false);
  readonly picked = signal<Set<string>>(new Set());
  readonly busy = signal('');

  readonly newChatOpen = signal(false);
  readonly userSearch = signal('');

  private readonly tick = signal(Date.now());
  private tickTimer?: ReturnType<typeof setInterval>;
  private subs = new Subscription();
  private msgSub?: Subscription;

  private readonly usersById = computed(() => new Map(this.users().map(u => [u.uid, u])));

  readonly rows = computed<Row[]>(() => {
    const users = this.usersById();
    const pendingByChat = new Map<string, number>();
    for (const r of this.reports()) {
      if (r.status === 'pending') pendingByChat.set(r.chatId, (pendingByChat.get(r.chatId) || 0) + 1);
    }
    const me = this.me();
    const now = this.tick();

    return this.chats().filter(c => c.id).map(c => {
      const sellerUid = c.productId || c.sellerId ? chatSellerId(c) : c.sellerId;
      const people: Person[] = (c.participantIds || []).map(uid => {
        const stored = c.participants?.find(p => p.uid === uid);
        const u = users.get(uid);
        const isStore = uid === sellerUid;
        const base = (isStore ? u?.shopName : null) || u?.displayName || (stored?.name !== 'Você' ? stored?.name : '') || u?.email || 'Conta sem nome';
        return {
          uid,
          name: base,
          email: u?.email || '',
          photo: u?.photoURL || stored?.photoUrl || '',
          initials: initialsOf(base),
          role: sellerUid ? (isStore ? 'Loja' : 'Cliente') : 'Participante',
          isStore,
          banned: !!u?.isChatBanned,
          user: u,
        } as Person;
      });
      // Loja sempre por último: "Cliente → Loja" na fila.
      people.sort((a, b) => Number(a.isStore) - Number(b.isStore));
      const seller = people.find(p => p.isStore);
      const buyer = people.find(p => !p.isStore);
      const lastFrom = c.lastSenderId ? people.find(p => p.uid === c.lastSenderId)?.name.split(' ')[0] || '' : '';
      const started = !!c.lastSenderId || (!!c.lastMessage && c.lastMessage !== 'Chat iniciado. Mande um oi!');
      return {
        id: c.id!,
        chat: c,
        seller, buyer, people,
        product: c.productName,
        productPhoto: c.productPhoto,
        preview: started ? c.lastMessage || '' : 'Conversa aberta, sem mensagens.',
        lastFrom,
        time: listTime(c.lastMessageAt, now),
        lastMs: toMillis(c.lastMessageAt) ?? 0,
        createdMs: toMillis(c.createdAt) ?? 0,
        pending: pendingByChat.get(c.id!) || 0,
        restricted: people.some(p => p.banned),
        closed: c.status === 'closed',
        mine: !!me && (c.participantIds || []).includes(me),
        haystack: fold(`${people.map(p => p.name + ' ' + p.email).join(' ')} ${c.productName || ''} ${c.lastMessage || ''} ${c.id}`),
      };
    }).sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0) || b.lastMs - a.lastMs);
  });

  readonly counts = computed(() => {
    const rows = this.rows();
    return {
      all: rows.length,
      reported: rows.filter(r => r.pending > 0).length,
      restricted: rows.filter(r => r.restricted).length,
      closed: rows.filter(r => r.closed).length,
      mine: rows.filter(r => r.mine).length,
      product: rows.filter(r => !!r.chat.productId).length,
    };
  });

  readonly stats = computed(() => {
    const now = this.tick();
    const rows = this.rows();
    return {
      active24h: rows.filter(r => now - r.lastMs < DAY_MS).length,
      pendingReports: this.reports().filter(r => r.status === 'pending').length,
      restrictedUsers: this.users().filter(u => u.isChatBanned).length,
    };
  });

  readonly list = computed(() => {
    const q = fold(this.search().trim());
    const st = this.status();
    const kind = this.kind();
    const days = this.period() === 'all' ? 0 : Number(this.period());
    const since = days ? this.tick() - days * DAY_MS : 0;
    return this.rows().filter(r =>
      (st === 'all' || (st === 'reported' && r.pending > 0) || (st === 'restricted' && r.restricted)
        || (st === 'closed' && r.closed) || (st === 'mine' && r.mine))
      && (kind === 'all' || (kind === 'product') === !!r.chat.productId)
      && (!since || r.lastMs >= since)
      && (!q || r.haystack.includes(q))
    );
  });

  readonly selected = computed(() => this.rows().find(r => r.id === this.selectedId()) ?? null);

  readonly selectedReports = computed(() => {
    const id = this.selectedId();
    return this.reports()
      .filter(r => r.chatId === id)
      .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0));
  });

  /** Mensagens por dia nos últimos 14 dias da conversa aberta. */
  readonly activity = computed(() => {
    const msgs = this.messages();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today.getTime() - (13 - i) * DAY_MS);
      return { key: d.toDateString(), date: d, count: 0, firstId: '' as string };
    });
    const byKey = new Map(days.map(d => [d.key, d]));
    for (const m of msgs) {
      const ms = toMillis(m.createdAt);
      if (ms == null) continue;
      const day = byKey.get(new Date(ms).toDateString());
      if (!day) continue;
      day.count++;
      if (!day.firstId) day.firstId = m.id || m.clientId || '';
    }
    const max = Math.max(1, ...days.map(d => d.count));
    return days.map(d => ({ ...d, pct: d.count ? Math.max(14, Math.round(d.count / max * 100)) : 0 }));
  });

  readonly mediaCount = computed(() => this.messages().filter(m => m.type !== 'text').length);

  readonly pickableUsers = computed(() => {
    const q = fold(this.userSearch().trim());
    return this.users()
      .filter(u => u.uid !== this.me())
      .filter(u => !q || fold(`${u.displayName || ''} ${u.shopName || ''} ${u.email || ''}`).includes(q))
      .slice(0, 60);
  });

  ngOnInit() {
    this.me.set(this.chatService.getCurrentUser()?.uid || '');
    this.tickTimer = setInterval(() => this.tick.set(Date.now()), 60_000);
    this.load();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    this.msgSub?.unsubscribe();
    clearInterval(this.tickTimer);
  }

  load() {
    this.subs.unsubscribe();
    this.subs = new Subscription();
    this.loading.set(true);
    this.error.set('');
    this.subs.add(
      combineLatest([this.chatService.getAllChatsAdmin(), this.chatService.getReports(), this.userService.getAllUsers()]).subscribe({
        next: ([chats, reports, users]) => {
          this.chats.set(chats);
          this.reports.set(reports);
          this.users.set(users);
          this.loading.set(false);
        },
        error: err => {
          console.error('Conversas do admin não carregaram', err);
          this.error.set('Não deu para carregar as conversas agora.');
          this.loading.set(false);
        }
      })
    );
    this.chatService.getTotalMessagesCount().then(n => this.totalMessages.set(n)).catch(() => this.totalMessages.set(null));
  }

  open(row: Row) {
    if (this.selecting()) {
      this.togglePick(row.id);
      return;
    }
    if (this.selectedId() === row.id) return;
    this.selectedId.set(row.id);
    // No celular o dossiê troca de lugar com a fila: começa do topo.
    if (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 991px)').matches) {
      // No celular quem rola é a própria aba (o host); no desktop, o <main>.
      setTimeout(() => {
        const host = this.host.nativeElement;
        host.scrollTop = 0;
        const main = host.closest('.adm-content') as HTMLElement | null;
        if (main) main.scrollTop = 0;
      });
    }
    this.messages.set([]);
    this.msgSub?.unsubscribe();
    this.msgSub = this.chatService.getMessages(row.id).subscribe({
      next: msgs => this.messages.set(msgs),
      error: e => console.warn('Mensagens da conversa não carregaram', e)
    });
  }

  back() {
    this.selectedId.set(null);
    this.msgSub?.unsubscribe();
  }

  jumpToDay(firstId: string) {
    if (firstId) this.chatBox?.scrollToMessage(firstId);
  }

  // ------------------------------------------------------------- seleção

  toggleSelecting() {
    this.selecting.update(v => !v);
    this.picked.set(new Set());
  }

  togglePick(id: string) {
    this.picked.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  pickAllVisible() {
    const visible = this.list().map(r => r.id);
    const all = visible.every(id => this.picked().has(id));
    this.picked.set(all ? new Set() : new Set(visible));
  }

  async deletePicked() {
    const ids = [...this.picked()];
    if (!ids.length) return;
    await this.confirmDelete(ids);
  }

  async deleteOne(row: Row) {
    await this.confirmDelete([row.id]);
  }

  private async confirmDelete(ids: string[]) {
    const n = ids.length;
    const alert = await this.alertCtrl.create({
      header: n === 1 ? 'Excluir esta conversa?' : `Excluir ${n} conversas?`,
      message: 'Some da lista dos dois lados e não dá para desfazer. Para tirar do ar sem apagar o histórico, use Encerrar.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: n === 1 ? 'Excluir conversa' : `Excluir ${n} conversas`, role: 'destructive', handler: () => { void this.performDelete(ids); } }
      ]
    });
    await alert.present();
  }

  private async performDelete(ids: string[]) {
    try {
      await this.chatService.deleteChatsBulk(ids);
      if (this.selectedId() && ids.includes(this.selectedId()!)) this.back();
      this.picked.set(new Set());
      this.selecting.set(false);
      void this.toast(ids.length === 1 ? 'Conversa excluída.' : `${ids.length} conversas excluídas.`);
    } catch (e) {
      console.error('Exclusão de conversas falhou', e);
      void this.toast('Não deu para excluir. Tente de novo.', 'danger');
    }
  }

  // ------------------------------------------------------------ moderação

  async toggleBan(person: Person) {
    const banned = person.banned;
    const alert = await this.alertCtrl.create({
      header: banned ? `Liberar ${person.name}?` : `Restringir ${person.name} no chat?`,
      message: banned
        ? 'A conta volta a abrir conversas e mandar mensagens.'
        : 'A conta não abre conversas nem manda mensagens. Comprar e vender continua normal.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: banned ? 'Liberar' : 'Restringir',
          role: banned ? undefined : 'destructive',
          handler: () => { void this.applyBan(person, !banned); }
        }
      ]
    });
    await alert.present();
  }

  private async applyBan(person: Person, ban: boolean) {
    this.busy.set(person.uid);
    try {
      await this.chatService.toggleUserChatBan(person.uid, ban);
      void this.toast(ban ? `${person.name} está restrito no chat.` : `${person.name} foi liberado.`);
    } catch (e) {
      console.error('Restrição falhou', e);
      void this.toast('Não deu para mudar a restrição.', 'danger');
    } finally {
      this.busy.set('');
    }
  }

  async setReport(report: ChatReport, status: 'resolved' | 'ignored' | 'pending') {
    if (!report.id) return;
    this.busy.set(report.id);
    try {
      await this.chatService.setReportStatus(report.id, status);
      const label = status === 'resolved' ? 'Denúncia resolvida.' : status === 'ignored' ? 'Denúncia ignorada.' : 'Denúncia reaberta.';
      void this.toast(label);
    } catch (e) {
      console.error('Denúncia não atualizou', e);
      void this.toast('Não deu para atualizar a denúncia.', 'danger');
    } finally {
      this.busy.set('');
    }
  }

  async closeConversation(row: Row) {
    const alert = await this.alertCtrl.create({
      header: 'Encerrar esta conversa?',
      message: 'Ninguém mais manda mensagens nela. O histórico continua disponível para os dois lados e para a Vineon.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Encerrar conversa', role: 'destructive', handler: () => {
            this.chatService.closeChat(row.id)
              .then(() => this.toast('Conversa encerrada.'))
              .catch(() => this.toast('Não deu para encerrar.', 'danger'));
          }
        }
      ]
    });
    await alert.present();
  }

  personFor(uid: string): Person | undefined {
    return this.selected()?.people.find(p => p.uid === uid);
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      void this.toast('Copiado.');
    } catch {
      void this.toast(text);
    }
  }

  // ------------------------------------------------------- nova conversa

  openNewChat() {
    this.userSearch.set('');
    this.newChatOpen.set(true);
  }

  async startChatWith(user: AppUser) {
    this.newChatOpen.set(false);
    try {
      const chatId = await this.chatService.startChat({
        uid: user.uid,
        name: user.shopName || user.displayName || 'Usuário',
        photoUrl: user.photoURL || undefined
      }, undefined, false);
      this.status.set('all');
      this.search.set('');
      // A fila só mostra a conversa quando o snapshot chega.
      const wait = (tries: number) => {
        const row = this.rows().find(r => r.id === chatId);
        if (row) this.open(row);
        else if (tries > 0) setTimeout(() => wait(tries - 1), 250);
      };
      wait(12);
    } catch (e: any) {
      console.error('Nova conversa falhou', e);
      void this.toast(e?.message || 'Não deu para abrir a conversa.', 'danger');
    }
  }

  private async toast(message: string, color: 'dark' | 'danger' = 'dark') {
    const t = await this.toastCtrl.create({ message, duration: 2500, color, position: 'bottom' });
    await t.present();
  }
}
