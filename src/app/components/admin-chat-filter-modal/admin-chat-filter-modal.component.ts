import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { 
  swapVerticalOutline, 
  timeOutline, 
  chatboxEllipsesOutline, 
  personOutline, 
  shieldCheckmarkOutline,
  calendarOutline,
  refreshOutline
} from 'ionicons/icons';

@Component({
  selector: 'app-admin-chat-filter-modal',
  templateUrl: './admin-chat-filter-modal.component.html',
  styleUrls: ['./admin-chat-filter-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AdminChatFilterModalComponent {

  @Input() filterState = {
    status: 'all',          // all, active, reported, banned, closed
    chatType: 'all',        // all, product, general
    dateRange: 'all',       // all, today, 7days, 30days
    participantId: 'all',   // specific UID
    sortBy: 'newest'        // newest, oldest, activity
  };

  @Input() participantsList: { id: string, name: string }[] = [];

  @Output() filterChange = new EventEmitter<any>();
  @Output() filterClear = new EventEmitter<void>();

  constructor() {
    addIcons({ 
      swapVerticalOutline, 
      timeOutline, 
      chatboxEllipsesOutline, 
      personOutline, 
      shieldCheckmarkOutline,
      calendarOutline,
      refreshOutline
    });
  }

  onFilterChange() {
    this.filterChange.emit(this.filterState);
  }

  onClearFilters() {
    this.filterClear.emit();
  }

}
