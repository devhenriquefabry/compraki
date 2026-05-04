import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-whatsapp-image-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './whatsapp-image-viewer.component.html',
  styleUrls: ['./whatsapp-image-viewer.component.scss']
})
export class WhatsappImageViewerComponent {
  @Input({ required: true }) imageUrl!: string;
  @Output() close = new EventEmitter<void>();

  onClose(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.close.emit();
  }

  onContentClick(event: Event): void {
    event.stopPropagation();
  }
}
