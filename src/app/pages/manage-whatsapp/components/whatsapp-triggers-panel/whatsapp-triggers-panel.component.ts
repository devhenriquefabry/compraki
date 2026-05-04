import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { WhatsappInstancesService, WhatsappTriggerConfig } from '../../../../services/whatsapp-instances.service';
import { WhatsappInstanceView, getErrorMessage } from '../../manage-whatsapp.types';

@Component({
  selector: 'app-whatsapp-triggers-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './whatsapp-triggers-panel.component.html',
  styleUrls: ['./whatsapp-triggers-panel.component.scss']
})
export class WhatsappTriggersPanelComponent implements OnInit {
  @Input() instances: WhatsappInstanceView[] = [];

  public readonly triggerVariables = [
    '{{nome}}', '{{email}}', '{{telefone}}', '{{produto}}',
    '{{valor}}', '{{pedido}}', '{{chat}}', '{{evento}}'
  ];
  public triggers: WhatsappTriggerConfig[] = [];
  public isLoadingTriggers = false;
  public savingTrigger = '';
  public testingTrigger = '';
  public errorMessage = '';
  public successMessage = '';
  public expandedTriggerKeys = new Set<string>();
  public variablesHelpOpen = false;

  constructor(private whatsappService: WhatsappInstancesService) {}

  ngOnInit(): void {
    void this.loadTriggers();
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
    parts.push(inst || 'Sem instância');
    if (phone) parts.push(phone);
    return parts.join(' · ');
  }

  async loadTriggers(): Promise<void> {
    this.isLoadingTriggers = true;
    this.errorMessage = '';

    try {
      this.triggers = await this.whatsappService.getTriggers();
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.isLoadingTriggers = false;
    }
  }

  async saveTrigger(trigger: WhatsappTriggerConfig): Promise<void> {
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
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.savingTrigger = '';
    }
  }

  async testTrigger(trigger: WhatsappTriggerConfig): Promise<void> {
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
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.testingTrigger = '';
    }
  }
}
