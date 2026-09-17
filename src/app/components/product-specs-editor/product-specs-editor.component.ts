import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ProductSpec } from '../../interfaces/product';

/** Campos que quase todo anúncio tem; viram atalhos de um clique. */
const SUGGESTED_LABELS = ['Marca', 'Modelo', 'Cor', 'Material', 'Voltagem', 'Tamanho', 'Garantia', 'Itens inclusos'];
const MAX_SPECS = 20;

/**
 * Editor da ficha técnica ("Características do produto").
 *
 * Controlado: recebe a lista e emite a lista nova a cada mudança, para os
 * formulários de anunciar e de editar guardarem em `specs` do produto.
 */
@Component({
  selector: 'app-product-specs-editor',
  templateUrl: './product-specs-editor.component.html',
  styleUrls: ['./product-specs-editor.component.scss'],
  standalone: true,
  imports: [IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductSpecsEditorComponent {
  readonly specs = input<ProductSpec[] | null | undefined>([]);
  readonly specsChange = output<ProductSpec[]>();

  readonly maxSpecs = MAX_SPECS;
  readonly rows = computed(() => this.specs() || []);
  readonly suggestions = computed(() => {
    const used = new Set(this.rows().map(r => (r.label || '').trim().toLowerCase()));
    return SUGGESTED_LABELS.filter(label => !used.has(label.toLowerCase()));
  });

  add(label = '') {
    if (this.rows().length >= MAX_SPECS) return;
    this.specsChange.emit([...this.rows(), { label, value: '' }]);
  }

  update(index: number, field: keyof ProductSpec, event: Event) {
    const value = (event.target as HTMLInputElement).value.slice(0, 80);
    this.specsChange.emit(this.rows().map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  remove(index: number) {
    this.specsChange.emit(this.rows().filter((_, i) => i !== index));
  }
}

/** Limpa a lista antes de salvar: sem linhas vazias nem espaços sobrando. */
export function cleanSpecs(specs: ProductSpec[] | null | undefined): ProductSpec[] {
  return (specs || [])
    .map(s => ({ label: (s.label || '').trim(), value: (s.value || '').trim() }))
    .filter(s => s.label && s.value)
    .slice(0, MAX_SPECS);
}
