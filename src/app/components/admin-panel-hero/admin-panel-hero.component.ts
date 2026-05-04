import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

export interface AdminPanelHeroSegmentOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-admin-panel-hero',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './admin-panel-hero.component.html',
  styleUrls: ['./admin-panel-hero.component.scss']
})
export class AdminPanelHeroComponent {
  /** Texto pequeno em caixa alta acima do título (ex.: DASHBOARD MÉTRICO DO SISTEMA) */
  @Input({ required: true }) eyebrow!: string;
  /** Título principal da aba */
  @Input({ required: true }) title!: string;
  /** Subtítulo / descrição */
  @Input() description = '';

  /** Quando true, somente o bloco projetado com `[panelHeroActions]` aparece à direita */
  @Input() useCustomActionsColumn = false;

  /** Filtro em pílulas (ex.: Hoje / 7 dias / 30 dias) */
  @Input() showSegmentedControl = false;
  @Input() segmentOptions: AdminPanelHeroSegmentOption[] = [];
  @Input() selectedSegment = '';
  @Output() segmentChange = new EventEmitter<string>();

  /** Mostrar área para datas personalizadas — use `<div panelHeroCustomRange>...</div>` no pai */
  @Input() showCustomDateRange = false;

  /** Botão principal opcional (ex.: Novo Banner), antes do Atualizar */
  @Input() primaryActionLabel: string | null = null;
  @Input() primaryActionIcon: string | null = 'add-outline';
  @Output() primaryActionClick = new EventEmitter<void>();

  @Input() showRefreshButton = true;
  @Input() refreshButtonLabel = 'Atualizar';
  @Input() refreshButtonIcon = 'refresh-outline';
  @Output() refreshClick = new EventEmitter<void>();

  onSegmentClick(value: string): void {
    this.segmentChange.emit(value);
  }

  onPrimaryClick(): void {
    this.primaryActionClick.emit();
  }

  onRefreshClick(): void {
    this.refreshClick.emit();
  }

  trackSegment(_: number, item: AdminPanelHeroSegmentOption): string {
    return item.value;
  }
}
