import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Subscription, Observable } from 'rxjs';
import { Banner, BannerDailySchedule } from '../../interfaces/banner';
import { BannerService } from '../../services/banner.service';
import { AdminSubtabsComponent, AdminSubtabOption } from '../../components/admin-subtabs/admin-subtabs.component';
import { AdminPanelHeroComponent } from '../../components/admin-panel-hero/admin-panel-hero.component';

interface CalendarDay {
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  scheduledBanners?: Banner[];
}

interface DayPlannerItem {
  banner: Banner;
  enabled: boolean;
  startTime: string;
  endTime: string;
  order: number;
}

@Component({
  selector: 'app-manage-banners',
  templateUrl: './manage-banners.page.html',
  styleUrls: ['./manage-banners.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, DatePipe, AdminSubtabsComponent, AdminPanelHeroComponent]
})
export class ManageBannersPage implements OnInit, OnDestroy {

  public banners$!: Observable<Banner[]>;
  public showSpecs = true;

  // Modal State
  public isFormOpen = false;
  public isSaving = false;
  public editingBanner: Banner | null = null;
  public previewImageUrl: string = '';
  private selectedFile: File | null = null;
  public activeSubTab: 'list' | 'calendar' = 'list';
  public readonly subtabOptions: AdminSubtabOption[] = [
    { value: 'list', label: 'Banners', icon: 'images-outline' },
    { value: 'calendar', label: 'Calendário', icon: 'calendar-outline' }
  ];
  public isDayPlannerOpen = false;
  public isSavingDayPlan = false;
  public selectedPlannerDateKey = '';
  public plannerItems: DayPlannerItem[] = [];
  public calendarViewDate = new Date();
  public calendarDays: CalendarDay[] = [];
  public calendarWeekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  private monthNames = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro'
  ];

  // Form Model
  public form: Partial<Banner> = this.getEmptyForm();
  public weekDays = [
    { value: 0, label: 'Dom', full: 'Domingo' },
    { value: 1, label: 'Seg', full: 'Segunda' },
    { value: 2, label: 'Ter', full: 'Terça' },
    { value: 3, label: 'Qua', full: 'Quarta' },
    { value: 4, label: 'Qui', full: 'Quinta' },
    { value: 5, label: 'Sex', full: 'Sexta' },
    { value: 6, label: 'Sáb', full: 'Sábado' }
  ];

  constructor(private bannerService: BannerService) {}

  setActiveSubTab(tab: string) {
    if (tab === 'list' || tab === 'calendar') {
      this.activeSubTab = tab;
    }
  }

  ngOnInit() {
    this.banners$ = this.bannerService.getAll();
    this.updateCalendarDays();
  }

  ngOnDestroy() {}

  private getEmptyForm(): Partial<Banner> {
    return {
      title: '',
      subtitle: '',
      buttonText: '',
      buttonLink: '',
      imageURL: '',
      backgroundColor: '#4a9c2b',
      textColor: '#ffffff',
      status: 'active',
      scheduledStart: '',
      scheduledEnd: '',
      scheduledDays: [],
      scheduledDates: [],
      order: 1
    };
  }

  openForm(banner?: Banner) {
    this.editingBanner = banner || null;
    if (banner) {
      this.form = { ...banner };
      this.previewImageUrl = banner.imageURL || '';
      this.calendarViewDate = this.getInitialCalendarDate(banner);
    } else {
      this.form = this.getEmptyForm();
      this.previewImageUrl = '';
      this.calendarViewDate = new Date();
    }
    this.updateCalendarDays();
    this.selectedFile = null;
    this.isFormOpen = true;
  }

  closeForm() {
    this.isFormOpen = false;
    this.editingBanner = null;
    this.form = this.getEmptyForm();
    this.previewImageUrl = '';
    this.selectedFile = null;
  }

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('O arquivo deve ter no máximo 2MB!');
      return;
    }

    this.selectedFile = file;

    // Gera prévia local imediata
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.previewImageUrl = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async saveBanner() {
    if (!this.form.title?.trim()) {
      alert('O título do banner é obrigatório!');
      return;
    }

    this.isSaving = true;
    try {
      let imageURL = this.form.imageURL || '';

      // Se houver um arquivo novo, faz upload primeiro
      if (this.selectedFile) {
        imageURL = await this.bannerService.uploadBannerImage(this.selectedFile);
      }

      const payload: Omit<Banner, 'id'> = {
        title: this.form.title || '',
        subtitle: this.form.subtitle || '',
        buttonText: this.form.buttonText || '',
        buttonLink: this.form.buttonLink || '',
        imageURL,
        backgroundColor: this.form.backgroundColor || '#4a9c2b',
        textColor: this.form.textColor || '#ffffff',
        status: this.form.status || 'active',
        scheduledStart: this.form.scheduledStart || '',
        scheduledEnd: this.form.scheduledEnd || '',
        scheduledDays: this.form.scheduledDays || [],
        scheduledDates: this.getSortedScheduledDates(),
        dailySchedules: this.form.dailySchedules || {},
        order: Number(this.form.order) || 1,
      };

      if (this.editingBanner?.id) {
        await this.bannerService.update(this.editingBanner.id, payload);
      } else {
        await this.bannerService.create(payload);
      }

      this.closeForm();
    } catch (e) {
      console.error('Erro ao salvar banner:', e);
      alert('Erro ao salvar o banner. Verifique o console.');
    } finally {
      this.isSaving = false;
    }
  }

  async toggleStatus(banner: Banner) {
    if (!banner.id) return;
    const newStatus = banner.status === 'active' ? 'inactive' : 'active';
    await this.bannerService.update(banner.id, { status: newStatus });
  }

  async deleteBanner(banner: Banner) {
    if (!banner.id) return;
    const confirmed = confirm(`Deseja remover o banner "${banner.title}"?`);
    if (!confirmed) return;
    await this.bannerService.delete(banner.id);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Ativo',
      inactive: 'Inativo',
      scheduled: 'Agendado'
    };
    return labels[status] || status;
  }

  getStatusIcon(status: string): string {
    const icons: Record<string, string> = {
      active: 'checkmark-circle-outline',
      inactive: 'close-circle-outline',
      scheduled: 'calendar-outline'
    };
    return icons[status] || 'help-outline';
  }

  isDaySelected(day: number): boolean {
    return this.form.scheduledDays?.includes(day) || false;
  }

  toggleDay(day: number) {
    if (!this.form.scheduledDays) this.form.scheduledDays = [];
    
    const index = this.form.scheduledDays.indexOf(day);
    if (index > -1) {
      this.form.scheduledDays.splice(index, 1);
    } else {
      this.form.scheduledDays.push(day);
    }
  }

  getScheduledDaysLabel(banner: Banner): string {
    if (!banner.scheduledDays || banner.scheduledDays.length === 0) return '';
    if (banner.scheduledDays.length === 7) return 'Todos os dias';
    
    return banner.scheduledDays
      .sort((a, b) => a - b)
      .map(d => this.weekDays.find(wd => wd.value === d)?.label)
      .join(', ');
  }

  get calendarMonthLabel(): string {
    return `${this.monthNames[this.calendarViewDate.getMonth()]} ${this.calendarViewDate.getFullYear()}`;
  }

  get selectedDatesCount(): number {
    return this.form.scheduledDates?.length || 0;
  }

  getSelectedDatesLabel(banner: Banner): string {
    if (!banner.scheduledDates || banner.scheduledDates.length === 0) return '';

    return [...banner.scheduledDates]
      .sort()
      .map(dateKey => this.formatDateKeyForDisplay(dateKey))
      .join(', ');
  }

  getScheduledCalendarDays(banners: Banner[]): CalendarDay[] {
    return this.calendarDays.map(day => ({
      ...day,
      scheduledBanners: this.getScheduledBannersForDate(banners, day.dateKey)
    }));
  }

  getScheduledBannersForDate(banners: Banner[], dateKey: string): Banner[] {
    return banners
      .filter(banner => this.isBannerScheduledForDate(banner, dateKey))
      .sort((a, b) => this.getBannerOrderForDate(a, dateKey) - this.getBannerOrderForDate(b, dateKey));
  }

  get selectedPlannerDateLabel(): string {
    if (!this.selectedPlannerDateKey) return '';
    const date = this.parseDateKey(this.selectedPlannerDateKey);
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long'
    }).format(date);
  }

  isPastCalendarDay(day: CalendarDay): boolean {
    return day.dateKey < this.toDateKey(new Date());
  }

  openDayPlanner(day: CalendarDay, banners: Banner[]) {
    if (this.isPastCalendarDay(day)) return;

    this.selectedPlannerDateKey = day.dateKey;
    this.plannerItems = banners
      .map((banner, index) => {
        const schedule = this.getBannerScheduleForDate(banner, day.dateKey);
        const enabled = this.isBannerScheduledForDate(banner, day.dateKey);

        return {
          banner,
          enabled,
          startTime: schedule?.startTime || '',
          endTime: schedule?.endTime || '',
          order: Number(schedule?.order || banner.order || index + 1)
        };
      })
      .sort((a, b) => Number(b.enabled) === Number(a.enabled)
        ? a.order - b.order
        : Number(b.enabled) - Number(a.enabled));

    this.isDayPlannerOpen = true;
  }

  closeDayPlanner() {
    this.isDayPlannerOpen = false;
    this.selectedPlannerDateKey = '';
    this.plannerItems = [];
  }

  async saveDayPlan() {
    if (!this.selectedPlannerDateKey) return;

    this.isSavingDayPlan = true;
    try {
      const updates = this.plannerItems
        .filter(item => item.banner.id)
        .map(item => {
          const scheduledDates = new Set(item.banner.scheduledDates || []);
          const dailySchedules = { ...(item.banner.dailySchedules || {}) };

          if (item.enabled) {
            scheduledDates.add(this.selectedPlannerDateKey);
            dailySchedules[this.selectedPlannerDateKey] = {
              startTime: item.startTime || '',
              endTime: item.endTime || '',
              order: Number(item.order) || 1
            };
          } else {
            scheduledDates.delete(this.selectedPlannerDateKey);
            delete dailySchedules[this.selectedPlannerDateKey];
          }

          return this.bannerService.update(item.banner.id as string, {
            status: item.enabled ? 'scheduled' : item.banner.status,
            scheduledDates: Array.from(scheduledDates).sort(),
            dailySchedules
          });
        });

      await Promise.all(updates);
      this.closeDayPlanner();
    } catch (e) {
      console.error('Erro ao salvar planejamento do dia:', e);
      alert('Erro ao salvar o planejamento do dia. Verifique o console.');
    } finally {
      this.isSavingDayPlan = false;
    }
  }

  previousMonth() {
    this.calendarViewDate = new Date(
      this.calendarViewDate.getFullYear(),
      this.calendarViewDate.getMonth() - 1,
      1
    );
    this.updateCalendarDays();
  }

  nextMonth() {
    this.calendarViewDate = new Date(
      this.calendarViewDate.getFullYear(),
      this.calendarViewDate.getMonth() + 1,
      1
    );
    this.updateCalendarDays();
  }

  toggleCalendarDate(day: CalendarDay) {
    if (!this.form.scheduledDates) this.form.scheduledDates = [];

    const index = this.form.scheduledDates.indexOf(day.dateKey);
    if (index > -1) {
      this.form.scheduledDates.splice(index, 1);
    } else {
      this.form.scheduledDates.push(day.dateKey);
    }

    this.updateCalendarDays();
  }

  selectCurrentMonth() {
    const selected = new Set(this.form.scheduledDates || []);
    const year = this.calendarViewDate.getFullYear();
    const month = this.calendarViewDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      selected.add(this.createDateKey(year, month, day));
    }

    this.form.scheduledDates = Array.from(selected);
    this.updateCalendarDays();
  }

  clearScheduledDates() {
    this.form.scheduledDates = [];
    this.updateCalendarDays();
  }

  private updateCalendarDays() {
    const year = this.calendarViewDate.getFullYear();
    const month = this.calendarViewDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousMonthDays = new Date(year, month, 0).getDate();
    const selectedDates = new Set(this.form.scheduledDates || []);
    const todayKey = this.toDateKey(new Date());

    this.calendarDays = Array.from({ length: 42 }, (_, index) => {
      const dayOffset = index - firstDayOfMonth + 1;
      let date: Date;
      let dayNumber: number;
      let isCurrentMonth = true;

      if (dayOffset < 1) {
        dayNumber = previousMonthDays + dayOffset;
        date = new Date(year, month - 1, dayNumber);
        isCurrentMonth = false;
      } else if (dayOffset > daysInMonth) {
        dayNumber = dayOffset - daysInMonth;
        date = new Date(year, month + 1, dayNumber);
        isCurrentMonth = false;
      } else {
        dayNumber = dayOffset;
        date = new Date(year, month, dayNumber);
      }

      const dateKey = this.toDateKey(date);
      return {
        dateKey,
        dayNumber,
        isCurrentMonth,
        isToday: dateKey === todayKey,
        isSelected: selectedDates.has(dateKey),
        scheduledBanners: []
      };
    });
  }

  private isBannerScheduledForDate(banner: Banner, dateKey: string): boolean {
    if (banner.status !== 'scheduled') return false;

    if (banner.scheduledStart) {
      const startKey = this.toDateKey(new Date(banner.scheduledStart));
      if (dateKey < startKey) return false;
    }

    if (banner.scheduledEnd) {
      const endKey = this.toDateKey(new Date(banner.scheduledEnd));
      if (dateKey > endKey) return false;
    }

    if (banner.scheduledDates && banner.scheduledDates.length > 0) {
      return banner.scheduledDates.includes(dateKey);
    }

    if (banner.scheduledDays && banner.scheduledDays.length > 0) {
      return banner.scheduledDays.includes(this.parseDateKey(dateKey).getDay());
    }

    return Boolean(banner.scheduledStart || banner.scheduledEnd);
  }

  private getBannerScheduleForDate(banner: Banner, dateKey: string): BannerDailySchedule | undefined {
    return banner.dailySchedules?.[dateKey];
  }

  private getBannerOrderForDate(banner: Banner, dateKey: string): number {
    return Number(this.getBannerScheduleForDate(banner, dateKey)?.order || banner.order || 999);
  }

  private getInitialCalendarDate(banner: Banner): Date {
    const firstScheduledDate = banner.scheduledDates?.[0];
    if (firstScheduledDate) return this.parseDateKey(firstScheduledDate);
    if (banner.scheduledStart) return new Date(banner.scheduledStart);
    return new Date();
  }

  private getSortedScheduledDates(): string[] {
    return [...(this.form.scheduledDates || [])].sort();
  }

  private createDateKey(year: number, month: number, day: number): string {
    return this.toDateKey(new Date(year, month, day));
  }

  private toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDateKey(dateKey: string): Date {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private formatDateKeyForDisplay(dateKey: string): string {
    const date = this.parseDateKey(dateKey);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    }).format(date);
  }
}
