import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { WhatsappInstancesService } from '../../../../services/whatsapp-instances.service';
import {
  WhatsappInstanceView,
  getErrorMessage,
  getInstanceStatusClass,
  getInstanceStatusIcon,
  getInstanceStatusLabel,
  isInstanceConnected
} from '../../manage-whatsapp.types';

@Component({
  selector: 'app-whatsapp-instances-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './whatsapp-instances-panel.component.html',
  styleUrls: ['./whatsapp-instances-panel.component.scss']
})
export class WhatsappInstancesPanelComponent {
  @Input() instances: WhatsappInstanceView[] = [];
  @Input() isLoading = false;
  @Output() instancesChanged = new EventEmitter<void>();

  public instanceName = '';
  public webhookUrl = '';
  public selectedQrCode = '';
  public selectedQrInstance = '';
  public selectedTestInstance = '';
  public testPhoneNumber = '';
  public testMessage = 'Olá! Esta é uma mensagem teste da Compraki.';
  public isCreating = false;
  public isSendingTest = false;
  public errorMessage = '';
  public successMessage = '';

  constructor(private whatsappService: WhatsappInstancesService) {}

  isInstanceConnected = isInstanceConnected;
  getInstanceStatusLabel = getInstanceStatusLabel;
  getInstanceStatusIcon = getInstanceStatusIcon;
  getInstanceStatusClass = getInstanceStatusClass;

  async createInstance(): Promise<void> {
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
      this.instancesChanged.emit();
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.isCreating = false;
    }
  }

  async showQrCode(instanceName: string): Promise<void> {
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
      this.errorMessage = getErrorMessage(error);
    }
  }

  async disconnectInstance(instanceName: string): Promise<void> {
    if (!confirm(`Deseja desconectar a instância "${instanceName}"?`)) return;

    try {
      await this.whatsappService.disconnectInstance(instanceName);
      this.instancesChanged.emit();
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    }
  }

  async deleteInstance(instanceName: string): Promise<void> {
    if (!confirm(`Deseja remover a instância "${instanceName}"?`)) return;

    try {
      await this.whatsappService.deleteInstance(instanceName);
      this.instancesChanged.emit();
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    }
  }

  selectTestInstance(instanceName: string): void {
    this.selectedTestInstance = instanceName;
    this.successMessage = `Instância ${instanceName} selecionada para mensagem teste.`;
  }

  async sendTestMessage(instanceName = this.selectedTestInstance): Promise<void> {
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
      await this.whatsappService.sendTestMessage({ instanceName: targetInstance, phoneNumber, message });
      this.successMessage = `Mensagem teste enviada pela instância ${targetInstance}.`;
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.isSendingTest = false;
    }
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
}
