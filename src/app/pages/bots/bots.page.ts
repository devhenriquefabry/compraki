import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { interval, Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import { BotMonitorService } from 'src/app/services/bot-monitor.service';

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
    },
    { 
      name: 'Bot Desenrolado', 
      type: 'chat', 
      icon: 'chatbubbles-outline', 
      color: 'warning',
      description: 'Simulação de Auditoria: Abre 2 navegadores (Vendedor e Comprador) e gera conversa infinita via IA.', 
      config: { count: 1 }, 
      script: 'bot-desenrolado.js' 
    }
  ];

  public queue: any[] = [];
  public currentStatus: any = { status: 'idle', message: 'Sistema pronto.' };
  public logs: string[] = [];
  public executionMode: 'batch' | 'alternate' = 'batch';
  public isHeadless: boolean = true; // Padrão invisível para não atrapalhar
  private statusSub?: Subscription;

  constructor(
    private http: HttpClient,
    public botMonitor: BotMonitorService
  ) { }

  ngOnInit() {
    // Polling global via serviço
    this.statusSub = this.botMonitor.status$.subscribe(s => {
      this.currentStatus = s;
      this.logs = s.logs || [];
    });
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
    
    const botsWithConfig = botsToRun.map(b => ({
      ...b,
      config: { ...b.config, headless: this.isHeadless }
    }));
    
    this.http.post('http://localhost:3001/run-bots', { bots: botsWithConfig }).subscribe({
      next: () => {
        this.queue = [];
      },
      error: (err) => {
        console.error('Erro ao iniciar bots. O servidor bot-server.js está rodando?', err);
      }
    });
  }

  updateStatus() {
    // Agora o status vem via BotMonitorService (Subscrito no ngOnInit)
  }

  clearLogs() {
    this.http.post('http://localhost:3001/clear-logs', {}).subscribe();
  }
}
