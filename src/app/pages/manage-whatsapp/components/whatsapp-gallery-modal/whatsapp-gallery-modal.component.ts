import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { WhatsappMessageRow } from '../../manage-whatsapp.types';

@Component({
  selector: 'app-whatsapp-gallery-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './whatsapp-gallery-modal.component.html',
  styleUrls: ['./whatsapp-gallery-modal.component.scss']
})
export class WhatsappGalleryModalComponent {
  @Input() rows: WhatsappMessageRow[] = [];
  @Input() loadingOlder = false;
  @Input() hasMore = false;
  @Input() imageLoadStateById: Record<string, 'loading' | 'loaded' | 'error'> = {};
  @Input() videoLoadStateById: Record<string, 'loading' | 'loaded' | 'error'> = {};

  @Output() close = new EventEmitter<void>();
  @Output() loadOlder = new EventEmitter<void>();
  @Output() openImage = new EventEmitter<{ url: string; event?: Event }>();
  @Output() retryImage = new EventEmitter<WhatsappMessageRow>();
  @Output() imageLoaded = new EventEmitter<string>();
  @Output() imageError = new EventEmitter<string>();
  @Output() videoLoaded = new EventEmitter<string>();
  @Output() videoError = new EventEmitter<string>();

  getItemState(row: WhatsappMessageRow): 'loading' | 'loaded' | 'error' {
    if (row.mediaType === 'image' || row.mediaType === 'sticker') {
      return this.imageLoadStateById[row.id] || 'loading';
    }
    if (row.mediaType === 'video') return this.videoLoadStateById[row.id] || 'loading';
    return 'loaded';
  }

  onClose(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.close.emit();
  }

  onPanelClick(event: Event): void {
    event.stopPropagation();
  }

  onOpenImage(url: string | undefined, event: Event): void {
    if (!url) return;
    this.openImage.emit({ url, event });
  }

  onRetryImage(row: WhatsappMessageRow): void {
    this.retryImage.emit(row);
  }
}
