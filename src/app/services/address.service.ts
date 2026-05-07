import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { initializeApp, getApp, getApps } from 'firebase/app';

import { environment } from '../../environments/environment';
const firebaseConfig = environment.firebase;

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
  private db;
  private auth = getAuth();
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

  private addressesSubject = new BehaviorSubject<Address[]>(this.loadFromStorage() || []);
  addresses$ = this.addressesSubject.asObservable();

  constructor() {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    this.db = getFirestore(app);
    this.initSync();
  }

  private initSync() {
    this.auth.onAuthStateChanged(user => {
      if (user) {
        const addrCol = collection(this.db, 'users', user.uid, 'addresses');
        onSnapshot(addrCol, (snapshot) => {
          const cloudAddresses: Address[] = [];
          snapshot.forEach(d => cloudAddresses.push({ id: d.id, ...d.data() } as Address));
          if (cloudAddresses.length > 0) {
            this.saveToStorage(cloudAddresses);
          }
        });
      }
    });
  }

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
    this.syncToCloud(address);
  }

  private async syncToCloud(address: Address) {
    const user = this.auth.currentUser;
    if (!user) return;
    try {
      const addrRef = doc(this.db, 'users', user.uid, 'addresses', address.id);
      await setDoc(addrRef, address);
    } catch (e) {
      console.error('Error syncing to cloud:', e);
    }
  }

  private async removeFromCloud(id: string) {
    const user = this.auth.currentUser;
    if (!user) return;
    try {
      const addrRef = doc(this.db, 'users', user.uid, 'addresses', id);
      await deleteDoc(addrRef);
    } catch (e) {
      console.error('Error removing from cloud:', e);
    }
  }

  updateAddress(address: Address) {
    const current = this.getAddressesValue();
    const index = current.findIndex(a => a.id === address.id);
    if (index !== -1) {
      current[index] = address;
      this.saveToStorage([...current]);
      this.syncToCloud(address);
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
    this.removeFromCloud(id);
  }

  setDefault(id: string) {
    const current = this.getAddressesValue();
    const newList = current.map(a => ({
      ...a,
      isDefault: a.id === id
    }));
    this.saveToStorage(newList);
    // Sincroniza todos para garantir que a flag isDefault está correta no Firestore
    newList.forEach(a => this.syncToCloud(a));
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
