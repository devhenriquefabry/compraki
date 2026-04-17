import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface Address {
  id: string;
  type: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AddressService {
  private initialAddresses: Address[] = [
    {
      id: '1',
      type: 'Casa',
      street: 'Rua das Flores',
      number: '123',
      complement: 'Apto 42',
      neighborhood: 'Jardins',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01234-567',
      isDefault: true
    },
    {
      id: '2',
      type: 'Trabalho',
      street: 'Av. Paulista',
      number: '1000',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01310-100',
      isDefault: false
    }
  ];

  private addressesSubject = new BehaviorSubject<Address[]>(this.loadFromStorage() || this.initialAddresses);
  addresses$ = this.addressesSubject.asObservable();

  constructor() { }

  private loadFromStorage(): Address[] | null {
    const data = localStorage.getItem('compraki_addresses');
    return data ? JSON.parse(data) : null;
  }

  private saveToStorage(addresses: Address[]) {
    localStorage.setItem('compraki_addresses', JSON.stringify(addresses));
    this.addressesSubject.next(addresses);
  }

  getAddressesValue(): Address[] {
    return this.addressesSubject.value;
  }

  addAddress(address: Address) {
    const current = this.getAddressesValue();
    const newList = [...current, address];
    
    // Se for o primeiro, torna padrão
    if (newList.length === 1) {
      newList[0].isDefault = true;
    }
    
    this.saveToStorage(newList);
  }

  updateAddress(address: Address) {
    const current = this.getAddressesValue();
    const index = current.findIndex(a => a.id === address.id);
    if (index !== -1) {
      current[index] = address;
      this.saveToStorage([...current]);
    }
  }

  deleteAddress(id: string) {
    const current = this.getAddressesValue();
    const newList = current.filter(a => a.id !== id);
    
    // Se removeu o padrão e ainda tem itens, torna o primeiro padrão
    if (newList.length > 0 && !newList.find(a => a.isDefault)) {
      newList[0].isDefault = true;
    }
    
    this.saveToStorage(newList);
  }

  setDefault(id: string) {
    const current = this.getAddressesValue();
    const newList = current.map(a => ({
      ...a,
      isDefault: a.id === id
    }));
    this.saveToStorage(newList);
  }

  async getCEP(cep: string): Promise<any> {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8) {
      throw new Error('CEP inválido');
    }

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
      const data = await response.json();
      
      if (data.erro) {
        throw new Error('CEP não encontrado');
      }
      
      return data;
    } catch (error) {
      console.error('Erro ao buscar CEP:', error);
      throw error;
    }
  }
}
