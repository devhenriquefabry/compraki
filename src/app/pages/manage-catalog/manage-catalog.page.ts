import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonicModule } from '@ionic/angular';

import { catalogCode, catalogPhotos, emptyCatalogProduct, normalizeText, qualityScore, variantSummary } from '../../core/catalog';
import { catalogCover } from '../../core/catalog-illustrations';
import { CatalogProduct } from '../../interfaces/catalog';
import { Category } from '../../interfaces/category';
import { CatalogService } from '../../services/catalog.service';
import { FirebaseCategories } from '../../services/firebase-categories';
import { CatalogEditorComponent } from './catalog-editor/catalog-editor.component';

type StatusFilter = 'all' | 'active' | 'draft' | 'incomplete';

interface CatalogRow {
  item: CatalogProduct;
  code: string;
  category: string;
  variants: string;
  quality: number;
  listings: number;
}

/** Abaixo disto a ficha aparece em "Incompletos". */
const GOOD_QUALITY = 80;

/**
 * Aba "Catálogo" do painel: as fichas prontas que o vendedor usa para
 * anunciar produto novo (molde do catálogo do Mercado Livre, com a cara da
 * Vineon). Lista com filtros e, ao abrir um item, o editor completo.
 */
@Component({
  selector: 'app-manage-catalog',
  templateUrl: './manage-catalog.page.html',
  styleUrls: ['./manage-catalog.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, CatalogEditorComponent],
})
export class ManageCatalogPage {
  private readonly catalog = inject(CatalogService);
  private readonly categoriesService = inject(FirebaseCategories);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<CatalogProduct[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly counts = signal<Map<string, number>>(new Map());
  readonly loading = signal(true);
  readonly error = signal('');

  readonly filter = signal<StatusFilter>('all');
  readonly search = signal('');
  readonly categoryFilter = signal('');

  /** Item aberto no editor; `null` mostra a lista. */
  readonly editing = signal<CatalogProduct | null>(null);
  /** Último salvo, para destacar o cartão ao voltar para a lista. */
  readonly lastSavedId = signal<string | null>(null);

  readonly rows = computed<CatalogRow[]>(() => {
    const names = new Map(this.categories().map(c => [c.id, c]));
    const counts = this.counts();
    return this.items().map(item => {
      const category = names.get(item.categoryId);
      const sub = category?.subcategories?.find(s => s.id === item.subcategoryId);
      return {
        item,
        code: catalogCode(item.id),
        category: category ? (sub ? `${category.name} › ${sub.name}` : category.name) : 'Sem categoria',
        variants: variantSummary(item.variantAttributes),
        quality: qualityScore(item),
        listings: counts.get(item.id!) ?? 0,
      };
    });
  });

  readonly activeCount = computed(() => this.items().filter(i => i.status === 'active').length);
  readonly draftCount = computed(() => this.items().length - this.activeCount());
  readonly incompleteCount = computed(() => this.rows().filter(r => r.quality < GOOD_QUALITY).length);
  readonly listingTotal = computed(() => this.rows().reduce((sum, r) => sum + r.listings, 0));
  readonly withGtin = computed(() => this.items().filter(i => i.gtins.length > 0).length);
  readonly avgQuality = computed(() => {
    const rows = this.rows();
    return rows.length ? Math.round(rows.reduce((sum, r) => sum + r.quality, 0) / rows.length) : 0;
  });

  /** Categorias que aparecem no catálogo, para o filtro. */
  readonly usedCategories = computed(() => {
    const used = new Set(this.items().map(i => i.categoryId));
    return this.categories().filter(c => used.has(c.id));
  });

  readonly visible = computed(() => {
    const filter = this.filter();
    const cat = this.categoryFilter();
    const term = normalizeText(this.search());
    return this.rows().filter(row => {
      if (filter === 'active' && row.item.status !== 'active') return false;
      if (filter === 'draft' && row.item.status !== 'draft') return false;
      if (filter === 'incomplete' && row.quality >= GOOD_QUALITY) return false;
      if (cat && row.item.categoryId !== cat) return false;
      if (!term) return true;
      const hay = normalizeText(`${row.item.title} ${row.item.brand} ${row.item.model} ${row.code} ${row.item.gtins.join(' ')}`);
      return term.split(/\s+/).every(t => hay.includes(t));
    });
  });

  constructor() {
    this.catalog.watchAll().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: items => {
        this.items.set(items);
        this.loading.set(false);
      },
      error: err => {
        console.error('[catálogo] lista', err);
        this.error.set('Não deu para carregar o catálogo. Confira a conexão e tente de novo.');
        this.loading.set(false);
      },
    });
    this.categoriesService.getAll().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(cats => this.categories.set(cats));
    void this.loadCounts();
  }

  private async loadCounts() {
    try {
      this.counts.set(await this.catalog.listingCounts());
    } catch (err) {
      console.warn('[catálogo] contagem de anúncios', err);
    }
  }

  // ------------------------------------------------------------- editor

  create() {
    this.editing.set(emptyCatalogProduct());
  }

  open(row: CatalogRow) {
    this.editing.set(row.item);
  }

  listingsOf(item: CatalogProduct | null): number {
    return item?.id ? this.counts().get(item.id) ?? 0 : 0;
  }

  onEditorClosed(savedId: string | null) {
    this.editing.set(null);
    if (savedId) {
      this.lastSavedId.set(savedId);
      setTimeout(() => this.lastSavedId.set(null), 2400);
    }
    void this.loadCounts();
    requestAnimationFrame(() => document.querySelector('.adm-content')?.scrollTo({ top: 0 }));
  }

  onDuplicate(copy: CatalogProduct) {
    this.editing.set(null);
    // Troca na próxima volta para o editor nascer de novo com a cópia.
    setTimeout(() => this.editing.set(copy));
  }

  clearFilters() {
    this.filter.set('all');
    this.search.set('');
    this.categoryFilter.set('');
  }

  cover(item: CatalogProduct): string {
    return catalogCover(item);
  }

  /** Fotos gerais + as de cada opção (cor…). */
  photoCount(item: CatalogProduct): number {
    return catalogPhotos(item).length;
  }

  qualityTone(quality: number): 'ok' | 'warn' | 'danger' {
    return quality >= GOOD_QUALITY ? 'ok' : quality >= 50 ? 'warn' : 'danger';
  }
}
