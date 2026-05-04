import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Subscription } from 'rxjs';

export interface BotStatus {
  status: 'idle' | 'running' | 'offline';
  message: string;
  logs: string[];
  queueLength: number;
}

@Injectable({
  providedIn: 'root'
})
export class BotMonitorService {
  private apiUrl = 'http://localhost:3001';
  
  private statusSubject = new BehaviorSubject<BotStatus>({
    status: 'idle',
    message: 'Sistema pronto.',
    logs: [],
    queueLength: 0
  });

  public status$ = this.statusSubject.asObservable();
  private pollingSub?: Subscription;

  constructor(private http: HttpClient) {}

  startPolling() {
    // Compat: o monitor local não é mais iniciado automaticamente.
    // A gestão oficial agora usa fila cloud no painel admin.
    if (this.pollingSub) return;
    this.statusSubject.next({
      status: 'idle',
      message: 'Gestão de bots migrada para fila cloud.',
      logs: [],
      queueLength: 0
    });
  }

  stopPolling() {
    this.pollingSub?.unsubscribe();
    this.pollingSub = undefined;
  }

  runBots(bots: any[]) {
    return this.http.post(`${this.apiUrl}/run-bots`, { bots });
  }

  clearLogs() {
    return this.http.post(`${this.apiUrl}/clear-logs`, {});
  }

  get currentStatus() {
    return this.statusSubject.value;
  }
}
