import { Component, DestroyRef, ElementRef, OnInit, computed, inject, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonicModule, ToastController } from '@ionic/angular';

import { normalizeText, onlyDigits, queryTokens, variantSummary } from '../../../core/catalog';
import { catalogCover } from '../../../core/catalog-illustrations';
import { CatalogProduct } from '../../../interfaces/catalog';
import { Category } from '../../../interfaces/category';
import { CatalogService } from '../../../services/catalog.service';
import { FirebaseCategories } from '../../../services/firebase-categories';

type SearchMode = 'name' | 'code';

interface TitlePart {
  text: string;
  hit: boolean;
}

interface ResultView {
  item: CatalogProduct;
  title: TitlePart[];
  category: string;
  variants: string;
}

const DEBOUNCE_MS = 260;

/**
 * Passo 1 do "Anunciar": o vendedor procura o produto no catálogo Vineon por
 * nome/modelo ou pelo código de barras (digitado ou lido da foto da caixa).
 * Sem termo, mostra categorias e os destaques do catálogo. Sempre há a saída
 * "criar anúncio do zero" para usado, artesanal ou fora do catálogo.
 */
@Component({
  selector: 'app-catalog-finder',
  templateUrl: './catalog-finder.component.html',
  styleUrls: ['./catalog-finder.component.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class CatalogFinderComponent implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly categoriesService = inject(FirebaseCategories);
  private readonly toastCtrl = inject(ToastController);
  private readonly destroyRef = inject(DestroyRef);

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly picked = output<CatalogProduct>();
  readonly manual = output<void>();

  readonly mode = signal<SearchMode>('name');
  readonly term = signal('');
  readonly searching = signal(false);
  readonly results = signal<CatalogProduct[]>([]);
  /** Termo cuja busca terminou (evita piscar "nada encontrado" enquanto digita). */
  readonly searchedTerm = signal('');

  readonly categories = signal<Category[]>([]);
  readonly browseCategory = signal<Category | null>(null);
  readonly browseItems = signal<CatalogProduct[]>([]);
  readonly browsing = signal(false);

  readonly featured = signal<CatalogProduct[]>([]);
  readonly featuredLoaded = signal(false);

  readonly brandFilter = signal('');
  readonly scanning = signal(false);

  readonly canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  readonly hasTerm = computed(() => this.term().trim().length > 0);
  readonly isCodeTerm = computed(() => /^\d{8,14}$/.test(onlyDigits(this.term())) && !/[a-z]/i.test(this.term()));

  /** Resultado atual: busca, ou a categoria aberta. */
  private readonly source = computed(() => (this.hasTerm() ? this.results() : this.browseItems()));

  readonly brands = computed(() => {
    const counts = new Map<string, number>();
    for (const item of this.source()) {
      const brand = item.brand.trim();
      if (brand) counts.set(brand, (counts.get(brand) ?? 0) + 1);
    }
    return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  });

  readonly visible = computed<ResultView[]>(() => {
    const brand = this.brandFilter();
    const tokens = this.hasTerm() ? queryTokens(this.term()) : [];
    return this.source()
      .filter(item => !brand || item.brand.trim() === brand)
      .map(item => ({
        item,
        title: highlight(item.title, tokens),
        category: this.categoryName(item),
        variants: variantSummary(item.variantAttributes),
      }));
  });

  readonly showResults = computed(() => this.hasTerm() || !!this.browseCategory());
  readonly nothingFound = computed(() =>
    this.hasTerm() && !this.searching() && this.searchedTerm() === this.term().trim() && this.results().length === 0);

  ngOnInit() {
    this.categoriesService.getAll().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(cats => this.categories.set(cats));
    void this.loadFeatured();
  }

  private async loadFeatured() {
    try {
      this.featured.set(await this.catalog.listRecent(8));
    } catch (err) {
      console.warn('[anunciar] destaques do catálogo', err);
    } finally {
      this.featuredLoaded.set(true);
    }
  }

  // ------------------------------------------------------------ busca

  setMode(mode: SearchMode) {
    if (this.mode() === mode) return;
    this.mode.set(mode);
    this.clear();
    setTimeout(() => this.searchInput()?.nativeElement.focus());
  }

  onInput(value: string) {
    this.term.set(value);
    this.brandFilter.set('');
    if (this.timer) clearTimeout(this.timer);
    if (!value.trim()) {
      this.results.set([]);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.timer = setTimeout(() => void this.run(value), DEBOUNCE_MS);
  }

  submit(event: Event) {
    event.preventDefault();
    if (this.timer) clearTimeout(this.timer);
    void this.run(this.term());
    this.searchInput()?.nativeElement.blur();
  }

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.term.set('');
    this.results.set([]);
    this.searchedTerm.set('');
    this.searching.set(false);
    this.brandFilter.set('');
  }

  focusSearch() {
    this.searchInput()?.nativeElement.focus();
  }

  private async run(raw: string) {
    const term = raw.trim();
    if (!term) return;
    const seq = ++this.seq;
    this.searching.set(true);
    try {
      const digits = onlyDigits(term);
      const byCode = this.mode() === 'code' || (/^\d{8,14}$/.test(digits) && !/[a-z]/i.test(term));
      const found = byCode ? await this.catalog.findByGtin(digits) : await this.catalog.search(term);
      if (seq !== this.seq) return;
      this.results.set(found);
      this.searchedTerm.set(term);
      this.browseCategory.set(null);
    } catch (err) {
      if (seq !== this.seq) return;
      console.error('[anunciar] busca no catálogo', err);
      await this.toast('Não deu para buscar agora. Confira a conexão.');
    } finally {
      if (seq === this.seq) this.searching.set(false);
    }
  }

  // ------------------------------------------------------ código de barras

  async onScanPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.scanning.set(true);
    try {
      const Detector = (window as unknown as { BarcodeDetector: new (o: object) => { detect(s: ImageBitmap): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      const code = codes.map(c => onlyDigits(c.rawValue)).find(c => c.length >= 8);
      if (!code) {
        await this.toast('Não achamos um código de barras na foto. Chegue mais perto e tente de novo, ou digite os números.');
        return;
      }
      this.mode.set('code');
      this.term.set(code);
      await this.run(code);
    } catch (err) {
      console.warn('[anunciar] leitura do código', err);
      await this.toast('Não deu para ler a foto. Digite os números do código.');
    } finally {
      this.scanning.set(false);
    }
  }

  // ------------------------------------------------------------ categorias

  async openCategory(category: Category) {
    this.clear();
    this.browseCategory.set(category);
    this.browseItems.set([]);
    this.browsing.set(true);
    try {
      this.browseItems.set(await this.catalog.listByCategory(category.id));
    } catch (err) {
      console.error('[anunciar] categoria do catálogo', err);
      await this.toast('Não deu para abrir a categoria. Tente de novo.');
    } finally {
      this.browsing.set(false);
    }
  }

  closeCategory() {
    this.browseCategory.set(null);
    this.browseItems.set([]);
    this.brandFilter.set('');
  }

  // ------------------------------------------------------------ apoio

  categoryName(item: CatalogProduct): string {
    const cat = this.categories().find(c => c.id === item.categoryId);
    if (!cat) return '';
    const sub = cat.subcategories?.find(s => s.id === item.subcategoryId);
    return sub?.name ?? cat.name;
  }

  /** Foto oficial ou, sem ela, a imagem ilustrativa do tipo de produto. */
  cover(item: CatalogProduct): string {
    return catalogCover(item);
  }

  toggleBrand(name: string) {
    this.brandFilter.update(current => (current === name ? '' : name));
  }

  private async toast(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3200, position: 'bottom', color: 'dark' });
    await toast.present();
  }
}

/** Divide o título em pedaços, marcando as palavras que bateram com a busca. */
function highlight(title: string, tokens: string[]): TitlePart[] {
  if (!tokens.length) return [{ text: title, hit: false }];
  return title.split(/(\s+)/).map(chunk => {
    const word = normalizeText(chunk).replace(/[^a-z0-9]/g, '');
    return { text: chunk, hit: !!word && tokens.some(t => word.startsWith(t)) };
  });
}
