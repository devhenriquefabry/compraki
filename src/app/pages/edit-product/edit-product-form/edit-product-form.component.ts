import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { Observable, Subscription } from 'rxjs';

import { LocalDelivery, Product, ProductSku, ProductSpec, ProductVariantAttribute } from 'src/app/interfaces/product';
import { Category, Subcategory } from 'src/app/interfaces/category';
import { ProductSpecsEditorComponent, cleanSpecs } from 'src/app/components/product-specs-editor/product-specs-editor.component';
import { ProductVariantsEditorComponent } from 'src/app/components/product-variants-editor/product-variants-editor.component';
import { LocalDeliveryEditorComponent } from 'src/app/components/local-delivery-editor/local-delivery-editor.component';
import { VnIconComponent } from 'src/app/components/vn-icon/vn-icon.component';
import { resizeImage } from 'src/app/core/image-resize';
import { readLocalDelivery } from 'src/app/core/local-delivery';
import { formatBRL } from 'src/app/core/order-stage';
import {
  cleanVariantPhotos, cleanVariants, galleriesFromProduct, generalPhotos, mainOptionImages, optionGalleryPhotos, resolveGalleries,
  totalVariantStock,
} from 'src/app/core/product-variants';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { FirebaseCategories } from 'src/app/services/firebase-categories';
import { ProductNameGuardService } from 'src/app/services/product-name-guard.service';

export type EditSection = 'fotos' | 'detalhes' | 'preco' | 'variacoes' | 'entrega' | 'ficha';

/** Seções do formulário, na ordem da tela (os atalhos do topo usam esta lista). */
export const EDIT_SECTIONS: { id: EditSection; label: string }[] = [
  { id: 'fotos', label: 'Fotos' },
  { id: 'detalhes', label: 'Detalhes' },
  { id: 'preco', label: 'Preço' },
  { id: 'variacoes', label: 'Variações' },
  { id: 'entrega', label: 'Entrega' },
  { id: 'ficha', label: 'Ficha e descrição' },
];

type FormKey = 'name' | 'price' | 'priceDiscounted' | 'stock' | 'description' | 'categoryIds' | 'weight' | 'width' | 'height' | 'length';
type Condition = 'novo' | 'usado-como-novo' | 'usado-bom' | 'usado-aceitavel';
type Shipping = 'Frete Grátis' | 'A combinar' | 'Entrega Expressa';

/** Fotos gerais do anúncio (as de cada cor ficam nas galerias das variações). */
export const MAX_PHOTOS = 6;
/** Descrição a partir daqui conta como "completa" (mesma régua de Meu anúncio). */
const GOOD_DESCRIPTION = 120;

/** Promoção, quando preenchida, precisa ser menor que o preço. */
function promoBelowPrice(group: AbstractControl): ValidationErrors | null {
  const price = Number(group.get('price')?.value);
  const raw = group.get('priceDiscounted')?.value;
  if (raw === null || raw === undefined || raw === '') return null;
  const promo = Number(raw);
  return Number.isFinite(promo) && promo > 0 && promo < price ? null : { promo: true };
}

@Component({
  selector: 'app-edit-product-form',
  templateUrl: './edit-product-form.component.html',
  styleUrls: ['./edit-product-form.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, ReactiveFormsModule, ProductSpecsEditorComponent, ProductVariantsEditorComponent, LocalDeliveryEditorComponent, VnIconComponent],
})
export class EditProductFormComponent implements OnInit, OnDestroy {
  private readonly nameGuard = inject(ProductNameGuardService);
  private readonly products = inject(FirebaseProducts);
  private readonly categoriesService = inject(FirebaseCategories);
  private readonly toastCtrl = inject(ToastController);
  private subs: Subscription[] = [];

  private _product!: Product;
  /** O anúncio como estava ao abrir. A página só passa a primeira leitura. */
  @Input() set product(value: Product) {
    this._product = value;
    this.load(value);
  }
  get product(): Product {
    return this._product;
  }
  @Output() saved = new EventEmitter<void>();

  readonly maxPhotos = MAX_PHOTOS;
  readonly conditionOptions: { value: Condition; label: string; hint: string }[] = [
    { value: 'novo', label: 'Novo', hint: 'Lacrado, nunca usado' },
    { value: 'usado-como-novo', label: 'Como novo', hint: 'Usado poucas vezes, sem marcas' },
    { value: 'usado-bom', label: 'Bom estado', hint: 'Uso normal, pequenos sinais' },
    { value: 'usado-aceitavel', label: 'Aceitável', hint: 'Funciona bem, com desgaste' },
  ];
  readonly shippingOptions: { value: Shipping; label: string; hint: string; icon: string }[] = [
    { value: 'A combinar', label: 'Comprador paga', hint: 'Frete calculado no checkout', icon: 'cube-outline' },
    { value: 'Frete Grátis', label: 'Frete grátis', hint: 'A etiqueta sai do seu repasse', icon: 'gift-outline' },
    { value: 'Entrega Expressa', label: 'Expressa', hint: 'Envio prioritário', icon: 'flash-outline' },
  ];

  /** Houve alteração desde que abriu (a página usa para perguntar antes de sair). */
  changed = false;
  saving = false;
  /** Tentou salvar com campo faltando: os campos inválidos passam a mostrar o erro. */
  triedSave = false;

  selectedPhotos: string[] = [];
  /** Arquivo de cada prévia nova (`data:`), para subir ao salvar. */
  private photoFiles = new Map<string, File>();
  previewImage: string | null = null;

  hasVariants = false;
  variantAttributes: ProductVariantAttribute[] = [];
  variantSkus: Record<string, ProductSku> = {};
  variantImages: Record<string, string> = {};
  variantPhotos: Record<string, string[]> = {};
  private optionFiles = new Map<string, File>();

  categories$!: Observable<Category[]>;
  availableSubcategories: Subcategory[] = [];
  private allCategories: Category[] = [];

  localDelivery: LocalDelivery | null = null;

  form = new FormGroup({
    id: new FormControl(''),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    condition: new FormControl<Condition>('novo', [Validators.required]),
    price: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    priceDiscounted: new FormControl<number | null>(null),
    stock: new FormControl<number | null>(1, [Validators.required, Validators.min(0)]),
    acceptOffers: new FormControl(true),
    description: new FormControl('', [Validators.required]),
    specs: new FormControl<ProductSpec[]>([]),
    categoryIds: new FormControl<string[]>([], [Validators.required, Validators.minLength(1)]),
    subcategoryIds: new FormControl<string[]>([]),
    shipping: new FormControl<Shipping>('A combinar', [Validators.required]),
    // Em kg, até 30 (limite dos Correios): pega quem digita gramas.
    weight: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01), Validators.max(30)]),
    width: new FormControl<number | null>(null, [Validators.required, Validators.min(1), Validators.max(100)]),
    height: new FormControl<number | null>(null, [Validators.required, Validators.min(1), Validators.max(100)]),
    length: new FormControl<number | null>(null, [Validators.required, Validators.min(1), Validators.max(100)]),
  }, { validators: promoBelowPrice });

  ngOnInit() {
    // Termos proibidos pelo admin: aviso na hora e salvar travado.
    const name = this.form.controls.name;
    name.addValidators(this.nameGuard.validator());
    name.updateValueAndValidity({ emitEvent: false });
    this.subs.push(this.nameGuard.watch(name));

    this.categories$ = this.categoriesService.getAll();
    this.subs.push(this.categories$.subscribe(cats => {
      this.allCategories = cats;
      this.refreshSubcategories();
    }));
    this.subs.push(this.form.valueChanges.subscribe(() => (this.changed = true)));
    this.subs.push(this.form.controls.categoryIds.valueChanges.subscribe(() => this.refreshSubcategories()));
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  private load(product: Product) {
    if (!product) return;
    this.form.patchValue({
      id: product.id ?? '',
      name: product.name ?? '',
      condition: product.condition ?? 'novo',
      price: product.price ?? null,
      priceDiscounted: product.priceDiscounted ?? null,
      stock: product.stock ?? 0,
      acceptOffers: product.acceptOffers ?? true,
      description: product.description ?? '',
      specs: product.specs || [],
      categoryIds: product.categoryIds || [],
      subcategoryIds: product.subcategoryIds || [],
      shipping: product.shipping ?? 'A combinar',
      weight: product.weight ?? null,
      width: product.width ?? null,
      height: product.height ?? null,
      length: product.length ?? null,
    }, { emitEvent: false });
    this.form.updateValueAndValidity({ emitEvent: false });
    // As fotos de cada cor ficam na galeria dela, não na grade de fotos gerais.
    this.selectedPhotos = generalPhotos(product);
    this.photoFiles.clear();
    this.hasVariants = !!product.hasVariants;
    this.variantAttributes = product.variantAttributes ? [...product.variantAttributes] : [];
    this.variantSkus = product.skus ? { ...product.skus } : {};
    this.variantImages = product.variantImages ? { ...product.variantImages } : {};
    this.variantPhotos = galleriesFromProduct(product);
    this.localDelivery = readLocalDelivery(product.localDelivery);
    this.optionFiles.clear();
    this.refreshSubcategories();
    this.changed = false;
    this.triedSave = false;
  }

  private refreshSubcategories() {
    const first = this.form.controls.categoryIds.value?.[0];
    this.availableSubcategories = this.allCategories.find(c => c.id === first)?.subcategories || [];
  }

  markChanged() {
    this.changed = true;
  }

  // ------------------------------------------------------------ detalhes

  selectCategory(id: string) {
    if (this.form.controls.categoryIds.value?.[0] === id) return;
    this.form.patchValue({ categoryIds: [id], subcategoryIds: [] });
  }

  toggleSubcategory(id: string) {
    const current = this.form.controls.subcategoryIds.value || [];
    this.form.patchValue({ subcategoryIds: current.includes(id) ? current.filter(s => s !== id) : [...current, id] });
  }

  setCondition(value: Condition) {
    this.form.patchValue({ condition: value });
  }

  setShipping(value: Shipping) {
    this.form.patchValue({ shipping: value });
  }

  stepStock(delta: number) {
    const current = Number(this.form.controls.stock.value) || 0;
    this.form.patchValue({ stock: Math.max(0, Math.round(current + delta)) });
  }

  onLocalDelivery(value: LocalDelivery | null) {
    this.localDelivery = value;
    this.markChanged();
  }

  // ---------------------------------------------------------------- fotos

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []).filter(f => f.type.startsWith('image/'));
    input.value = '';
    const room = MAX_PHOTOS - this.selectedPhotos.length;
    if (room <= 0) return void this.toast(`O anúncio tem até ${MAX_PHOTOS} fotos gerais. Tire uma para pôr outra.`);
    if (files.length > room) void this.toast(`Só cabem mais ${room} ${room === 1 ? 'foto' : 'fotos'}: entraram as primeiras.`);
    // Lê todas antes de acrescentar: a ordem das prévias é a da escolha.
    const previews = await Promise.all(files.slice(0, room).map(file => new Promise<[string, File]>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve([reader.result as string, file]);
      reader.readAsDataURL(file);
    })));
    for (const [preview, file] of previews) {
      this.photoFiles.set(preview, file);
      this.selectedPhotos = [...this.selectedPhotos, preview];
    }
    if (previews.length) this.markChanged();
  }

  removePhoto(index: number) {
    const [removed] = this.selectedPhotos.splice(index, 1);
    this.selectedPhotos = [...this.selectedPhotos];
    // A mesma prévia pode estar em outra posição (foto escolhida duas vezes) ou na galeria de
    // uma cor: o arquivo só sai quando ninguém mais usa.
    const stillUsed = this.selectedPhotos.includes(removed)
      || Object.values(this.variantPhotos).some(list => list.includes(removed));
    if (removed && !stillUsed) this.photoFiles.delete(removed);
    this.markChanged();
  }

  movePhoto(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= this.selectedPhotos.length) return;
    const list = [...this.selectedPhotos];
    [list[index], list[to]] = [list[to], list[index]];
    this.selectedPhotos = list;
    this.markChanged();
  }

  makeCover(index: number) {
    if (index <= 0) return;
    const list = [...this.selectedPhotos];
    const [photo] = list.splice(index, 1);
    this.selectedPhotos = [photo, ...list];
    this.markChanged();
  }

  onOptionFiles(items: { preview: string; file: File }[]) {
    for (const { preview, file } of items) this.optionFiles.set(preview, file);
    this.markChanged();
  }

  // ------------------------------------------------------------ leitura

  get blockedTerm(): string | null {
    return this.form.controls.name.errors?.['blockedWord'] ?? null;
  }

  get discountPercent(): number | null {
    const price = Number(this.form.controls.price.value);
    const promo = Number(this.form.controls.priceDiscounted.value);
    if (!price || !promo || promo >= price) return null;
    return Math.round((1 - promo / price) * 100);
  }

  get conditionLabel(): string {
    return this.conditionOptions.find(c => c.value === this.form.controls.condition.value)?.label || 'Novo';
  }

  get shippingLabel(): string {
    if (this.localDelivery?.onlyLocal) return 'Entrega grátis da loja';
    const base = this.shippingOptions.find(o => o.value === this.form.controls.shipping.value)?.label || '';
    return this.localDelivery?.cities?.length ? `${base} · entrega grátis em ${this.localDelivery.cities.length} ${this.localDelivery.cities.length === 1 ? 'cidade' : 'cidades'}` : base;
  }

  get previewPrice(): { price: number; list: number | null } {
    const price = Number(this.form.controls.price.value) || 0;
    const promo = this.discountPercent ? Number(this.form.controls.priceDiscounted.value) : null;
    return promo ? { price: promo, list: price } : { price, list: null };
  }

  get descriptionLength(): number {
    return (this.form.controls.description.value || '').trim().length;
  }

  /** O que impede de salvar, em palavras (vai para a barra e para o painel lateral). */
  get missing(): string[] {
    const c = this.form.controls;
    const out: string[] = [];
    if (c.name.invalid) out.push(this.blockedTerm ? 'título não permitido' : 'título');
    if (c.categoryIds.invalid) out.push('categoria');
    if (c.price.invalid) out.push('preço');
    if (this.form.errors?.['promo']) out.push('promoção menor que o preço');
    if (!this.hasVariants && c.stock.invalid) out.push('estoque');
    if (c.description.invalid) out.push('descrição');
    if (c.weight.invalid || c.width.invalid || c.height.invalid || c.length.invalid) out.push('peso e medidas');
    if (!this.selectedPhotos.length && !Object.values(this.variantPhotos).some(l => l.length)) out.push('pelo menos 1 foto');
    if (this.localDelivery && !readLocalDelivery(this.localDelivery)) out.push('cidade da entrega grátis');
    return out;
  }

  /** Mesma régua de "Qualidade do anúncio" em Meu anúncio. */
  get quality(): { label: string; ok: boolean; section: EditSection }[] {
    const specs = (this.form.controls.specs.value || []).filter(s => s.label && s.value).length;
    const c = this.form.controls;
    const dims = [c.weight, c.width, c.height, c.length].every(x => Number(x.value) > 0);
    const stock = this.hasVariants ? totalVariantStock(this.variantSkus) : Number(c.stock.value) || 0;
    // Todas as fotos do anúncio, gerais e de cada cor, como em Meu anúncio.
    const photos = new Set([...this.selectedPhotos, ...Object.values(this.variantPhotos).flat()]).size;
    return [
      { label: `Fotos (${photos} de 3+)`, ok: photos >= 3, section: 'fotos' },
      { label: 'Descrição completa', ok: this.descriptionLength >= GOOD_DESCRIPTION, section: 'ficha' },
      { label: `Ficha técnica (${specs} de 3+)`, ok: specs >= 3, section: 'ficha' },
      { label: 'Peso e medidas', ok: dims, section: 'entrega' },
      { label: 'Estoque disponível', ok: stock > 0, section: 'preco' },
    ];
  }

  get qualityScore(): number {
    return this.quality.filter(q => q.ok).length;
  }

  invalid(name: FormKey): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || this.triedSave);
  }

  brl(value: number): string {
    return formatBRL(value || 0);
  }

  // ---------------------------------------------------------------- salvar

  undo() {
    this.load(this._product);
  }

  async submit() {
    if (this.saving) return;
    this.triedSave = true;
    if (this.nameGuard.check(this.form.controls.name.value)) {
      this.form.controls.name.updateValueAndValidity();
      await this.nameGuard.showBlockedAlert();
      return;
    }
    const missing = this.missing;
    if (missing.length) {
      this.form.markAllAsTouched();
      return void this.toast(`Falta: ${missing.join(', ')}.`);
    }

    const { variantAttributes, skus } = cleanVariants(this.variantAttributes, this.variantSkus);
    const variantsEnabled = this.hasVariants && variantAttributes.length > 0 && Object.keys(skus).length > 0;
    if (this.hasVariants && !variantsEnabled) {
      return void this.toast('Em "Variações", adicione ao menos um atributo com um valor, ou desligue a opção.');
    }

    this.saving = true;
    try {
      // Fotos novas sobem já reduzidas (celular manda 4–8 MB); a ordem é a da grade.
      const upload = async (file: File) => {
        const blob = await resizeImage(file);
        const ready = blob === file ? file : new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
        return this.products.uploadImage(ready);
      };
      const urlByPreview = new Map<string, string>();
      const generalUrls = await Promise.all(this.selectedPhotos.map(async photo => {
        const file = this.photoFiles.get(photo);
        if (!file) return photo;
        const url = await upload(file);
        urlByPreview.set(photo, url);
        return url;
      }));

      const variantPhotos = variantsEnabled
        ? await resolveGalleries(cleanVariantPhotos(variantAttributes, this.variantPhotos), photo => {
            const known = urlByPreview.get(photo);
            if (known) return Promise.resolve(known);
            const file = this.optionFiles.get(photo) ?? this.photoFiles.get(photo);
            return file ? upload(file) : Promise.resolve(photo);
          })
        : {};

      const photoURL = Array.from(new Set([...generalUrls, ...optionGalleryPhotos(variantAttributes, variantPhotos)]));
      // Prévia de foto local (base64 do FileReader) nunca vai para o documento: estoura o
      // limite e não abre em outro aparelho. As ilustrações do catálogo (SVG em `data:`) podem.
      if (photoURL.some(url => url.startsWith('data:') && url.includes(';base64,'))) throw new Error('foto sem envio');

      const v = this.form.getRawValue();
      const promo = this.discountPercent ? Math.round(Number(v.priceDiscounted) * 100) / 100 : null;
      const updated = {
        id: this._product.id,
        name: v.name.trim(),
        condition: v.condition,
        price: Math.round(Number(v.price) * 100) / 100,
        priceDiscounted: promo,
        acceptOffers: !!v.acceptOffers,
        description: (v.description || '').trim(),
        specs: cleanSpecs(v.specs),
        categoryIds: v.categoryIds || [],
        subcategoryIds: v.subcategoryIds || [],
        shipping: v.shipping,
        weight: Number(v.weight),
        width: Number(v.width),
        height: Number(v.height),
        length: Number(v.length),
        photoURL,
        generalPhotoCount: generalUrls.length,
        stock: variantsEnabled ? totalVariantStock(skus) : Number(v.stock) || 0,
        hasVariants: variantsEnabled,
        variantAttributes: variantsEnabled ? variantAttributes : [],
        variantImages: mainOptionImages(variantAttributes, {}, variantPhotos),
        variantPhotos,
        skus: variantsEnabled ? skus : {},
        localDelivery: readLocalDelivery(this.localDelivery),
        updatedAt: new Date(),
      } as Product;

      await this.products.update(updated);
      this.changed = false;
      await this.toast('Alterações salvas. O anúncio já está atualizado na vitrine.', 'success');
      this.saved.emit();
    } catch (err) {
      console.error('[editar anúncio] salvar', err);
      await this.toast('Não deu para salvar agora. Confira a conexão e tente de novo.', 'danger');
    } finally {
      this.saving = false;
    }
  }

  private async toast(message: string, color = 'dark') {
    const t = await this.toastCtrl.create({ message, duration: 3500, color, position: 'bottom', cssClass: 'ef-toast' });
    await t.present();
  }
}
