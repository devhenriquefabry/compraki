import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-feedback-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <div class="overlay" *ngIf="visible" (click)="close()">
      <div class="feedback-card" [class]="type" (click)="$event.stopPropagation()">
        <div class="icon-circle">
          <ion-icon [name]="iconName"></ion-icon>
        </div>
        <h2>{{ title }}</h2>
        <p>{{ message }}</p>
        <button class="btn-ok" (click)="close()">{{ buttonText }}</button>
      </div>
    </div>
  `,
  styles: [`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      padding: 20px;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scaleIn {
      from { transform: scale(0.85); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .feedback-card {
      background: #ffffff;
      border-radius: 24px;
      padding: 40px 30px 30px;
      text-align: center;
      max-width: 320px;
      width: 100%;
      animation: scaleIn 0.3s ease;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15);

      .icon-circle {
        width: 70px;
        height: 70px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 20px;
        ion-icon { font-size: 36px; color: #fff; }
      }

      h2 {
        font-size: 20px;
        font-weight: 800;
        color: #1e2d3e;
        margin: 0 0 10px;
      }

      p {
        font-size: 14px;
        color: #777;
        line-height: 1.5;
        margin: 0 0 25px;
      }

      .btn-ok {
        width: 100%;
        padding: 15px;
        border: none;
        border-radius: 14px;
        font-size: 15px;
        font-weight: 800;
        color: #fff;
        cursor: pointer;
        transition: all 0.2s;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        &:active { transform: scale(0.97); }
      }

      &.success {
        .icon-circle { background: linear-gradient(135deg, #799d50, #96c93d); }
        .btn-ok { background: linear-gradient(135deg, #799d50, #96c93d); box-shadow: 0 6px 20px rgba(121, 157, 80, 0.3); }
      }

      &.error {
        .icon-circle { background: linear-gradient(135deg, #ff4961, #ff6b6b); }
        .btn-ok { background: linear-gradient(135deg, #ff4961, #ff6b6b); box-shadow: 0 6px 20px rgba(255, 73, 97, 0.3); }
      }

      &.warning {
        .icon-circle { background: linear-gradient(135deg, #f6ad55, #ed8936); }
        .btn-ok { background: linear-gradient(135deg, #f6ad55, #ed8936); box-shadow: 0 6px 20px rgba(246, 173, 85, 0.3); }
      }

      &.info {
        .icon-circle { background: linear-gradient(135deg, #4299e1, #63b3ed); }
        .btn-ok { background: linear-gradient(135deg, #4299e1, #63b3ed); box-shadow: 0 6px 20px rgba(66, 153, 225, 0.3); }
      }
    }
  `]
})
export class FeedbackModalComponent {
  @Input() visible = false;
  @Input() type: 'success' | 'error' | 'warning' | 'info' = 'success';
  @Input() title = 'Sucesso!';
  @Input() message = '';
  @Input() buttonText = 'OK';
  @Output() closed = new EventEmitter<void>();

  get iconName(): string {
    switch (this.type) {
      case 'success': return 'checkmark-circle';
      case 'error': return 'close-circle';
      case 'warning': return 'warning';
      case 'info': return 'information-circle';
      default: return 'checkmark-circle';
    }
  }

  close() {
    this.visible = false;
    this.closed.emit();
  }
}
