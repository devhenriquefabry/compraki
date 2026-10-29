import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { LOCAL_DELIVERY_DAYS, LOCAL_DELIVERY_LIMITS, cityKey } from 'src/app/core/local-delivery';
import { DeliveryCity, LocalDelivery } from 'src/app/interfaces/product';
import { AddressService } from 'src/app/services/address.service';

const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
  'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

/** Municípios de cada UF (IBGE), para a cidade sair com o nome oficial. */
const ibgeCache = new Map<string, Promise<string[]>>();

function ibgeCities(uf: string): Promise<string[]> {
  let cached = ibgeCache.get(uf);
  if (!cached) {
    cached = fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`)
      .then(response => (response.ok ? response.json() : []))
      .then((list: { nome?: string }[]) => (Array.isArray(list) ? list.map(c => String(c?.nome || '')).filter(Boolean) : []))
      .catch(() => []);
    // Falhou (sem internet, IBGE fora): tenta de novo na próxima vez.
    void cached.then(list => { if (!list.length) ibgeCache.delete(uf); });
    ibgeCache.set(uf, cached);
  }
  return cached;
}

/**
 * "Entrega grátis da loja" no anúncio (criar e editar): a loja escolhe as
 * cidades onde ela mesma entrega, o prazo e se também envia por
 * transportadora para o resto do Brasil. `value` é `null` com a opção
 * desligada; ligada, pode ficar sem cidade enquanto a pessoa preenche (o
 * formulário trava a publicação até ter uma).
 */
@Component({
  selector: 'app-local-delivery-editor',
  templateUrl: './local-delivery-editor.component.html',
  styleUrls: ['./local-delivery-editor.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocalDeliveryEditorComponent {
  readonly value = model<LocalDelivery | null>(null);

  readonly ufs = UFS;
  readonly dayOptions = LOCAL_DELIVERY_DAYS;
  readonly maxCities = LOCAL_DELIVERY_LIMITS.cities;

  private readonly addresses = toSignal(inject(AddressService).addresses$, { initialValue: [] });

  readonly enabled = computed(() => this.value() !== null);
  readonly cities = computed(() => this.value()?.cities ?? []);

  /** Cidade do endereço padrão da loja, se ainda não está na lista. */
  readonly suggestion = computed<DeliveryCity | null>(() => {
    const list = this.addresses();
    const main = list.find(a => a.isDefault) ?? list[0];
    if (!main?.city || !main?.state) return null;
    const city = { city: main.city.trim(), state: main.state.trim().toUpperCase() };
    const taken = new Set(this.cities().map(c => cityKey(c.city, c.state)));
    return taken.has(cityKey(city.city, city.state)) ? null : city;
  });

  readonly uf = signal('');
  readonly cityInput = signal('');
  readonly ufCities = signal<string[]>([]);
  readonly addError = signal('');

  /** Última configuração ligada: desligar e ligar de novo não perde as cidades. */
  private lastOn: LocalDelivery | null = null;

  toggle() {
    const current = this.value();
    if (current) {
      this.lastOn = current;
      this.value.set(null);
      return;
    }
    const first = this.suggestion();
    this.value.set(this.lastOn ?? { cities: first ? [first] : [], days: 1, onlyLocal: false });
    const uf = this.value()!.cities[0]?.state ?? first?.state ?? '';
    if (uf && !this.uf()) this.setUf(uf);
  }

  setUf(uf: string) {
    this.uf.set(uf);
    this.addError.set('');
    this.ufCities.set([]);
    if (!uf) return;
    void ibgeCities(uf).then(list => { if (this.uf() === uf) this.ufCities.set(list); });
  }

  addCity(city: DeliveryCity) {
    const current = this.value();
    if (!current) return;
    if (current.cities.length >= this.maxCities) {
      this.addError.set(`Até ${this.maxCities} cidades por anúncio.`);
      return;
    }
    const key = cityKey(city.city, city.state);
    if (current.cities.some(c => cityKey(c.city, c.state) === key)) {
      this.addError.set(`${city.city}/${city.state} já está na lista.`);
      return;
    }
    this.addError.set('');
    this.value.set({ ...current, cities: [...current.cities, city] });
  }

  /** Cidade digitada: com a lista do IBGE carregada, só entra nome que existe (e com a grafia oficial). */
  async addTyped() {
    const typed = this.cityInput().replace(/\s+/g, ' ').trim();
    const uf = this.uf();
    if (!uf) { this.addError.set('Escolha a UF antes da cidade.'); return; }
    if (typed.length < 2) { this.addError.set('Digite o nome da cidade.'); return; }

    const official = await ibgeCities(uf);
    let name = typed;
    if (official.length) {
      const match = official.find(n => cityKey(n, uf) === cityKey(typed, uf));
      if (!match) {
        this.addError.set(`Não achamos "${typed}" em ${uf}. Confira a grafia ou escolha da lista.`);
        return;
      }
      name = match;
    }
    this.addCity({ city: name, state: uf });
    if (!this.addError()) this.cityInput.set('');
  }

  removeCity(city: DeliveryCity) {
    const current = this.value();
    if (!current) return;
    const key = cityKey(city.city, city.state);
    this.value.set({ ...current, cities: current.cities.filter(c => cityKey(c.city, c.state) !== key) });
  }

  setDays(days: number) {
    const current = this.value();
    if (current) this.value.set({ ...current, days });
  }

  setOnlyLocal(onlyLocal: boolean) {
    const current = this.value();
    if (current) this.value.set({ ...current, onlyLocal });
  }

  dayLabel(days: number): string {
    if (days === 0) return 'Mesmo dia';
    return `${days} ${days === 1 ? 'dia útil' : 'dias úteis'}`;
  }

  cityTrack(city: DeliveryCity): string {
    return cityKey(city.city, city.state);
  }
}
