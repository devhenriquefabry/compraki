import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { interval, Subscription } from 'rxjs';
import { addIcons } from 'ionicons';

@Component({
  selector: 'app-bots',
  templateUrl: './bots.page.html',
  styleUrls: ['./bots.page.scss'],
  standalone: false
})
export class BotsPage implements OnInit, OnDestroy {
  
  public availableBots = [
    { 
      name: 'Bot Populador', 
      type: 'populate', 
      icon: 'server-outline', 
      color: 'primary',
      description: 'Scraping real no Mercado Livre -> Cadastro de Usuários -> Publicação de Anúncios.', 
      config: { keyword: '', count: null }, 
      script: 'populate-bot.js' 
    },
    { 
      name: 'Bot Comprador', 
      type: 'buyer', 
      icon: 'cart-outline', 
      color: 'success',
      description: 'Cria Comprador -> Navega -> Adiciona itens de lojas diferentes -> Checkout Automático.', 
      config: { count: null }, 
      script: 'buyer-bot.js' 
    }
  ];

  public queue: any[] = [];
  public currentStatus: any = { status: 'idle', message: 'Sistema pronto.' };
  public logs: string[] = [];
  public executionMode: 'batch' | 'alternate' = 'batch';
  private statusSub?: Subscription;

  constructor(private http: HttpClient) { }

  ngOnInit() {
    // Polling de status a cada 2 segundos
    this.statusSub = interval(2000).subscribe(() => this.updateStatus());
  }

  ngOnDestroy() {
    this.statusSub?.unsubscribe();
  }

  addToQueue(bot: any) {
    this.queue.push({ ...bot });
  }

  removeFromQueue(index: number) {
    this.queue.splice(index, 1);
  }

  runCascade() {
    if (this.queue.length === 0) return;
    
    let botsToRun = [...this.queue];

    if (this.executionMode === 'alternate') {
      const populators = botsToRun.filter(b => b.type === 'populate');
      const buyers = botsToRun.filter(b => b.type === 'buyer');
      const alternated = [];
      const maxLength = Math.max(populators.length, buyers.length);
      
      for (let i = 0; i < maxLength; i++) {
        if (populators[i]) alternated.push(populators[i]);
        if (buyers[i]) alternated.push(buyers[i]);
      }
      botsToRun = alternated;
    }
    
    this.http.post('http://localhost:3001/run-bots', { bots: botsToRun }).subscribe({
      next: () => {
        this.queue = [];
      },
      error: (err) => {
        console.error('Erro ao iniciar bots. O servidor bot-server.js está rodando?', err);
      }
    });
  }

  updateStatus() {
    this.http.get('http://localhost:3001/status').subscribe({
      next: (res: any) => {
        this.currentStatus = res;
        this.logs = res.logs || [];
      },
      error: () => {
        this.currentStatus = { status: 'offline', message: 'Bot Server (3001) Offline' };
      }
    });
  }

  clearLogs() {
    this.http.post('http://localhost:3001/clear-logs', {}).subscribe();
  }
}
