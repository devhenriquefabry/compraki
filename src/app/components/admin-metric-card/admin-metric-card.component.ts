import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { 
  chatbubblesOutline, 
  cartOutline, 
  cameraOutline, 
  micOutline, 
  flagOutline, 
  banOutline,
  cubeOutline,
  walletOutline,
  pricetagOutline,
  statsChartOutline
} from 'ionicons/icons';

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

  constructor() {
    addIcons({ 
      chatbubblesOutline, 
      cartOutline, 
      cameraOutline, 
      micOutline, 
      flagOutline, 
      banOutline,
      cubeOutline,
      'chatbubbles-outline': chatbubblesOutline,
      'cart-outline': cartOutline,
      'camera-outline': cameraOutline,
      'mic-outline': micOutline,
      'flag-outline': flagOutline,
      'ban-outline': banOutline,
      'cube-outline': cubeOutline,
      'wallet-outline': walletOutline,
      'pricetag-outline': pricetagOutline,
      'stats-chart-outline': statsChartOutline
    });
  }
}
