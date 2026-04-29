import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonicModule } from '@ionic/angular';

export interface AdminSubtabOption {
  value: string;
  label: string;
  icon?: string;
}

@Component({
  selector: 'app-admin-subtabs',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './admin-subtabs.component.html',
  styleUrls: ['./admin-subtabs.component.scss']
})
export class AdminSubtabsComponent {
  @Input() options: AdminSubtabOption[] = [];
  @Input() activeTab = '';
  @Output() activeTabChange = new EventEmitter<string>();

  selectTab(value: string) {
    if (value === this.activeTab) return;
    this.activeTabChange.emit(value);
  }
}
