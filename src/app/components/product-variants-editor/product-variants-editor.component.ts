import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ProductSku, ProductVariantAttribute } from '../../interfaces/product';
import { MAX_VARIANT_ATTRIBUTES, cartesianCombinations, skuKey } from '../../core/product-variants';

/** Nomes mais comuns, viram atalhos de um clique ao adicionar um atributo. */
const SUGGESTED_ATTRIBUTES = ['Cor', 'Tamanho', 'Voltagem'];
const MAX_VALUES_PER_ATTRIBUTE = 30;

interface SkuRow {
  id: string;
  attributes: Record<string, string>;
  price: number | null;
  stock: number;
}

/**
 * Editor de variações (cor, tamanho...), no molde Mercado Livre/Shopee.
 *
 * Controlado, como o `ProductSpecsEditorComponent`: recebe o estado e emite o
 * próximo a cada mudança. O formulário de anunciar/editar guarda o resultado
 * em `hasVariants` / `variantAttributes` / `variantImages` / `skus` do produto.
 *
 * A matriz de combinações (`rows`) é sempre recalculada a partir dos
 * atributos atuais (produto cartesiano) — nunca editada diretamente — para
 * que ela nunca fique fora de sincronia com os valores cadastrados.
 */
@Component({
  selector: 'app-product-variants-editor',
  templateUrl: './product-variants-editor.component.html',
  styleUrls: ['./product-variants-editor.component.scss'],
  standalone: true,
  imports: [IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductVariantsEditorComponent {
  readonly hasVariants = input(false);
  readonly attributes = input<ProductVariantAttribute[]>([]);
  readonly skus = input<Record<string, ProductSku>>({});
  readonly variantImages = input<Record<string, string>>({});
  readonly availablePhotos = input<string[]>([]);
  readonly basePrice = input<number | null>(null);

  readonly hasVariantsChange = output<boolean>();
  readonly attributesChange = output<ProductVariantAttribute[]>();
  readonly skusChange = output<Record<string, ProductSku>>();
  readonly variantImagesChange = output<Record<string, string>>();

  readonly maxAttributes = MAX_VARIANT_ATTRIBUTES;

  readonly suggestions = computed(() => {
    const used = new Set(this.attributes().map(a => (a.name || '').trim().toLowerCase()));
    return SUGGESTED_ATTRIBUTES.filter(name => !used.has(name.toLowerCase()));
  });

  readonly attributeNames = computed(() => this.attributes().map(a => a.name));

  readonly rows = computed<SkuRow[]>(() => {
    const names = this.attributeNames();
    const skuMap = this.skus();
    return cartesianCombinations(this.attributes()).map(combo => {
      const id = skuKey(names, combo);
      const sku = skuMap[id];
      return { id, attributes: combo, price: sku?.price ?? null, stock: sku?.stock ?? 0 };
    });
  });

  readonly totalStock = computed(() => this.rows().reduce((sum, row) => sum + (row.stock || 0), 0));

  rowLabel(row: SkuRow): string {
    return Object.entries(row.attributes).map(([name, value]) => `${name} ${value}`).join(', ');
  }

  // ------------------------------------------------------------- ativar/desativar

  toggle(on: boolean) {
    this.hasVariantsChange.emit(on);
    if (on && this.attributes().length === 0) {
      this.attributesChange.emit([{ name: '', values: [] }]);
    }
  }

  // ------------------------------------------------------------------ atributos

  addAttribute(name = '') {
    if (this.attributes().length >= this.maxAttributes) return;
    this.attributesChange.emit([...this.attributes(), { name, values: [] }]);
  }

  renameAttribute(index: number, event: Event) {
    const name = (event.target as HTMLInputElement).value.slice(0, 30);
    this.attributesChange.emit(this.attributes().map((a, i) => (i === index ? { ...a, name } : a)));
  }

  removeAttribute(index: number) {
    const removed = this.attributes()[index];
    this.attributesChange.emit(this.attributes().filter((_, i) => i !== index));
    // Só o 1º atributo tem fotos associadas; se ele sumir, as fotos ficam órfãs.
    if (index === 0 && removed) this.variantImagesChange.emit({});
  }

  addValue(index: number, el: HTMLInputElement) {
    const raw = el.value.trim().slice(0, 30);
    el.value = '';
    if (!raw) return;
    const attr = this.attributes()[index];
    const exists = attr.values.some(v => v.toLowerCase() === raw.toLowerCase());
    if (exists || attr.values.length >= MAX_VALUES_PER_ATTRIBUTE) return;
    this.attributesChange.emit(this.attributes().map((a, i) => (i === index ? { ...a, values: [...a.values, raw] } : a)));
  }

  removeValue(index: number, value: string) {
    this.attributesChange.emit(
      this.attributes().map((a, i) => (i === index ? { ...a, values: a.values.filter(v => v !== value) } : a))
    );
    if (index === 0) this.clearImage(value);
  }

  // ------------------------------------------------------------- combinações

  updateSkuStock(row: SkuRow, event: Event) {
    const stock = Math.max(0, Math.floor(Number((event.target as HTMLInputElement).value) || 0));
    this.patchSku(row, { stock });
  }

  updateSkuPrice(row: SkuRow, event: Event) {
    const raw = (event.target as HTMLInputElement).value;
    const price = raw === '' ? null : Math.max(0, Number(raw));
    this.patchSku(row, { price });
  }

  private patchSku(row: SkuRow, patch: Partial<ProductSku>) {
    const current = this.skus();
    const existing = current[row.id];
    this.skusChange.emit({
      ...current,
      [row.id]: {
        id: row.id,
        attributes: row.attributes,
        price: existing?.price ?? null,
        stock: existing?.stock ?? 0,
        ...patch
      }
    });
  }

  // --------------------------------------------------- foto por valor (1º atributo)

  imageFor(value: string): string | null {
    return this.variantImages()[value] || null;
  }

  pickImage(value: string, photo: string) {
    this.variantImagesChange.emit({ ...this.variantImages(), [value]: photo });
  }

  clearImage(value: string) {
    const next = { ...this.variantImages() };
    delete next[value];
    this.variantImagesChange.emit(next);
  }
}
