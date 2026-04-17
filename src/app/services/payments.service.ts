import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface PaymentCard {
  id: string;
  brand: 'visa' | 'mastercard' | 'amex' | 'elo';
  lastFour: string;
  expiryDate: string;
  holderName: string;
  color: string;
  isDefault: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PaymentsService {
  private initialCards: PaymentCard[] = [
    {
      id: '1',
      brand: 'visa',
      lastFour: '4242',
      expiryDate: '12/26',
      holderName: 'USUARIO COMPRAKI',
      color: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
      isDefault: true
    },
    {
      id: '2',
      brand: 'mastercard',
      lastFour: '8888',
      expiryDate: '08/25',
      holderName: 'USUARIO COMPRAKI',
      color: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
      isDefault: false
    }
  ];

  private cardsSubject = new BehaviorSubject<PaymentCard[]>(this.loadFromStorage() || this.initialCards);
  cards$ = this.cardsSubject.asObservable();

  constructor() { }

  private loadFromStorage(): PaymentCard[] | null {
    const data = localStorage.getItem('compraki_payments');
    return data ? JSON.parse(data) : null;
  }

  private saveToStorage(cards: PaymentCard[]) {
    localStorage.setItem('compraki_payments', JSON.stringify(cards));
    this.cardsSubject.next(cards);
  }

  getCardsValue(): PaymentCard[] {
    return this.cardsSubject.value;
  }

  addCard(card: PaymentCard) {
    const current = this.getCardsValue();
    const newList = [...current, card];
    this.saveToStorage(newList);
  }

  deleteCard(id: string) {
    const current = this.getCardsValue();
    const newList = current.filter(c => c.id !== id);
    
    if (newList.length > 0 && !newList.find(c => c.isDefault)) {
      newList[0].isDefault = true;
    }
    
    this.saveToStorage(newList);
  }

  setDefault(id: string) {
    const current = this.getCardsValue();
    const newList = current.map(c => ({
      ...c,
      isDefault: c.id === id
    }));
    this.saveToStorage(newList);
  }
}
