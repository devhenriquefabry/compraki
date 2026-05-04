import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { 
  settingsOutline, refreshOutline, saveOutline, keyOutline, businessOutline, 
  calculatorOutline, statsChartOutline, pieChartOutline, informationCircleOutline,
  openOutline, alertCircleOutline, personCircleOutline
} from 'ionicons/icons';
import { MelhorEnvioService } from '../../services/melhor-envio.service';
import { MelhorEnvioConfig, ShippingAnalysis, ShippingQuote } from '../../interfaces/shipping';
import { AdminPanelHeroComponent } from '../../components/admin-panel-hero/admin-panel-hero.component';

@Component({
  selector: 'app-melhor-envio',
  templateUrl: './melhor-envio.page.html',
  styleUrls: ['./melhor-envio.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, AdminPanelHeroComponent]
})
export class MelhorEnvioPage implements OnInit {
  public config: MelhorEnvioConfig = {
    accessToken: '',
    isSandbox: false,
    senderName: '',
    senderPhone: '',
    senderEmail: '',
    senderCpfCnpj: '',
    address: {
      street: '',
      number: '',
      district: '',
      city: '',
      state: '',
      zipCode: ''
    }
  };

  public analysis: ShippingAnalysis = {
    totalSpent: 0,
    totalLabelsGenerated: 0,
    averageCost: 0,
    statusSummary: { pending: 0, released: 0, posted: 0, delivered: 0, cancelled: 0 },
    carrierPerformance: []
  };

  public calcZipTo: string = '';
  public calcWeight: number = 0.5;
  public quotes: ShippingQuote[] = [];
  public hasConfig: boolean = false;

  constructor(
    private melhorEnvioService: MelhorEnvioService,
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController
  ) {
    addIcons({
      settingsOutline, refreshOutline, saveOutline, keyOutline, businessOutline,
      calculatorOutline, statsChartOutline, pieChartOutline, informationCircleOutline,
      openOutline, alertCircleOutline, personCircleOutline
    });
  }

  ngOnInit() {
    this.loadConfig();
  }



  async loadConfig() {
    this.melhorEnvioService.getConfig().subscribe(config => {
      if (config) {
        this.config = config;
        this.hasConfig = true;
        this.refreshData();
      }
    });
  }

  async refreshData() {
    if (!this.config.accessToken) return;

    const loading = await this.loadingCtrl.create({
      message: 'Sincronizando com Melhor Envio...',
      mode: 'ios'
    });
    await loading.present();

    this.melhorEnvioService.getAnalysis(this.config).subscribe({
      next: (analysis) => {
        this.analysis = analysis;
        loading.dismiss();
      },
      error: (err) => {
        console.error('Erro detalhado da API Melhor Envio:', err);
        if (err.error instanceof ErrorEvent) {
          console.error('Erro no lado do cliente:', err.error.message);
        } else {
          console.error(`Código do erro: ${err.status}, corpo:`, err.error);
        }
        this.showToast('Erro ao carregar análises. Verifique seu token e a aba Network do navegador.', 'danger');
        loading.dismiss();
      }
    });
  }

  async saveSettings() {
    const loading = await this.loadingCtrl.create({ message: 'Salvando...', mode: 'ios' });
    await loading.present();

    this.melhorEnvioService.saveConfig(this.config).subscribe({
      next: () => {
        this.hasConfig = true;
        this.showToast('Configurações salvas e persistidas no Firestore!');
        loading.dismiss();
        this.refreshData();
      },
      error: () => {
        this.showToast('Erro ao salvar no Firestore.', 'danger');
        loading.dismiss();
      }
    });
  }

  async checkAccount() {
    this.melhorEnvioService.getUserInfo(this.config).subscribe({
      next: (user) => {
        console.log('Dados do usuário Melhor Envio:', user);
        this.showToast(`Conectado como: ${user.firstname || 'Usuário'}`);
      },
      error: (err) => console.error('Erro ao verificar conta:', err)
    });
  }

  async calculateShipping() {
    if (!this.calcZipTo || this.calcZipTo.length < 8) {
      this.showToast('Insira um CEP de destino válido.', 'warning');
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Consultando API Melhor Envio...',
      mode: 'ios'
    });
    await loading.present();

    const products = [{
      id: 'test',
      weight: this.calcWeight || 0.1,
      width: 10,
      height: 10,
      length: 15,
      price: 100,
      quantity: 1
    }];

    this.melhorEnvioService.getQuotes(this.config, this.calcZipTo, products).subscribe({
      next: (quotes) => {
        this.quotes = quotes;
        loading.dismiss();
        if (quotes.length === 0) this.showToast('Nenhuma transportadora disponível para este trecho.', 'warning');
      },
      error: (err) => {
        console.error(err);
        this.showToast('Erro na API do Melhor Envio. Verifique seu Token.', 'danger');
        loading.dismiss();
      }
    });
  }

  openLink(url: string) {
    window.open(url, '_blank');
  }

  async showToast(message: string, color: string = 'success') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }
}
