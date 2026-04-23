import { Component, OnInit } from '@angular/core';
import { BotMonitorService, BotStatus } from '../../services/bot-monitor.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-bot-status-widget',
  templateUrl: './bot-status-widget.component.html',
  styleUrls: ['./bot-status-widget.component.scss'],
  standalone: false
})
export class BotStatusWidgetComponent implements OnInit {
  public status: BotStatus = {
    status: 'idle',
    message: 'Sistema pronto.',
    logs: [],
    queueLength: 0
  };

  constructor(
    private botMonitor: BotMonitorService,
    private router: Router
  ) { }

  ngOnInit() {
    this.botMonitor.status$.subscribe(s => {
      this.status = s;
    });
  }

  get lastLog(): string {
    if (this.status.logs && this.status.logs.length > 0) {
      return this.status.logs[this.status.logs.length - 1];
    }
    return this.status.message;
  }

  goToBots() {
    this.router.navigate(['/bots']);
  }
}
