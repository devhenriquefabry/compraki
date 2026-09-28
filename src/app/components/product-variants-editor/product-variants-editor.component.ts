import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ProductSku, ProductVariantAttribute } from '../../interfaces/product';
import { MAX_OPTION_PHOTOS, MAX_VARIANT_ATTRIBUTES, cartesianCombinations, skuKey } from '../../core/product-variants';

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
  /** Galeria de cada valor do 1º atributo (URL salva ou prévia local `data:`). */
  readonly variantPhotos = input<Record<string, string[]>>({});
  readonly availablePhotos = input<string[]>([]);
  readonly basePrice = input<number | null>(null);
  /**
   * Opções fixas vindas do catálogo Vineon. Quando informado, o vendedor não
   * cria nem renomeia atributos: só marca quais opções do catálogo ele tem.
   */
  readonly catalogOptions = input<ProductVariantAttribute[] | null>(null);

  readonly hasVariantsChange = output<boolean>();
  readonly attributesChange = output<ProductVariantAttribute[]>();
  readonly skusChange = output<Record<string, ProductSku>>();
  readonly variantImagesChange = output<Record<string, string>>();
  readonly variantPhotosChange = output<Record<string, string[]>>();
  /** Fotos novas escolhidas numa galeria: o formulário guarda o arquivo para subir ao publicar. */
  readonly optionFilesAdded = output<{ preview: string; file: File }[]>();

  readonly maxOptionPhotos = MAX_OPTION_PHOTOS;

  readonly maxAttributes = MAX_VARIANT_ATTRIBUTES;

  readonly suggestions = computed(() => {
    const used = new Set(this.attributes().map(a => (a.name || '').trim().toLowerCase()));
    return SUGGESTED_ATTRIBUTES.filter(name => !used.has(name.toLowerCase()));
  });

  readonly attributeNames = computed(() => this.attributes().map(a => a.name));

  readonly locked = computed(() => (this.catalogOptions()?.length ?? 0) > 0);

  /** Atributos do catálogo com o que o vendedor já marcou. */
  readonly catalogGroups = computed(() => {
    const current = this.attributes();
    return (this.catalogOptions() || []).map((option, i) => {
      const chosen = new Set(current[i]?.values ?? []);
      return { name: option.name, options: option.values.map(value => ({ value, on: chosen.has(value) })), count: chosen.size };
    });
  });

  readonly rows = computed<SkuRow[]>(() => {
    const names = this.attributeNames();
    const skuMap = this.skus();
    return cartesianCombinations(this.attributes()).map(combo => {
      const id = skuKey(names, combo);
      const sku = skuMap[id];
      return { id, attributes: combo, price: sku?.price ?? null, stock: sku?.stock ?? 0 };
    });
  });

  /** Preço do anúncio como dica no campo de cada combinação (vazio = usa ele). */
  readonly basePriceLabel = computed(() => {
    const price = this.basePrice();
    return price ? price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00';
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

  /** Todo atributo do catálogo tem ao menos uma opção marcada. */
  readonly catalogReady = computed(() => this.catalogGroups().every(group => group.count > 0));

  // ------------------------------------------------------ opções do catálogo

  /** Liga/desliga uma opção mantendo a ordem do catálogo. */
  toggleCatalogValue(index: number, value: string) {
    const options = this.catalogOptions() || [];
    const current = this.attributes();
    const next = options.map((option, i) => {
      const chosen = new Set(current[i]?.values ?? []);
      if (i === index) {
        if (chosen.has(value)) chosen.delete(value);
        else chosen.add(value);
      }
      return { name: option.name, values: option.values.filter(v => chosen.has(v)) };
    });
    this.attributesChange.emit(next);
  }

  /** Marca (ou desmarca) todas as opções de um atributo. */
  toggleAllCatalogValues(index: number) {
    const options = this.catalogOptions() || [];
    const current = this.attributes();
    const all = (current[index]?.values.length ?? 0) === options[index]?.values.length;
    this.attributesChange.emit(options.map((option, i) => ({
      name: option.name,
      values: i === index ? (all ? [] : [...option.values]) : option.values.filter(v => current[i]?.values.includes(v)),
    })));
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
    if (index === 0 && removed) {
      this.variantImagesChange.emit({});
      this.variantPhotosChange.emit({});
    }
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
    if (index === 0) {
      this.clearImage(value);
      this.setGallery(value, []);
    }
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
    return this.variantPhotos()[value]?.[0] || this.variantImages()[value] || null;
  }

  // ------------------------------------------- galeria por valor (1º atributo)

  galleryFor(value: string): string[] {
    return this.variantPhotos()[value] ?? [];
  }

  private setGallery(value: string, photos: string[]) {
    const next = { ...this.variantPhotos() };
    if (photos.length) next[value] = photos;
    else delete next[value];
    this.variantPhotosChange.emit(next);
  }

  async addGalleryFiles(value: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const room = this.maxOptionPhotos - this.galleryFor(value).length;
    const files = Array.from(input.files ?? []).filter(f => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    input.value = '';
    if (!files.length) return;
    // Lê todas antes de acrescentar: a galeria fica na ordem em que foram escolhidas.
    const previews = await Promise.all(files.map(file => new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    })));
    this.optionFilesAdded.emit(previews.map((preview, i) => ({ preview, file: files[i] })));
    this.setGallery(value, [...this.galleryFor(value), ...previews]);
  }

  /** Põe ou tira da galeria uma das fotos gerais do anúncio. */
  toggleGalleryPhoto(value: string, photo: string) {
    const gallery = this.galleryFor(value);
    if (gallery.includes(photo)) this.setGallery(value, gallery.filter(p => p !== photo));
    else if (gallery.length < this.maxOptionPhotos) this.setGallery(value, [...gallery, photo]);
  }

  removeGalleryPhoto(value: string, index: number) {
    this.setGallery(value, this.galleryFor(value).filter((_, i) => i !== index));
  }

  /** Leva a foto para a 1ª posição: vira a principal da opção. */
  makeGalleryMain(value: string, index: number) {
    const gallery = [...this.galleryFor(value)];
    const [photo] = gallery.splice(index, 1);
    this.setGallery(value, [photo, ...gallery]);
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
