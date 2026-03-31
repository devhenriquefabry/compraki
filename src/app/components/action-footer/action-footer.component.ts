import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-action-footer',
  template: `
    <ion-footer class="ion-no-border action-footer-comp">
      <div class="footer-wrapper">
        <ion-button class="btn-action" expand="block" (click)="onAction()">
          <div class="inner-btn">
            <ion-icon [name]="icon" *ngIf="icon"></ion-icon>
            <span>{{ label }}</span>
          </div>
        </ion-button>
      </div>
    </ion-footer>
  `,
  styles: [`
    .action-footer-comp {
      background: white;
      padding: 12px 20px 20px;
      box-shadow: 0 -8px 20px rgba(0,0,0,0.06);
    }
    .footer-wrapper {
      max-width: 600px;
      margin: 0 auto;
    }
    .btn-action {
      --background: linear-gradient(180deg, #8cb55c 0%, #68923e 100%);
      --background-activated: #5c8236;
      --border-radius: 14px;
      --box-shadow: 0 8px 16px rgba(121, 157, 80, 0.25);
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 1px;
      height: 56px;
      margin: 0;
      text-transform: uppercase;
    }
    .inner-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      gap: 10px;

      ion-icon {
        font-size: 24px;
      }
      span {
        margin-top: 2px;
      }
    }
    .footer-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 11px;
      color: #999;
      margin-top: 10px;
      font-weight: 500;
      ion-icon { font-size: 14px; color: #799d50; }
    }
  `],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ActionFooterComponent {
  @Input() label: string = 'ADICIONAR';
  @Input() icon: string = '';
  @Input() hint: string = 'Operação segura e rápida';
  @Output() clicked = new EventEmitter<void>();

  onAction() {
    this.clicked.emit();
  }
}
