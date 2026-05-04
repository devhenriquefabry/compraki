import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import {
  BotCatalogItem,
  BotJob,
  BotJobPayload,
  BotLogLine,
  BotManagementService,
  BotOpsSummary
} from '../../services/bot-management.service';
import { AdminPanelHeroComponent } from '../../components/admin-panel-hero/admin-panel-hero.component';
import { AdminSubtabsComponent, AdminSubtabOption } from '../../components/admin-subtabs/admin-subtabs.component';

@Component({
  selector: 'app-bots',
  templateUrl: './bots.page.html',
  styleUrls: ['./bots.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AdminPanelHeroComponent, AdminSubtabsComponent]
})
export class BotsPage implements OnInit {
  public activeSubTab: 'catalog' | 'queue' | 'history' = 'catalog';
  public readonly subtabOptions: AdminSubtabOption[] = [
    { value: 'catalog', label: 'Catálogo', icon: 'apps-outline' },
    { value: 'queue', label: 'Fila', icon: 'list-outline' },
    { value: 'history', label: 'Execuções', icon: 'analytics-outline' }
  ];

  public readonly catalog: BotCatalogItem[] = [
    {
      name: 'Bot Populador',
      type: 'populate',
      icon: 'server-outline',
      description: 'Scraping de mercado e publicação automática de anúncios.',
      script: 'populate-bot.js',
      defaults: { keyword: '', count: null, headless: true, mode: 'batch' }
    },
    {
      name: 'Bot Comprador',
      type: 'buyer',
      icon: 'cart-outline',
      description: 'Simulação de jornada de compra com checkout automatizado.',
      script: 'buyer-bot.js',
      defaults: { count: null, headless: true, mode: 'batch' }
    },
    {
      name: 'Bot Desenrolado',
      type: 'chat',
      icon: 'chatbubbles-outline',
      description: 'Simulação de negociação e conversa em fluxo contínuo.',
      script: 'bot-desenrolado.js',
      defaults: { count: 1, headless: true, mode: 'alternate' }
    },
    {
      name: 'Bot Precificador',
      type: 'pricing',
      icon: 'pricetags-outline',
      description: 'Ajuste automático de preços com base em margem e concorrência.',
      script: 'pricing-bot.js',
      defaults: { keyword: '', count: 20, headless: true, mode: 'batch' }
    },
    {
      name: 'Bot Estoque Guardião',
      type: 'inventory',
      icon: 'cube-outline',
      description: 'Auditoria de estoque, detecção de ruptura e alerta de reposição.',
      script: 'inventory-guardian-bot.js',
      defaults: { keyword: '', count: 50, headless: true, mode: 'batch' }
    },
    {
      name: 'Bot Moderador',
      type: 'moderation',
      icon: 'shield-checkmark-outline',
      description: 'Monitora catálogo e sinaliza anúncios com padrões suspeitos.',
      script: 'moderation-bot.js',
      defaults: { keyword: '', count: 30, headless: true, mode: 'batch' }
    },
    {
      name: 'Bot Follow-up',
      type: 'followup',
      icon: 'mail-open-outline',
      description: 'Dispara lembretes automáticos para conversas e pedidos pendentes.',
      script: 'followup-bot.js',
      defaults: { count: 25, headless: true, mode: 'alternate' }
    },
    {
      name: 'Bot Reativador',
      type: 'reactivation',
      icon: 'refresh-circle-outline',
      description: 'Reengaja clientes inativos com campanhas segmentadas.',
      script: 'reactivation-bot.js',
      defaults: { keyword: '', count: 40, headless: true, mode: 'batch' }
    },
    {
      name: 'Bot Auditor',
      type: 'auditor',
      icon: 'document-text-outline',
      description: 'Executa checklist de qualidade e conformidade operacional.',
      script: 'auditor-bot.js',
      defaults: { count: 10, headless: false, mode: 'batch' }
    },
    {
      name: 'Bot Monitor de SLA',
      type: 'sla-monitor',
      icon: 'time-outline',
      description: 'Monitora tempos de resposta e abre incidentes de atraso.',
      script: 'sla-monitor-bot.js',
      defaults: { count: 100, headless: true, mode: 'batch' }
    }
  ];

  public draftByType: Record<string, BotJobPayload> = {};
  public jobs: BotJob[] = [];
  public selectedJobId = '';
  public jobLogs: BotLogLine[] = [];
  public summary: BotOpsSummary = {
    queued: 0,
    running: 0,
    success: 0,
    failed: 0,
    cancelled: 0,
    total: 0
  };
  public loadingJobs = false;
  public loadingLogs = false;
  public loadingSummary = false;
  public submittingByType = '';
  public runningQueueAll = false;
  public errorMessage = '';
  public successMessage = '';

  constructor(private botService: BotManagementService) {}

  ngOnInit() {
    this.catalog.forEach(item => {
      this.draftByType[item.type] = { ...item.defaults };
    });
    void this.refreshDashboard();
  }

  setActiveSubTab(tab: string): void {
    if (tab === 'catalog' || tab === 'queue' || tab === 'history') {
      this.activeSubTab = tab;
    }
  }

  async refreshDashboard(): Promise<void> {
    await Promise.all([
      this.loadSummary(),
      this.loadJobs()
    ]);
  }

  async loadSummary(): Promise<void> {
    this.loadingSummary = true;
    try {
      this.summary = await this.botService.getSummary();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.loadingSummary = false;
    }
  }

  async loadJobs(status = ''): Promise<void> {
    this.loadingJobs = true;
    try {
      this.jobs = await this.botService.listJobs(status);
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.loadingJobs = false;
    }
  }

  async enqueueBot(item: BotCatalogItem): Promise<void> {
    this.submittingByType = item.type;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const payload = this.draftByType[item.type] || {};
      await this.botService.createJob(item, payload);
      this.successMessage = `${item.name} enviado para fila cloud com sucesso.`;
      await this.refreshDashboard();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.submittingByType = '';
    }
  }

  async enqueueCatalogQueue(): Promise<void> {
    if (this.runningQueueAll) return;
    this.runningQueueAll = true;
    this.errorMessage = '';
    this.successMessage = '';

    let successCount = 0;
    let failCount = 0;

    for (const item of this.catalog) {
      try {
        const payload = this.draftByType[item.type] || {};
        await this.botService.createJob(item, payload);
        successCount++;
      } catch {
        failCount++;
      }
    }

    await this.refreshDashboard();

    if (failCount === 0) {
      this.successMessage = `${successCount} bots enviados para a fila cloud com sucesso.`;
    } else {
      this.errorMessage = `${failCount} bot(s) falharam ao enfileirar.`;
      this.successMessage = `${successCount} bot(s) foram enviados para a fila cloud.`;
    }

    this.runningQueueAll = false;
  }

  async cancel(jobId: string): Promise<void> {
    this.errorMessage = '';
    try {
      await this.botService.cancelJob(jobId);
      await this.refreshDashboard();
      if (this.selectedJobId === jobId) {
        await this.loadLogs(jobId);
      }
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    }
  }

  async retry(jobId: string): Promise<void> {
    this.errorMessage = '';
    try {
      await this.botService.retryJob(jobId);
      await this.refreshDashboard();
      if (this.selectedJobId === jobId) {
        await this.loadLogs(jobId);
      }
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    }
  }

  async loadLogs(jobId: string): Promise<void> {
    this.selectedJobId = jobId;
    this.loadingLogs = true;
    this.errorMessage = '';
    try {
      this.jobLogs = await this.botService.listJobLogs(jobId);
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
      this.jobLogs = [];
    } finally {
      this.loadingLogs = false;
    }
  }

  getStatusPillClass(status: string): string {
    return `status-${status || 'queued'}`;
  }

  statusLabel(status: string): string {
    if (status === 'queued') return 'Na fila';
    if (status === 'running') return 'Executando';
    if (status === 'success') return 'Sucesso';
    if (status === 'failed') return 'Falha';
    if (status === 'cancelled') return 'Cancelado';
    return status || 'Indefinido';
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Erro ao processar operação de bots.';
  }
}
