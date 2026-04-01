import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonChip, IonLabel } from '@ionic/angular/standalone';

@Component({
  selector: 'app-saved-filter',
  templateUrl: './saved-filter.component.html',
  styleUrls: ['./saved-filter.component.scss'],
  standalone: true,
  imports: [CommonModule, IonChip, IonLabel]
})
export class SavedFilterComponent {
  @Output() filterChanged = new EventEmitter<string>();
  
  filters = ['Todos', 'Novos', 'Usados'];
  activeFilter = 'Todos';

  setFilter(filter: string) {
    this.activeFilter = filter;
    this.filterChanged.emit(filter);
  }
}
