import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { WhatsappInstancesService, WhatsappTriggerConfig } from '../../services/whatsapp-instances.service';
import { AdminSubtabsComponent, AdminSubtabOption } from '../../components/admin-subtabs/admin-subtabs.component';

interface WhatsappInstanceView {
  name: string;
  status: string;
  raw: unknown;
}

@Component({
  selector: 'app-manage-whatsapp',
  templateUrl: './manage-whatsapp.page.html',
  styleUrls: ['./manage-whatsapp.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AdminSubtabsComponent]
})
export class ManageWhatsappPage implements OnInit {
  public activeSubTab: 'instances' | 'triggers' | 'docs' = 'instances';
  public readonly subtabOptions: AdminSubtabOption[] = [
    { value: 'instances', label: 'Instâncias', icon: 'logo-whatsapp' },
    { value: 'triggers', label: 'Gatilhos', icon: 'flash-outline' },
    { value: 'docs', label: 'Documentação', icon: 'document-text-outline' }
  ];
  public instanceName = '';
  public webhookUrl = '';
  public instances: WhatsappInstanceView[] = [];
  public selectedQrCode = '';
  public selectedQrInstance = '';
  public selectedTestInstance = '';
  public testPhoneNumber = '';
  public testMessage = 'Olá! Esta é uma mensagem teste da Compraki.';
  public isLoading = false;
  public isCreating = false;
  public isSendingTest = false;
  public isLoadingTriggers = false;
  public savingTrigger = '';
  public testingTrigger = '';
  public triggers: WhatsappTriggerConfig[] = [];
  public errorMessage = '';
  public successMessage = '';
  public readonly triggerVariables = ['{{nome}}', '{{email}}', '{{telefone}}', '{{produto}}', '{{valor}}', '{{pedido}}', '{{chat}}', '{{evento}}'];

  /** Gatilhos com painel de edição aberto (eventType). */
  public expandedTriggerKeys = new Set<string>();
  public variablesHelpOpen = false;

  constructor(private whatsappService: WhatsappInstancesService) {}

  setActiveSubTab(tab: string) {
    if (tab === 'instances' || tab === 'triggers' || tab === 'docs') {
      this.activeSubTab = tab;
    }
  }

  isTriggerExpanded(eventType: string): boolean {
    return this.expandedTriggerKeys.has(eventType);
  }

  toggleTriggerExpand(eventType: string): void {
    const next = new Set(this.expandedTriggerKeys);
    if (next.has(eventType)) {
      next.delete(eventType);
    } else {
      next.add(eventType);
    }
    this.expandedTriggerKeys = next;
  }

  triggerSummarySecondary(trigger: WhatsappTriggerConfig): string {
    const inst = trigger.instanceName?.trim();
    const phone = trigger.phoneNumber?.trim();
    const parts: string[] = [];
    if (inst) {
      parts.push(inst);
    } else {
      parts.push('Sem instância');
    }
    if (phone) {
      parts.push(phone);
    }
    return parts.join(' · ');
  }

  ngOnInit() {
    void this.loadInstances();
    void this.loadTriggers();
  }

  async loadInstances() {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const response = await this.whatsappService.listInstances();
      this.instances = this.normalizeInstances(response);
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.isLoading = false;
    }
  }

  async createInstance() {
    const name = this.instanceName.trim();
    if (!name) {
      this.errorMessage = 'Informe um nome para a instância.';
      return;
    }

    this.isCreating = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.whatsappService.createInstance({
        instanceName: name,
        webhookUrl: this.webhookUrl.trim() || undefined
      });

      this.successMessage = `Instância ${name} criada. Busque o QR Code para conectar.`;
      this.instanceName = '';
      await this.loadInstances();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.isCreating = false;
    }
  }

  async loadTriggers() {
    this.isLoadingTriggers = true;
    this.errorMessage = '';

    try {
      this.triggers = await this.whatsappService.getTriggers();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.isLoadingTriggers = false;
    }
  }

  async saveTrigger(trigger: WhatsappTriggerConfig) {
    this.savingTrigger = trigger.eventType;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const response = await this.whatsappService.saveTrigger(trigger);
      this.triggers = this.triggers.map(item =>
        item.eventType === trigger.eventType ? response.trigger : item
      );
      this.successMessage = `Gatilho "${trigger.label}" salvo.`;
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.savingTrigger = '';
    }
  }

  async testTrigger(trigger: WhatsappTriggerConfig) {
    this.testingTrigger = trigger.eventType;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.whatsappService.saveTrigger(trigger);
      await this.whatsappService.dispatchTrigger({
        eventType: trigger.eventType,
        data: {
          nome: 'Cliente Teste',
          email: 'cliente@compraki.com.br',
          telefone: trigger.phoneNumber,
          produto: 'Produto Teste',
          valor: 'R$ 99,90',
          pedido: 'TESTE-001',
          chat: 'CHAT-TESTE'
        }
      });
      this.successMessage = `Mensagem teste do gatilho "${trigger.label}" enviada.`;
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.testingTrigger = '';
    }
  }

  async showQrCode(instanceName: string) {
    this.errorMessage = '';
    this.selectedQrCode = '';
    this.selectedQrInstance = instanceName;

    try {
      const response = await this.whatsappService.getQrCode(instanceName);
      this.selectedQrCode = this.extractQrCode(response);

      if (!this.selectedQrCode) {
        this.errorMessage = 'QR Code não encontrado na resposta da Evolution API.';
      }
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    }
  }

  async disconnectInstance(instanceName: string) {
    const confirmed = confirm(`Deseja desconectar a instância "${instanceName}"?`);
    if (!confirmed) return;

    try {
      await this.whatsappService.disconnectInstance(instanceName);
      await this.loadInstances();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    }
  }

  async deleteInstance(instanceName: string) {
    const confirmed = confirm(`Deseja remover a instância "${instanceName}"?`);
    if (!confirmed) return;

    try {
      await this.whatsappService.deleteInstance(instanceName);
      await this.loadInstances();
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    }
  }

  selectTestInstance(instanceName: string) {
    this.selectedTestInstance = instanceName;
    this.successMessage = `Instância ${instanceName} selecionada para mensagem teste.`;
  }

  async sendTestMessage(instanceName = this.selectedTestInstance) {
    const targetInstance = instanceName.trim();
    const phoneNumber = this.testPhoneNumber.trim();
    const message = this.testMessage.trim();

    if (!targetInstance) {
      this.errorMessage = 'Selecione uma instância para enviar a mensagem teste.';
      return;
    }

    if (!phoneNumber) {
      this.errorMessage = 'Informe o WhatsApp de destino com DDD.';
      this.selectedTestInstance = targetInstance;
      return;
    }

    if (!message) {
      this.errorMessage = 'Informe a mensagem teste.';
      return;
    }

    this.isSendingTest = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.selectedTestInstance = targetInstance;

    try {
      await this.whatsappService.sendTestMessage({
        instanceName: targetInstance,
        phoneNumber,
        message
      });

      this.successMessage = `Mensagem teste enviada pela instância ${targetInstance}.`;
    } catch (error) {
      this.errorMessage = this.getErrorMessage(error);
    } finally {
      this.isSendingTest = false;
    }
  }

  isInstanceConnected(status: string): boolean {
    return this.getNormalizedStatus(status) === 'connected';
  }

  getInstanceStatusLabel(status: string): string {
    const normalizedStatus = this.getNormalizedStatus(status);

    if (normalizedStatus === 'connected') return 'Conectado';
    if (normalizedStatus === 'connecting') return 'Conectando';
    if (normalizedStatus === 'disconnected') return 'Desconectado';

    return 'Status indefinido';
  }

  getInstanceStatusIcon(status: string): string {
    const normalizedStatus = this.getNormalizedStatus(status);

    if (normalizedStatus === 'connected') return 'checkmark-circle-outline';
    if (normalizedStatus === 'connecting') return 'sync-outline';
    if (normalizedStatus === 'disconnected') return 'close-circle-outline';

    return 'help-circle-outline';
  }

  getInstanceStatusClass(status: string): string {
    return `status-${this.getNormalizedStatus(status)}`;
  }

  private normalizeInstances(response: unknown): WhatsappInstanceView[] {
    const value = response as { instances?: unknown; data?: unknown };
    const list = Array.isArray(response)
      ? response
      : Array.isArray(value.instances)
        ? value.instances
        : Array.isArray(value.data)
          ? value.data
          : [];

    return list.map((item, index) => {
      const record = item as Record<string, unknown>;
      const name = String(record['name'] || record['instanceName'] || record['instance'] || `Instância ${index + 1}`);
      const status = String(record['connectionStatus'] || record['status'] || record['state'] || 'desconhecido');

      return {
        name,
        status,
        raw: item
      };
    });
  }

  private extractQrCode(response: unknown): string {
    const record = response as Record<string, unknown>;
    const candidates = [
      record['base64'],
      record['qrcode'],
      record['qrCode'],
      (record['data'] as Record<string, unknown> | undefined)?.['base64'],
      (record['data'] as Record<string, unknown> | undefined)?.['qrcode'],
      (record['data'] as Record<string, unknown> | undefined)?.['qrCode']
    ];

    const qrCode = candidates.find(value => typeof value === 'string' && value.trim()) as string | undefined;
    if (!qrCode) return '';

    return qrCode.startsWith('data:image') ? qrCode : `data:image/png;base64,${qrCode}`;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Erro inesperado ao gerenciar WhatsApp.';
  }

  private getNormalizedStatus(status: string): 'connected' | 'connecting' | 'disconnected' | 'unknown' {
    const value = status.toLowerCase().trim();

    if (['open', 'opened', 'connected', 'connectado', 'conectado', 'online'].includes(value)) {
      return 'connected';
    }

    if (['connecting', 'pairing', 'qrcode', 'qr', 'loading', 'starting'].includes(value)) {
      return 'connecting';
    }

    if (['close', 'closed', 'disconnected', 'disconnect', 'desconectado', 'offline'].includes(value)) {
      return 'disconnected';
    }

    return 'unknown';
  }
}
