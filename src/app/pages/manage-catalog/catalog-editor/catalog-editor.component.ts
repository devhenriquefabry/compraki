import { Component, HostListener, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';

import {
  CATALOG_ATTRIBUTE_SUGGESTIONS, MAX_CATALOG_PHOTOS, MAX_CATALOG_SPECS, MIN_GOOD_DESCRIPTION,
  canActivate, catalogChecks, catalogCode, isValidGtin, onlyDigits, packageSummary, qualityScore, specSuggestions, variantSummary,
} from '../../../core/catalog';
import { CatalogProduct, CatalogStatus } from '../../../interfaces/catalog';
import { Category } from '../../../interfaces/category';
import { ProductVariantAttribute } from '../../../interfaces/product';
import { CatalogService } from '../../../services/catalog.service';

type TextField = 'title' | 'brand' | 'model' | 'line' | 'description';
type NumberField = 'weight' | 'width' | 'height' | 'length' | 'referencePrice';

const MAX_ATTRIBUTES = 2;
const MAX_VALUES = 30;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Editor de um produto do catálogo (aba Catálogo do painel).
 *
 * Trabalha numa cópia (`draft`) e só grava no "Salvar". Ao lado, a nota de
 * qualidade e a prévia de como o vendedor vê a ficha na hora de anunciar.
 */
@Component({
  selector: 'app-catalog-editor',
  templateUrl: './catalog-editor.component.html',
  styleUrls: ['./catalog-editor.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class CatalogEditorComponent implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly product = input.required<CatalogProduct>();
  readonly categories = input<Category[]>([]);
  /** Anúncios que já usam esta ficha. */
  readonly listings = input(0);

  /** Id salvo, ou `null` quando saiu sem salvar. */
  readonly closed = output<string | null>();
  readonly duplicated = output<CatalogProduct>();

  readonly draft = signal<CatalogProduct>(this.blank());
  private readonly initial = signal('');

  readonly saving = signal(false);
  readonly uploads = signal(0);
  readonly dragOver = signal(false);
  readonly gtinError = signal('');
  readonly gtinWarning = signal('');
  /** Liga os avisos de campo vazio depois da primeira tentativa de salvar. */
  readonly showErrors = signal(false);

  readonly maxPhotos = MAX_CATALOG_PHOTOS;
  readonly maxSpecs = MAX_CATALOG_SPECS;
  readonly maxAttributes = MAX_ATTRIBUTES;
  readonly minDescription = MIN_GOOD_DESCRIPTION;

  readonly isNew = computed(() => !this.draft().id);
  readonly code = computed(() => catalogCode(this.draft().id));
  readonly dirty = computed(() => snapshot(this.draft()) !== this.initial());
  readonly checks = computed(() => catalogChecks(this.draft()));
  readonly quality = computed(() => qualityScore(this.draft()));
  readonly missingRequired = computed(() => this.checks().filter(c => c.required && !c.ok));
  readonly ready = computed(() => canActivate(this.draft()));

  readonly category = computed(() => this.categories().find(c => c.id === this.draft().categoryId) ?? null);
  readonly subcategories = computed(() => this.category()?.subcategories ?? []);
  readonly categoryLabel = computed(() => {
    const cat = this.category();
    if (!cat) return '';
    const sub = cat.subcategories?.find(s => s.id === this.draft().subcategoryId);
    return sub ? `${cat.name} › ${sub.name}` : cat.name;
  });

  readonly specHints = computed(() => {
    const d = this.draft();
    const sub = this.subcategories().find(s => s.id === d.subcategoryId)?.name ?? '';
    return specSuggestions(`${sub} ${this.category()?.name ?? ''} ${d.title}`, d.specs);
  });

  readonly attributeHints = computed(() => {
    const used = new Set(this.draft().variantAttributes.map(a => a.name.trim().toLowerCase()));
    return CATALOG_ATTRIBUTE_SUGGESTIONS.filter(name => !used.has(name.toLowerCase()));
  });

  readonly previewSub = computed(() =>
    [this.draft().brand.trim(), this.categoryLabel()].filter(Boolean).join(' · ') || 'Marca · Categoria');

  readonly variantText = computed(() => variantSummary(this.draft().variantAttributes));
  readonly packageText = computed(() => packageSummary(this.draft()));
  readonly uploadSlots = computed(() => Array.from({ length: this.uploads() }));

  ngOnInit() {
    const copy = clone(this.product());
    this.draft.set(copy);
    this.initial.set(snapshot(copy));
  }

  // ------------------------------------------------------------ campos

  private patch(changes: Partial<CatalogProduct>) {
    this.draft.update(d => ({ ...d, ...changes }));
  }

  text(field: TextField, event: Event) {
    this.patch({ [field]: (event.target as HTMLInputElement).value });
  }

  num(field: NumberField, event: Event) {
    const raw = (event.target as HTMLInputElement).value.replace(',', '.');
    const value = parseFloat(raw);
    this.patch({ [field]: Number.isFinite(value) && value > 0 ? value : null });
  }

  invalid(key: string): boolean {
    return this.showErrors() && this.checks().some(c => c.key === key && c.required && !c.ok);
  }

  suggestTitle() {
    const d = this.draft();
    this.patch({ title: [d.brand, d.model].map(s => s.trim()).filter(Boolean).join(' ') });
  }

  pickCategory(id: string) {
    this.patch({ categoryId: id, subcategoryId: null });
  }

  pickSubcategory(id: string) {
    this.patch({ subcategoryId: id || null });
  }

  setStatus(status: CatalogStatus) {
    this.patch({ status });
  }

  // ----------------------------------------------------- códigos e nomes

  addGtin(el: HTMLInputElement) {
    const codes = el.value.split(/[\s,;]+/).map(onlyDigits).filter(Boolean);
    if (!codes.length) return;
    const bad = codes.find(code => !isValidGtin(code));
    if (bad) {
      this.gtinError.set(`“${bad}” não é um código de barras válido. Confira os números: o último dígito não bate.`);
      return;
    }
    const current = this.draft().gtins;
    this.patch({ gtins: Array.from(new Set([...current, ...codes])) });
    this.gtinError.set('');
    el.value = '';
    void this.checkGtinOwners(codes);
  }

  /** Avisa se o código já está em outra ficha: provavelmente é o mesmo produto. */
  private async checkGtinOwners(codes: string[]) {
    try {
      const self = this.draft().id;
      for (const code of codes) {
        const other = (await this.catalog.gtinOwners(code)).find(item => item.id !== self);
        if (other) {
          this.gtinWarning.set(`O código ${code} já está em “${other.title}” (${catalogCode(other.id)}). Confira se não é o mesmo produto.`);
          return;
        }
      }
      this.gtinWarning.set('');
    } catch {
      // Só um aviso: sem conexão, segue sem ele.
    }
  }

  removeGtin(code: string) {
    this.patch({ gtins: this.draft().gtins.filter(c => c !== code) });
    if (this.gtinWarning().includes(code)) this.gtinWarning.set('');
  }

  addAlias(el: HTMLInputElement) {
    const names = el.value.split(',').map(s => s.trim()).filter(Boolean);
    if (!names.length) return;
    const current = this.draft().aliases;
    const lower = new Set(current.map(a => a.toLowerCase()));
    this.patch({ aliases: [...current, ...names.filter(n => !lower.has(n.toLowerCase()))].slice(0, 12) });
    el.value = '';
  }

  removeAlias(name: string) {
    this.patch({ aliases: this.draft().aliases.filter(a => a !== name) });
  }

  // ------------------------------------------------------------ fotos

  onPick(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.upload(files);
  }

  onDrag(event: DragEvent, over: boolean) {
    event.preventDefault();
    this.dragOver.set(over);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragOver.set(false);
    void this.upload(Array.from(event.dataTransfer?.files ?? []));
  }

  private async upload(files: File[]) {
    const images = files.filter(f => f.type.startsWith('image/'));
    const room = this.maxPhotos - this.draft().photos.length - this.uploads();
    if (!images.length) return;
    if (room <= 0) {
      await this.toast(`O catálogo guarda até ${this.maxPhotos} fotos por produto.`, 'danger');
      return;
    }
    const tooBig = images.filter(f => f.size > MAX_PHOTO_BYTES);
    if (tooBig.length) await this.toast('Foto acima de 10 MB foi ignorada. Envie uma versão menor.', 'danger');

    const batch = images.filter(f => f.size <= MAX_PHOTO_BYTES).slice(0, room);
    await Promise.all(batch.map(async file => {
      this.uploads.update(n => n + 1);
      try {
        const url = await this.catalog.uploadPhoto(file);
        this.draft.update(d => ({ ...d, photos: [...d.photos, url] }));
      } catch (err) {
        console.error('[catálogo] foto', err);
        await this.toast(`Não deu para enviar “${file.name}”. Tente de novo.`, 'danger');
      } finally {
        this.uploads.update(n => n - 1);
      }
    }));
  }

  movePhoto(index: number, delta: number) {
    const photos = [...this.draft().photos];
    const target = index + delta;
    if (target < 0 || target >= photos.length) return;
    [photos[index], photos[target]] = [photos[target], photos[index]];
    this.patch({ photos });
  }

  makeCover(index: number) {
    const photos = [...this.draft().photos];
    const [photo] = photos.splice(index, 1);
    this.patch({ photos: [photo, ...photos] });
  }

  removePhoto(index: number) {
    const d = this.draft();
    const url = d.photos[index];
    const variantImages = Object.fromEntries(Object.entries(d.variantImages).filter(([, img]) => img !== url));
    this.patch({ photos: d.photos.filter((_, i) => i !== index), variantImages });
  }

  // ------------------------------------------------------------ opções

  addAttribute(name = '') {
    const attrs = this.draft().variantAttributes;
    if (attrs.length >= MAX_ATTRIBUTES) return;
    this.patch({ variantAttributes: [...attrs, { name, values: [] }] });
  }

  renameAttribute(index: number, event: Event) {
    const name = (event.target as HTMLInputElement).value.slice(0, 30);
    this.patch({ variantAttributes: this.draft().variantAttributes.map((a, i) => (i === index ? { ...a, name } : a)) });
  }

  removeAttribute(index: number) {
    const d = this.draft();
    this.patch({
      variantAttributes: d.variantAttributes.filter((_, i) => i !== index),
      // Fotos por opção são sempre do 1º atributo.
      variantImages: index === 0 ? {} : d.variantImages,
    });
  }

  /** Aceita várias de uma vez separadas por vírgula: "Preto, Azul, Verde". */
  addValues(index: number, el: HTMLInputElement) {
    const raw = el.value.split(',').map(v => v.trim().slice(0, 30)).filter(Boolean);
    el.value = '';
    if (!raw.length) return;
    this.patch({
      variantAttributes: this.draft().variantAttributes.map((attr, i) => {
        if (i !== index) return attr;
        const lower = new Set(attr.values.map(v => v.toLowerCase()));
        const fresh = raw.filter(v => {
          const key = v.toLowerCase();
          if (lower.has(key)) return false;
          lower.add(key);
          return true;
        });
        return { ...attr, values: [...attr.values, ...fresh].slice(0, MAX_VALUES) };
      }),
    });
  }

  removeValue(index: number, value: string) {
    const d = this.draft();
    const variantImages = { ...d.variantImages };
    if (index === 0) delete variantImages[value];
    this.patch({
      variantAttributes: d.variantAttributes.map((a, i) => (i === index ? { ...a, values: a.values.filter(v => v !== value) } : a)),
      variantImages,
    });
  }

  moveValue(index: number, value: string, delta: number) {
    this.patch({
      variantAttributes: this.draft().variantAttributes.map((a, i) => {
        if (i !== index) return a;
        const values = [...a.values];
        const from = values.indexOf(value);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= values.length) return a;
        [values[from], values[to]] = [values[to], values[from]];
        return { ...a, values };
      }),
    });
  }

  variantImage(value: string): string | null {
    return this.draft().variantImages[value] || null;
  }

  pickVariantImage(value: string, url: string) {
    const current = { ...this.draft().variantImages };
    if (current[value] === url) delete current[value];
    else current[value] = url;
    this.patch({ variantImages: current });
  }

  attrPlaceholder(attr: ProductVariantAttribute): string {
    const name = attr.name.trim().toLowerCase();
    if (name.startsWith('cor')) return 'Ex.: Preto, Azul, Verde';
    if (name.startsWith('armazen') || name.startsWith('memó') || name.startsWith('memo')) return 'Ex.: 128 GB, 256 GB';
    if (name.startsWith('tamanho')) return 'Ex.: P, M, G ou 38, 39, 40';
    if (name.startsWith('volt')) return 'Ex.: 110V, 220V, Bivolt';
    return 'Digite e tecle Enter (vírgula separa várias)';
  }

  // ------------------------------------------------------------ ficha

  addSpec(label = '') {
    const specs = this.draft().specs;
    if (specs.length >= this.maxSpecs) return;
    this.patch({ specs: [...specs, { label, value: '' }] });
    if (label) {
      // Foco direto no valor da característica recém-criada.
      setTimeout(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>('.ce-spec__value');
        inputs[inputs.length - 1]?.focus();
      });
    }
  }

  updateSpec(index: number, field: 'label' | 'value', event: Event) {
    const value = (event.target as HTMLInputElement).value.slice(0, 80);
    this.patch({ specs: this.draft().specs.map((s, i) => (i === index ? { ...s, [field]: value } : s)) });
  }

  moveSpec(index: number, delta: number) {
    const specs = [...this.draft().specs];
    const target = index + delta;
    if (target < 0 || target >= specs.length) return;
    [specs[index], specs[target]] = [specs[target], specs[index]];
    this.patch({ specs });
  }

  removeSpec(index: number) {
    this.patch({ specs: this.draft().specs.filter((_, i) => i !== index) });
  }

  // ------------------------------------------------------------ ações

  async save() {
    this.showErrors.set(true);
    const d = this.draft();

    if (this.uploads() > 0) {
      await this.toast('Espere as fotos terminarem de subir.', 'danger');
      return;
    }
    if (!d.title.trim()) {
      await this.toast('Dê um nome ao produto para salvar.', 'danger');
      document.getElementById('ce-title')?.focus();
      return;
    }
    if (d.status === 'active' && !this.ready()) {
      const missing = this.missingRequired().map(c => c.label.toLowerCase()).join(', ');
      await this.toast(`Para ficar ativo falta: ${missing}. Complete ou salve como rascunho.`, 'danger');
      return;
    }

    this.saving.set(true);
    try {
      const id = await this.catalog.save(d);
      this.initial.set(snapshot(this.draft()));
      await this.toast(d.status === 'active' ? 'Salvo. Os vendedores já encontram este produto.' : 'Rascunho salvo.', 'success');
      this.closed.emit(id);
    } catch (err) {
      console.error('[catálogo] salvar', err);
      await this.toast('Não deu para salvar. Confira a conexão e tente de novo.', 'danger');
    } finally {
      this.saving.set(false);
    }
  }

  async back() {
    if (this.dirty() && !(await this.confirm('Sair sem salvar?', 'As alterações desta ficha serão perdidas.', 'Descartar', true))) return;
    this.closed.emit(null);
  }

  async duplicate() {
    if (this.dirty() && !(await this.confirm('Duplicar sem salvar?', 'A cópia leva o que está na tela; esta ficha fica como estava.', 'Duplicar'))) return;
    const d = clone(this.draft());
    this.duplicated.emit({
      ...d,
      id: undefined,
      title: `${d.title} (cópia)`,
      // Código de barras é de um produto só.
      gtins: [],
      status: 'draft',
      createdAt: undefined,
      updatedAt: undefined,
    });
  }

  async remove() {
    const id = this.draft().id;
    if (!id) return;
    const listings = this.listings();
    const message = listings
      ? `${listings} ${listings === 1 ? 'anúncio usa' : 'anúncios usam'} esta ficha. Eles continuam no ar, com as informações que já copiaram; só saem da busca do catálogo.`
      : 'O produto sai do catálogo e os vendedores deixam de encontrá-lo.';
    if (!(await this.confirm('Excluir do catálogo?', message, 'Excluir', true))) return;
    try {
      await this.catalog.remove(id);
      await this.toast('Produto excluído do catálogo.', 'success');
      this.closed.emit(null);
    } catch (err) {
      console.error('[catálogo] excluir', err);
      await this.toast('Não deu para excluir. Tente de novo.', 'danger');
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  onUnload(event: BeforeUnloadEvent) {
    if (this.dirty()) event.preventDefault();
  }

  // ------------------------------------------------------------ apoio

  private blank(): CatalogProduct {
    return {
      title: '', brand: '', model: '', line: '', categoryId: '', subcategoryId: null, photos: [], specs: [], gtins: [],
      aliases: [], variantAttributes: [], variantImages: {}, weight: null, width: null, height: null, length: null,
      description: '', referencePrice: null, status: 'draft',
    };
  }

  private async confirm(header: string, message: string, okText: string, destructive = false): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: [
        { text: 'Voltar', role: 'cancel' },
        { text: okText, role: destructive ? 'destructive' : 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm' || role === 'destructive';
  }

  private async toast(message: string, color: 'success' | 'danger') {
    const toast = await this.toastCtrl.create({ message, color: color === 'success' ? 'dark' : 'danger', duration: 3200, position: 'bottom' });
    await toast.present();
  }
}

function clone(product: CatalogProduct): CatalogProduct {
  return {
    ...product,
    photos: [...(product.photos || [])],
    specs: (product.specs || []).map(s => ({ ...s })),
    gtins: [...(product.gtins || [])],
    aliases: [...(product.aliases || [])],
    variantAttributes: (product.variantAttributes || []).map(a => ({ name: a.name, values: [...a.values] })),
    variantImages: { ...(product.variantImages || {}) },
  };
}

/** Só o que o admin edita, para saber se há mudança não salva. */
function snapshot(p: CatalogProduct): string {
  return JSON.stringify([
    p.title, p.brand, p.model, p.line, p.categoryId, p.subcategoryId, p.photos, p.specs, p.gtins, p.aliases,
    p.variantAttributes, p.variantImages, p.weight, p.width, p.height, p.length, p.description, p.referencePrice, p.status,
  ]);
}
