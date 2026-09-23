import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { collection, doc, getFirestore, onSnapshot, writeBatch, Firestore } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { initializeApp, getApp, getApps } from 'firebase/app';

import { environment } from '../../environments/environment';

export interface Address {
  id: string;
  /** Rótulo livre: "Casa", "Trabalho" ou um nome que a pessoa escolheu ("Casa da mãe"). */
  type: string;
  street: string;
  number: string;
  complement?: string;
  /** Ponto de referência para o entregador. */
  reference?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault: boolean;
}

/** Chave antiga, sem separação por conta. Apagada na primeira sincronização. */
const LEGACY_STORAGE_KEY = 'compraki_addresses';
const storageKey = (uid: string) => `vineon_addresses_${uid}`;

/**
 * Endereços de entrega em `users/{uid}/addresses`.
 *
 * O Firestore é a fonte da verdade; o localStorage só serve para a tela abrir
 * com a lista na hora, e é separado por conta (antes era uma chave só, e quem
 * entrasse no mesmo aparelho via os endereços da conta anterior).
 */
@Injectable({
  providedIn: 'root'
})
export class AddressService {
  private readonly db: Firestore;
  private readonly auth;
  private uid: string | null = null;
  private stopSnapshot?: () => void;

  private readonly addressesSubject = new BehaviorSubject<Address[]>([]);
  readonly addresses$ = this.addressesSubject.asObservable();

  /** Já chegou a primeira resposta (cache local ou servidor) para a conta atual. */
  private readonly loadedSubject = new BehaviorSubject<boolean>(false);
  readonly loaded$ = this.loadedSubject.asObservable();

  constructor() {
    const app = getApps().length === 0 ? initializeApp(environment.firebase) : getApp();
    this.db = getFirestore(app);
    this.auth = getAuth(app);
    this.clearLegacyStorage();
    onAuthStateChanged(this.auth, user => this.bindUser(user?.uid ?? null));
  }

  private bindUser(uid: string | null) {
    if (uid === this.uid) return;
    this.stopSnapshot?.();
    this.stopSnapshot = undefined;
    this.uid = uid;

    if (!uid) {
      this.addressesSubject.next([]);
      this.loadedSubject.next(true);
      return;
    }

    const cached = this.readCache(uid);
    this.addressesSubject.next(cached ?? []);
    this.loadedSubject.next(cached !== null);

    this.stopSnapshot = onSnapshot(
      collection(this.db, 'users', uid, 'addresses'),
      snapshot => {
        const list = snapshot.docs.map(d => ({ ...(d.data() as Address), id: d.id }));
        this.publish(uid, sortAddresses(list));
      },
      err => {
        console.error('Falha ao sincronizar endereços', err);
        this.loadedSubject.next(true);
      }
    );
  }

  private publish(uid: string, list: Address[]) {
    if (uid !== this.uid) return;
    this.addressesSubject.next(list);
    this.loadedSubject.next(true);
    try {
      localStorage.setItem(storageKey(uid), JSON.stringify(list));
    } catch {
      // Sem armazenamento local (modo privado): segue só com o Firestore.
    }
  }

  private readCache(uid: string): Address[] | null {
    try {
      const raw = localStorage.getItem(storageKey(uid));
      return raw ? (JSON.parse(raw) as Address[]) : null;
    } catch {
      return null;
    }
  }

  private clearLegacyStorage() {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // idem
    }
  }

  private requireUid(): string {
    if (!this.uid) throw new Error('Entre na sua conta para salvar endereços.');
    return this.uid;
  }

  getAddressesValue(): Address[] {
    return this.addressesSubject.value;
  }

  /** Id novo gerado pelo Firestore, para o formulário já saber onde gravar. */
  newId(): string {
    return doc(collection(this.db, 'users', this.requireUid(), 'addresses')).id;
  }

  /**
   * Cria ou atualiza. O primeiro endereço vira padrão; marcar um como padrão
   * desmarca os outros na mesma gravação.
   */
  async saveAddress(input: Address): Promise<void> {
    const uid = this.requireUid();
    const current = this.getAddressesValue();
    const address: Address = cleanAddress({
      ...input,
      id: input.id || this.newId(),
      isDefault: input.isDefault || current.filter(a => a.id !== input.id).length === 0,
    });

    // Atualização otimista: a tela responde na hora, o snapshot confirma.
    const others = current.filter(a => a.id !== address.id).map(a => (address.isDefault ? { ...a, isDefault: false } : a));
    this.publish(uid, sortAddresses([...others, address]));

    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'users', uid, 'addresses', address.id), address);
    if (address.isDefault) {
      for (const a of current) {
        if (a.id !== address.id && a.isDefault) {
          batch.update(doc(this.db, 'users', uid, 'addresses', a.id), { isDefault: false });
        }
      }
    }
    await batch.commit();
  }

  /** Compatível com quem já chamava assim (antes o id vinha de Math.random). */
  addAddress(address: Address) {
    return this.saveAddress({ ...address, id: '' });
  }

  updateAddress(address: Address) {
    return this.saveAddress(address);
  }

  async deleteAddress(id: string): Promise<void> {
    const uid = this.requireUid();
    const current = this.getAddressesValue();
    const removed = current.find(a => a.id === id);
    const rest = current.filter(a => a.id !== id);
    const heir = removed?.isDefault && rest.length ? rest[0] : null;

    this.publish(uid, sortAddresses(rest.map(a => (heir && a.id === heir.id ? { ...a, isDefault: true } : a))));

    const batch = writeBatch(this.db);
    batch.delete(doc(this.db, 'users', uid, 'addresses', id));
    if (heir) batch.update(doc(this.db, 'users', uid, 'addresses', heir.id), { isDefault: true });
    await batch.commit();
  }

  async setDefault(id: string): Promise<void> {
    const target = this.getAddressesValue().find(a => a.id === id);
    if (target && !target.isDefault) await this.saveAddress({ ...target, isDefault: true });
  }

  async getCEP(cep: string): Promise<any> {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8) {
      throw new Error('CEP inválido');
    }

    const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
    const data = await response.json();
    if (data.erro) {
      throw new Error('CEP não encontrado');
    }
    return data;
  }
}

function sortAddresses(list: Address[]): Address[] {
  return [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (a.type || '').localeCompare(b.type || ''));
}

/** Firestore não aceita `undefined`; campos opcionais vazios saem do documento. */
function cleanAddress(a: Address): Address {
  const out: any = { ...a, state: (a.state || '').toUpperCase() };
  for (const key of ['complement', 'reference'] as const) {
    if (!out[key]?.trim()) delete out[key];
    else out[key] = out[key].trim();
  }
  return out as Address;
}
