import { Component, ElementRef, Input, OnInit, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircle, briefcaseOutline, checkmarkCircle, closeOutline, homeOutline, locationOutline, openOutline,
} from 'ionicons/icons';
import { Address, AddressService } from '../../services/address.service';

type CepState = 'idle' | 'loading' | 'found' | 'generic' | 'not-found' | 'error';

const PRESET_TYPES = ['Casa', 'Trabalho'];

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

/**
 * Formulário de endereço (criar e editar).
 *
 * Começa pelo CEP: o ViaCEP devolve rua, bairro, cidade e UF, e a pessoa só
 * completa número e complemento. CEP geral de cidade pequena (sem rua) deixa
 * rua e bairro livres. O modal devolve o endereço pronto no `dismiss`; quem
 * grava é a página, pelo AddressService.
 */
@Component({
  selector: 'app-address-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule],
  templateUrl: './address-modal.component.html',
  styleUrls: ['./address-modal.component.scss'],
})
export class AddressModalComponent implements OnInit {
  @Input() address: Partial<Address> | null = null;
  @Input() isEdit = false;
  /** Quando é o primeiro endereço da conta, ele vira padrão de qualquer jeito. */
  @Input() isFirst = false;

  private readonly fb = inject(FormBuilder);
  private readonly modalCtrl = inject(ModalController);
  private readonly addressService = inject(AddressService);

  readonly ufs = UFS;
  readonly presetTypes = PRESET_TYPES;
  readonly cepState = signal<CepState>('idle');
  readonly cepCity = signal('');
  readonly submitted = signal(false);
  readonly kind = signal<'Casa' | 'Trabalho' | 'Outro'>('Casa');

  private readonly numberInput = viewChild<ElementRef<HTMLInputElement>>('numberInput');
  private lastCep = '';

  form!: FormGroup;

  constructor() {
    addIcons({ alertCircle, briefcaseOutline, checkmarkCircle, closeOutline, homeOutline, locationOutline, openOutline });
  }

  ngOnInit() {
    const a = this.address ?? {};
    const type = a.type || 'Casa';
    this.kind.set(PRESET_TYPES.includes(type) ? (type as 'Casa' | 'Trabalho') : 'Outro');

    this.form = this.fb.group({
      id: [a.id || ''],
      customType: [PRESET_TYPES.includes(type) ? '' : type, [Validators.maxLength(30)]],
      zipCode: [formatCep(a.zipCode || ''), [Validators.required, Validators.pattern(/^\d{5}-\d{3}$/)]],
      street: [a.street || '', [Validators.required, Validators.maxLength(120)]],
      number: [a.number || '', [Validators.required, Validators.maxLength(10)]],
      noNumber: [a.number === 'S/N'],
      complement: [a.complement || '', [Validators.maxLength(60)]],
      reference: [a.reference || '', [Validators.maxLength(80)]],
      neighborhood: [a.neighborhood || '', [Validators.required, Validators.maxLength(80)]],
      city: [a.city || '', [Validators.required, Validators.maxLength(80)]],
      state: [(a.state || '').toUpperCase(), [Validators.required, Validators.pattern(/^[A-Z]{2}$/)]],
      isDefault: [!!a.isDefault || this.isFirst],
    });

    if (a.number === 'S/N') this.form.get('number')!.disable();
    if (this.isEdit && a.city) {
      this.cepState.set('found');
      this.cepCity.set(`${a.city}/${a.state}`);
      this.lastCep = (a.zipCode || '').replace(/\D/g, '');
    }
  }

  // ------------------------------------------------------------------ CEP

  onCepInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const formatted = formatCep(input.value);
    if (formatted !== input.value) input.value = formatted;
    this.form.get('zipCode')!.setValue(formatted, { emitEvent: false });

    const digits = formatted.replace(/\D/g, '');
    if (digits.length === 8 && digits !== this.lastCep) void this.lookupCep(digits);
    if (digits.length < 8) this.cepState.set('idle');
  }

  private async lookupCep(digits: string) {
    this.lastCep = digits;
    this.cepState.set('loading');
    try {
      const data = await this.addressService.getCEP(digits);
      if (this.lastCep !== digits) return;
      this.form.patchValue({
        street: data.logradouro || this.form.value.street,
        neighborhood: data.bairro || this.form.value.neighborhood,
        city: data.localidade,
        state: data.uf,
      });
      this.cepCity.set(`${data.localidade}/${data.uf}`);
      // CEP geral (cidade inteira): rua e bairro ficam por conta da pessoa.
      this.cepState.set(data.logradouro ? 'found' : 'generic');
      setTimeout(() => this.numberInput()?.nativeElement.focus(), 50);
    } catch (err: any) {
      if (this.lastCep !== digits) return;
      this.cepState.set(err?.message === 'CEP não encontrado' ? 'not-found' : 'error');
    }
  }

  // --------------------------------------------------------------- campos

  setKind(kind: 'Casa' | 'Trabalho' | 'Outro') {
    this.kind.set(kind);
  }

  toggleNoNumber(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const number = this.form.get('number')!;
    if (checked) {
      number.setValue('S/N');
      number.disable();
    } else {
      number.enable();
      number.setValue('');
      setTimeout(() => this.numberInput()?.nativeElement.focus(), 30);
    }
  }

  onStateInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const upper = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    input.value = upper;
    this.form.get('state')!.setValue(upper);
  }

  /** Mensagem do campo, só depois de tentar salvar ou de sair do campo. */
  error(name: string): string | null {
    const c: AbstractControl | null = this.form.get(name);
    if (!c || c.disabled || c.valid || !(c.touched || this.submitted())) return null;
    if (c.hasError('required')) {
      return {
        zipCode: 'Informe o CEP.',
        street: 'Informe a rua.',
        number: 'Informe o número ou marque "Sem número".',
        neighborhood: 'Informe o bairro.',
        city: 'Informe a cidade.',
        state: 'Informe a UF.',
      }[name] ?? 'Campo obrigatório.';
    }
    if (c.hasError('pattern')) return name === 'zipCode' ? 'CEP tem 8 dígitos.' : 'Use a sigla, ex.: MG.';
    if (c.hasError('maxlength')) return 'Texto longo demais.';
    return null;
  }

  // ---------------------------------------------------------------- ações

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  save() {
    this.submitted.set(true);
    const kind = this.kind();
    const customType = (this.form.value.customType || '').trim();
    const missingName = kind === 'Outro' && !customType;
    if (this.form.invalid || missingName) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    const address: Address = {
      id: v.id,
      type: kind === 'Outro' ? customType : kind,
      zipCode: v.zipCode,
      street: v.street.trim(),
      number: v.noNumber ? 'S/N' : String(v.number).trim(),
      complement: v.complement,
      reference: v.reference,
      neighborhood: v.neighborhood.trim(),
      city: v.city.trim(),
      state: v.state.toUpperCase(),
      isDefault: !!v.isDefault,
    };
    this.modalCtrl.dismiss(address, 'save');
  }
}

function formatCep(value: string): string {
  const d = (value || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
