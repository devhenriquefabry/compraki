import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-whatsapp-docs-panel',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './whatsapp-docs-panel.component.html',
  styleUrls: ['./whatsapp-docs-panel.component.scss']
})
export class WhatsappDocsPanelComponent {}
