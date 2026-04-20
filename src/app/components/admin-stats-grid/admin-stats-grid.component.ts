import { Component, Input } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-admin-stats-grid',
  templateUrl: './admin-stats-grid.component.html',
  styleUrls: ['./admin-stats-grid.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, DecimalPipe]
})
export class AdminStatsGridComponent {
  
  @Input() isLoading: boolean = true;
  
  @Input() stats = {
    totalItems: 0,
    totalValue: 0,
    newItems: 0,
    outOfStockItems: 0
  };

  @Input() financialStats = {
    avgTicket: 0,
    soldRevenue: 0,
    unitsSold: 0,
    stockValue: 0
  };

  @Input() shippingStats = {
    pendingDelivery: 0,
    lateDelivery: 0,
    lateToday: 0,
    pendingValue: 0
  };
}
