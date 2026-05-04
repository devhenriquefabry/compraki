import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-whatsapp-lock-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './whatsapp-lock-modal.component.html',
  styleUrls: ['./whatsapp-lock-modal.component.scss']
})
export class WhatsappLockModalComponent {
  @Input() intent: 'lock' | 'unlock' = 'unlock';
  @Input() maskedNumber = '';
  @Input() loading = false;
  @Input() message = '';
  @Input() code = '';

  @Output() codeChange = new EventEmitter<string>();
  @Output() confirm = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  onCodeChange(value: string): void {
    this.code = value;
    this.codeChange.emit(value);
  }

  onConfirm(): void {
    this.confirm.emit();
  }

  onClose(): void {
    if (this.loading) return;
    this.close.emit();
  }

  onContentClick(event: Event): void {
    event.stopPropagation();
  }
}
