import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { 
  card, add, trash, chevronForward, 
  checkmarkCircle, calendar, person,
  barcode, grid
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { MiniHeaderComponent } from '../../components/mini-header/mini-header.component';
import { PaymentsService, PaymentCard } from '../../services/payments.service';

@Component({
  selector: 'app-payments',
  templateUrl: './payments.page.html',
  styleUrls: ['./payments.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MiniHeaderComponent
  ]
})
export class PaymentsPage implements OnInit, OnDestroy {
  cards: PaymentCard[] = [];
  private sub!: Subscription;

  private paymentsService = inject(PaymentsService);
  private alertCtrl = inject(AlertController);

  constructor() {
    addIcons({ 
      card, add, trash, chevronForward, 
      checkmarkCircle, calendar, person,
      barcode, grid
    });
  }

  ngOnInit() {
    this.sub = this.paymentsService.cards$.subscribe(cards => {
      this.cards = cards;
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  setDefault(cardId: string) {
    this.paymentsService.setDefault(cardId);
  }

  async deleteCard(cardId: string) {
    const alert = await this.alertCtrl.create({
      header: 'Excluir Cartão',
      message: 'Tem certeza que deseja remover este cartão?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { 
          text: 'Excluir', 
          role: 'destructive',
          handler: () => this.paymentsService.deleteCard(cardId)
        }
      ]
    });
    await alert.present();
  }

  isModalOpen = false;
  newCardData = {
    number: '',
    holderName: '',
    expiry: '',
    ccv: ''
  };

  addNewCard() {
    this.isModalOpen = true;
  }

  saveNewCard() {
    if (!this.newCardData.number || !this.newCardData.holderName) {
      return;
    }
    const lastFour = this.newCardData.number.replace(/\D/g, '').slice(-4);
    // Para simplificar a brand, pegamos Visa se começar com 4, Mastercard se 5, senao Elo
    const firstDigit = this.newCardData.number.charAt(0);
    const brand = firstDigit === '4' ? 'visa' : (firstDigit === '5' ? 'mastercard' : 'elo');
    const color = brand === 'visa' ? 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)' :
                  (brand === 'mastercard' ? 'linear-gradient(135deg, #232526 0%, #414345 100%)' : 'linear-gradient(135deg, #799d50 0%, #a2c182 100%)');

    const newCard: PaymentCard = {
      id: Math.random().toString(36).substr(2, 9),
      brand: brand,
      lastFour: lastFour || '0000',
      expiryDate: this.newCardData.expiry || '00/00',
      holderName: this.newCardData.holderName,
      color: color,
      isDefault: this.cards.length === 0
    };
    
    // We shouldn't store full CC info in localstorage normally, but for the sake of demo we just store base info 
    // Wait, to make checkout work the user might select this card.
    // If they select this card, we need the full number in checkout. 
    // In a real app we'd tokenize in Asaas and store the Token.
    
    this.paymentsService.addCard(newCard);
    
    this.isModalOpen = false;
    this.newCardData = { number: '', holderName: '', expiry: '', ccv: '' };
  }
}
