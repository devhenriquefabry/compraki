import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-admin-product-card',
  templateUrl: './admin-product-card.component.html',
  styleUrls: ['./admin-product-card.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, DecimalPipe, RouterModule]
})
export class AdminProductCardComponent {

  @Input() product: any;
  @Input() sellerName: string = '...';
  @Input() isCurrentUser: boolean = false;

  @Output() selectedChange = new EventEmitter<boolean>();
  @Output() chatRequested = new EventEmitter<void>();

  onSelectedChange(event: any) {
    this.selectedChange.emit(this.product.selected);
  }

  onChatRequested(event: Event) {
    event.stopPropagation();
    this.chatRequested.emit();
  }

}
