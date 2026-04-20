import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-admin-filter-modal',
  templateUrl: './admin-filter-modal.component.html',
  styleUrls: ['./admin-filter-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AdminFilterModalComponent {

  @Input() filterState = {
    condition: 'todos',
    stockStatus: 'todos',
    minPrice: null as number | null,
    maxPrice: null as number | null,
    sellerId: 'todos',
    sortBy: 'newest'
  };

  @Input() sellersList: { id: string, name: string }[] = [];

  @Output() filterChange = new EventEmitter<any>();
  @Output() filterClear = new EventEmitter<void>();

  onFilterChange() {
    this.filterChange.emit(this.filterState);
  }

  onClearFilters() {
    this.filterClear.emit();
  }

}
