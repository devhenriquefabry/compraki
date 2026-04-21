import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-admin-metric-card',
  templateUrl: './admin-metric-card.component.html',
  styleUrls: ['./admin-metric-card.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class AdminMetricCardComponent {
  @Input() label: string = '';
  @Input() value: string | number = 0;
  @Input() icon: string = 'cube-outline';
  @Input() type: string = 'default'; // default, financial, shipping, blue, green, warn, danger
  @Input() delay: string = '0s';
}
