import { Directive, ElementRef, HostListener, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { formatPriceInput, parsePriceInput } from '../core/product-pricing';

/**
 * Campo de dinheiro em reais: `<input type="text" inputmode="decimal" appPriceInput formControlName="price">`.
 *
 * O controle guarda número (ou `null`) e o campo aceita o que o brasileiro
 * digita: "3.200", "3.200,50", "3200,50". `type="number"` lê "3.200" como 3,2:
 * o anúncio de R$ 3.200 ia ao ar por R$ 3,20. Ao sair do campo, mostra o valor
 * como foi entendido ("3.200,00").
 */
@Directive({
  selector: 'input[appPriceInput]',
  standalone: true,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PriceInputDirective), multi: true }],
})
export class PriceInputDirective implements ControlValueAccessor {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private value: number | null = null;
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  @HostListener('input')
  handleInput() {
    this.value = parsePriceInput(this.input.value);
    this.onChange(this.value);
  }

  @HostListener('blur')
  handleBlur() {
    this.input.value = formatPriceInput(this.value);
    this.onTouched();
  }

  writeValue(value: unknown) {
    const parsed = Number(value);
    this.value = value != null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    // Não reescreve o que está sendo digitado (ex.: `[ngModel]` devolvendo o valor).
    if (document.activeElement !== this.input) this.input.value = formatPriceInput(this.value);
  }

  registerOnChange(fn: (value: number | null) => void) {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean) {
    this.input.disabled = disabled;
  }
}
