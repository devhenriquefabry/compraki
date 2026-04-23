import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { interval, BehaviorSubject, Subscription, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

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

  constructor(private http: HttpClient) {
    this.startPolling();
  }

  startPolling() {
    if (this.pollingSub) return;

    this.pollingSub = interval(2000).pipe(
      switchMap(() => this.http.get<BotStatus>(`${this.apiUrl}/status`).pipe(
        catchError(() => of({
          status: 'offline',
          message: 'Servidor Offline (3001)',
          logs: [],
          queueLength: 0
        } as BotStatus))
      )),
      tap(status => {
        this.statusSubject.next(status);
      })
    ).subscribe();
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
