import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-saved-undo-toast',
  templateUrl: './saved-undo-toast.component.html',
  styleUrls: ['./saved-undo-toast.component.scss'],
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon]
})
export class SavedUndoToastComponent {
  @Input() message: string = 'Item removido.';
  @Output() undo = new EventEmitter<void>();

  constructor() {
    addIcons({ checkmarkCircleOutline });
  }

  onUndo() {
    this.undo.emit();
  }
}
