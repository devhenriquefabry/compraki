import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-dev-mode-notice',
  templateUrl: './dev-mode-notice.component.html',
  styleUrls: ['./dev-mode-notice.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class DevModeNoticeComponent implements OnInit, OnDestroy {
  public projectDuration: string = '';
  public showSecretNotice: boolean = false;
  private startDate = new Date('2026-02-06T18:37:00');
  private intervalId: any;

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.ctrlKey && (event.key === "'" || event.code === 'Quote')) {
      event.preventDefault();
      this.showSecretNotice = !this.showSecretNotice;
    }
  }

  ngOnInit() {
    this.updateDuration();
    this.intervalId = setInterval(() => this.updateDuration(), 1000);
  }

  ngOnDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  private updateDuration() {
    const now = new Date();
    const diff = now.getTime() - this.startDate.getTime();

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    this.projectDuration = `${days} dias, ${hours}h ${minutes}m ${seconds}s`;
  }
}
