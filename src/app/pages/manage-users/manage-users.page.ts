import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { AppUser } from '../../interfaces/app-user';
import { AdminPanelHeroComponent } from '../../components/admin-panel-hero/admin-panel-hero.component';
import { FirebaseUsersService } from '../../services/firebase-users.service';

type UserStatusFilter = 'all' | 'online' | 'offline' | 'unknown';
type UserRoleFilter = 'all' | 'seller' | 'buyer';
type UserBanFilter = 'all' | 'banned' | 'unbanned';
type UserSort = 'recent-login' | 'recent-created' | 'name';
type MetricsPeriod = 'today' | '7d' | '30d' | 'custom';

interface UserOverview {
  total: number;
  online: number;
  sellers: number;
  banned: number;
  newInPeriod: number;
}

interface UserRiskBadge {
  label: string;
  tone: 'danger' | 'warning' | 'info';
}

@Component({
  selector: 'app-manage-users',
  templateUrl: './manage-users.page.html',
  styleUrls: ['./manage-users.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AdminPanelHeroComponent]
})
export class ManageUsersPage implements OnInit, OnDestroy {
  public allUsers: AppUser[] = [];
  public filteredUsers: AppUser[] = [];
  public selectedUser?: AppUser;
  public loading = true;
  public actionLoading = false;
  public errorMessage = '';
  public successMessage = '';
  public searchTerm = '';
  public statusFilter: UserStatusFilter = 'all';
  public roleFilter: UserRoleFilter = 'all';
  public banFilter: UserBanFilter = 'all';
  public sortBy: UserSort = 'recent-login';
  public readonly virtualPageSize = 60;
  public virtualLimit = 60;
  public selectedUserIds = new Set<string>();
  public period: MetricsPeriod = '7d';
  public customStart = this.toInputDate(this.addDays(new Date(), -6));
  public customEnd = this.toInputDate(new Date());
  public overview: UserOverview = {
    total: 0,
    online: 0,
    sellers: 0,
    banned: 0,
    newInPeriod: 0
  };

  public readonly periodOptions: Array<{ label: string; value: MetricsPeriod }> = [
    { label: 'Hoje', value: 'today' },
    { label: '7 dias', value: '7d' },
    { label: '30 dias', value: '30d' },
    { label: 'Personalizado', value: 'custom' }
  ];

  private usersSub?: Subscription;

  constructor(private firebaseUsersService: FirebaseUsersService) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  ngOnDestroy(): void {
    this.usersSub?.unsubscribe();
  }

  refresh(): void {
    this.loadUsers();
  }

  setPeriod(period: string): void {
    this.period = period as MetricsPeriod;
    this.recompute();
  }

  onCustomDateChange(): void {
    if (this.period === 'custom') {
      this.recompute();
    }
  }

  onFiltersChange(): void {
    this.recompute();
  }

  loadMoreUsers(): void {
    this.virtualLimit = Math.min(this.filteredUsers.length, this.virtualLimit + this.virtualPageSize);
  }

  get visibleUsers(): AppUser[] {
    return this.filteredUsers.slice(0, this.virtualLimit);
  }

  get hasMoreUsers(): boolean {
    return this.virtualLimit < this.filteredUsers.length;
  }

  get selectedCount(): number {
    return this.selectedUserIds.size;
  }

  selectUser(user: AppUser): void {
    this.selectedUser = user;
    this.successMessage = '';
    this.errorMessage = '';
  }

  async toggleChatBan(user: AppUser): Promise<void> {
    const uid = this.getUserId(user);
    if (!uid) return;
    this.actionLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      const next = !(user.isChatBanned === true);
      await this.firebaseUsersService.toggleUserChatBan(uid, next);
      this.successMessage = next
        ? `Usuário ${this.getUserName(user)} bloqueado no chat.`
        : `Usuário ${this.getUserName(user)} liberado no chat.`;
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.actionLoading = false;
    }
  }

  toggleUserSelection(user: AppUser, checked: boolean): void {
    const uid = this.getUserId(user);
    if (!uid) return;
    if (checked) {
      this.selectedUserIds.add(uid);
      return;
    }
    this.selectedUserIds.delete(uid);
  }

  isUserSelected(user: AppUser): boolean {
    return this.selectedUserIds.has(this.getUserId(user));
  }

  selectAllVisibleUsers(): void {
    for (const user of this.visibleUsers) {
      const uid = this.getUserId(user);
      if (uid) this.selectedUserIds.add(uid);
    }
  }

  clearSelectedUsers(): void {
    this.selectedUserIds = new Set<string>();
  }

  async bulkSetChatBan(isBanned: boolean): Promise<void> {
    const selected = this.filteredUsers.filter(user => this.selectedUserIds.has(this.getUserId(user)));
    if (!selected.length) return;
    this.actionLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await Promise.all(
        selected.map(user => this.firebaseUsersService.toggleUserChatBan(this.getUserId(user), isBanned))
      );
      this.successMessage = isBanned
        ? `${selected.length} usuário(s) bloqueados no chat em lote.`
        : `${selected.length} usuário(s) liberados no chat em lote.`;
      this.clearSelectedUsers();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.actionLoading = false;
    }
  }

  async toggleSeller(user: AppUser): Promise<void> {
    const uid = this.getUserId(user);
    if (!uid) return;
    this.actionLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      const next = !(user.isSeller === true);
      await this.firebaseUsersService.toggleUserSeller(uid, next);
      this.successMessage = next
        ? `${this.getUserName(user)} promovido para vendedor.`
        : `${this.getUserName(user)} alterado para comprador.`;
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.actionLoading = false;
    }
  }

  async removeUserDocument(user: AppUser): Promise<void> {
    const uid = this.getUserId(user);
    if (!uid) return;
    const ok = window.confirm(`Tem certeza que deseja remover o registro de ${this.getUserName(user)}?`);
    if (!ok) return;

    this.actionLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await this.firebaseUsersService.deleteUserDocument(uid);
      this.successMessage = `Registro de ${this.getUserName(user)} removido com sucesso.`;
      if (this.selectedUser && this.getUserId(this.selectedUser) === uid) {
        this.selectedUser = undefined;
      }
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.actionLoading = false;
    }
  }

  exportCsv(): void {
    const rows = this.filteredUsers.map(user => ({
      uid: this.getUserId(user),
      nome: this.getUserName(user),
      email: user.email || '',
      telefone: user.phoneNumber || '',
      status: this.getStatusLabel(user),
      perfil: user.isSeller ? 'vendedor' : 'comprador',
      chatBloqueado: user.isChatBanned ? 'sim' : 'nao',
      criadoEm: this.formatDateTime(user.createdAt),
      ultimoLogin: this.formatDateTime(user.lastLoginAt)
    }));

    const headers = ['uid', 'nome', 'email', 'telefone', 'status', 'perfil', 'chatBloqueado', 'criadoEm', 'ultimoLogin'];
    const csv = [
      headers.join(';'),
      ...rows.map(row => headers.map(header => this.escapeCsv(String((row as Record<string, string>)[header] || ''))).join(';'))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `usuarios-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  getUserName(user: AppUser): string {
    return user.displayName?.trim() || user.username?.trim() || user.email?.trim() || 'Usuário sem nome';
  }

  getUserInitial(user: AppUser): string {
    const name = this.getUserName(user).trim();
    return name ? name.charAt(0).toUpperCase() : '?';
  }

  getStatusLabel(user: AppUser): string {
    const status = String(user.status || '').toLowerCase();
    if (status === 'online') return 'Online';
    if (status === 'offline') return 'Offline';
    return 'Indefinido';
  }

  getStatusTone(user: AppUser): 'success' | 'neutral' {
    return String(user.status || '').toLowerCase() === 'online' ? 'success' : 'neutral';
  }

  getRiskBadges(user: AppUser): UserRiskBadge[] {
    const badges: UserRiskBadge[] = [];
    const lastLogin = this.toDate(user.lastLoginAt);
    const createdAt = this.toDate(user.createdAt);
    const now = Date.now();

    if (!lastLogin && createdAt && now - createdAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
      badges.push({ label: 'Nunca logou', tone: 'danger' });
    }

    if (lastLogin) {
      const diffDays = Math.floor((now - lastLogin.getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays >= 60) {
        badges.push({ label: `Sem login há ${diffDays}d`, tone: 'danger' });
      } else if (diffDays >= 30) {
        badges.push({ label: `Sem login há ${diffDays}d`, tone: 'warning' });
      }
    }

    if (!user.phoneNumber) {
      badges.push({ label: 'Sem telefone', tone: 'info' });
    }
    if (user.isChatBanned) {
      badges.push({ label: 'Chat bloqueado', tone: 'warning' });
    }

    return badges.slice(0, 3);
  }

  formatDateTime(value: unknown): string {
    const date = this.toDate(value);
    if (!date) return '—';
    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  trackByUser = (_: number, user: AppUser): string => this.getUserId(user);

  private loadUsers(): void {
    this.usersSub?.unsubscribe();
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.usersSub = this.firebaseUsersService.getAllUsers().subscribe({
      next: users => {
        this.allUsers = users;
        this.recompute();
        this.loading = false;
      },
      error: error => {
        this.loading = false;
        this.errorMessage = this.getErrorMessage(error);
      }
    });
  }

  private recompute(): void {
    const [start, end] = this.getPeriodRange();
    this.overview = {
      total: this.allUsers.length,
      online: this.allUsers.filter(user => String(user.status || '').toLowerCase() === 'online').length,
      sellers: this.allUsers.filter(user => user.isSeller === true).length,
      banned: this.allUsers.filter(user => user.isChatBanned === true).length,
      newInPeriod: this.allUsers.filter(user => {
        const created = this.toDate(user.createdAt);
        return created ? created >= start && created <= end : false;
      }).length
    };

    const term = this.searchTerm.trim().toLowerCase();
    this.filteredUsers = this.allUsers
      .filter(user => this.filterBySearch(user, term))
      .filter(user => this.filterByStatus(user))
      .filter(user => this.filterByRole(user))
      .filter(user => this.filterByBan(user))
      .sort((a, b) => this.compareUsers(a, b));
    this.virtualLimit = Math.min(this.filteredUsers.length, this.virtualPageSize);

    if (this.selectedUser) {
      const selectedId = this.getUserId(this.selectedUser);
      this.selectedUser = this.filteredUsers.find(user => this.getUserId(user) === selectedId) || this.selectedUser;
    }

    const filteredIds = new Set(this.filteredUsers.map(user => this.getUserId(user)));
    this.selectedUserIds = new Set(Array.from(this.selectedUserIds).filter(id => filteredIds.has(id)));
  }

  private filterBySearch(user: AppUser, term: string): boolean {
    if (!term) return true;
    const haystack = [
      this.getUserName(user),
      user.email || '',
      user.phoneNumber || '',
      this.getUserId(user)
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  }

  private filterByStatus(user: AppUser): boolean {
    if (this.statusFilter === 'all') return true;
    const status = String(user.status || '').toLowerCase();
    if (this.statusFilter === 'unknown') return !status || (status !== 'online' && status !== 'offline');
    return status === this.statusFilter;
  }

  private filterByRole(user: AppUser): boolean {
    if (this.roleFilter === 'all') return true;
    return this.roleFilter === 'seller' ? user.isSeller === true : user.isSeller !== true;
  }

  private filterByBan(user: AppUser): boolean {
    if (this.banFilter === 'all') return true;
    return this.banFilter === 'banned' ? user.isChatBanned === true : user.isChatBanned !== true;
  }

  private compareUsers(a: AppUser, b: AppUser): number {
    if (this.sortBy === 'name') {
      return this.getUserName(a).localeCompare(this.getUserName(b), 'pt-BR');
    }

    const aDate = this.toDate(this.sortBy === 'recent-login' ? a.lastLoginAt : a.createdAt);
    const bDate = this.toDate(this.sortBy === 'recent-login' ? b.lastLoginAt : b.createdAt);
    const aTime = aDate?.getTime() || 0;
    const bTime = bDate?.getTime() || 0;
    return bTime - aTime;
  }

  private getUserId(user: AppUser): string {
    return user.uid || (user as unknown as { id?: string }).id || '';
  }

  private getPeriodRange(): [Date, Date] {
    const now = new Date();
    const end = new Date(now);
    let start = new Date(now);
    if (this.period === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (this.period === '7d') {
      start = this.addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -6);
    } else if (this.period === '30d') {
      start = this.addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -29);
    } else {
      const customStart = this.toDate(this.customStart);
      const customEnd = this.toDate(this.customEnd);
      if (customStart) start = customStart;
      if (customEnd) {
        end.setTime(customEnd.getTime());
        end.setHours(23, 59, 59, 999);
      }
    }
    return [start, end];
  }

  private toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'object' && value) {
      const rec = value as Record<string, unknown>;
      const seconds = rec['seconds'];
      const nanoseconds = rec['nanoseconds'];
      if (typeof seconds === 'number') {
        const ms = seconds * 1000 + (typeof nanoseconds === 'number' ? Math.floor(nanoseconds / 1e6) : 0);
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      const toDateFn = rec['toDate'];
      if (typeof toDateFn === 'function') {
        const maybeDate = (toDateFn as () => Date)();
        return maybeDate instanceof Date && !Number.isNaN(maybeDate.getTime()) ? maybeDate : null;
      }
    }
    return null;
  }

  private addDays(base: Date, days: number): Date {
    const date = new Date(base);
    date.setDate(date.getDate() + days);
    return date;
  }

  private toInputDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private escapeCsv(value: string): string {
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Falha ao carregar dados de usuários.';
  }
}

