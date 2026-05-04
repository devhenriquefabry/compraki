import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { AdminPanelHeroComponent } from '../../components/admin-panel-hero/admin-panel-hero.component';
import { AdminSubtabOption, AdminSubtabsComponent } from '../../components/admin-subtabs/admin-subtabs.component';
import { WhatsappInstancesService } from '../../services/whatsapp-instances.service';
import { WhatsappChatsPanelComponent } from './components/whatsapp-chats-panel/whatsapp-chats-panel.component';
import { WhatsappDocsPanelComponent } from './components/whatsapp-docs-panel/whatsapp-docs-panel.component';
import { WhatsappInstancesPanelComponent } from './components/whatsapp-instances-panel/whatsapp-instances-panel.component';
import { WhatsappTriggersPanelComponent } from './components/whatsapp-triggers-panel/whatsapp-triggers-panel.component';
import { WhatsappInstanceView, getErrorMessage } from './manage-whatsapp.types';

type WhatsappSubTab = 'instances' | 'triggers' | 'chats' | 'docs';

@Component({
  selector: 'app-manage-whatsapp',
  templateUrl: './manage-whatsapp.page.html',
  styleUrls: ['./manage-whatsapp.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    AdminSubtabsComponent,
    AdminPanelHeroComponent,
    WhatsappInstancesPanelComponent,
    WhatsappTriggersPanelComponent,
    WhatsappChatsPanelComponent,
    WhatsappDocsPanelComponent
  ]
})
export class ManageWhatsappPage implements OnInit {
  public activeSubTab: WhatsappSubTab = 'chats';
  public readonly subtabOptions: AdminSubtabOption[] = [
    { value: 'chats', label: 'Conversas', icon: 'chatbubbles-outline' },
    { value: 'instances', label: 'Instâncias', icon: 'logo-whatsapp' },
    { value: 'triggers', label: 'Gatilhos', icon: 'flash-outline' },
    { value: 'docs', label: 'Documentação', icon: 'document-text-outline' }
  ];

  public instances: WhatsappInstanceView[] = [];
  public isLoading = false;
  public errorMessage = '';

  constructor(private whatsappService: WhatsappInstancesService) {}

  ngOnInit(): void {
    void this.loadInstances();
  }

  setActiveSubTab(tab: string): void {
    if (tab === 'instances' || tab === 'triggers' || tab === 'chats' || tab === 'docs') {
      this.activeSubTab = tab;
    }
  }

  async loadInstances(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const response = await this.whatsappService.listInstances();
      this.instances = this.normalizeInstances(response);
    } catch (error) {
      this.errorMessage = getErrorMessage(error);
    } finally {
      this.isLoading = false;
    }
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
      return { name, status, raw: item };
    });
  }
}
