import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertController, IonicModule, NavController, ToastController } from '@ionic/angular';

import { VnIconComponent } from 'src/app/components/vn-icon/vn-icon.component';
import { onAuthUserChanged } from 'src/app/core/auth-state';
import { formatBRL, normalizeSearch, toDate } from 'src/app/core/order-stage';
import { MODERATION_LABEL } from 'src/app/core/product-moderation';
import { ListingStatus, listingStatus } from 'src/app/core/seller-metrics';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';

type ListingFilter = 'all' | 'active' | 'out' | 'hidden';
type ListingSort = 'recent' | 'sold' | 'stock' | 'price';

const FILTERS: { id: ListingFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'No ar' },
  { id: 'out', label: 'Sem estoque' },
  { id: 'hidden', label: 'Fora do ar' },
];

const SORTS: { id: ListingSort; label: string }[] = [
  { id: 'recent', label: 'Mais recentes' },
  { id: 'sold', label: 'Mais vendidos' },
  { id: 'stock', label: 'Menor estoque' },
  { id: 'price', label: 'Maior preço' },
];

const STATUS_LABEL: Record<ListingStatus, string> = {
  active: 'No ar',
  low: 'Estoque baixo',
  out: 'Sem estoque',
  hidden: 'Fora do ar',
};

interface ListingRow {
  product: Product;
  id: string;
  status: ListingStatus;
  statusLabel: string;
  photo: string;
  price: number;
  listPrice: number | null;
  stock: number;
  sold: number;
  saved: number;
  rating: number | null;
  reviews: number;
  created: number;
}

/**
 * Meus anúncios: a lista da loja com situação de cada anúncio (no ar, estoque
 * baixo, sem estoque, fora do ar), busca, ordenação e as ações de cada um.
 *
 * O cartão abre "Meu anúncio"; editar, ver no site e excluir são botões à
 * parte (antes ficavam dentro do link e abriam as duas coisas ao mesmo tempo).
 */
@Component({
  selector: 'app-my-products',
  templateUrl: './my-products.page.html',
  styleUrls: ['./my-products.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, VnIconComponent],
})
export class MyProductsPage {
  private readonly fbProducts = inject(FirebaseProducts);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly navCtrl = inject(NavController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly destroyRef = inject(DestroyRef);

  readonly filters = FILTERS;
  readonly sorts = SORTS;
  readonly moderationLabel = MODERATION_LABEL;

  readonly products = signal<Product[] | null>(null);
  readonly failed = signal(false);
  readonly filter = signal<ListingFilter>(this.initialFilter());
  readonly sort = signal<ListingSort>('recent');
  readonly search = signal('');
  readonly deleting = signal<string | null>(null);

  readonly rows = computed<ListingRow[]>(() => (this.products() ?? []).map(p => {
    const status = listingStatus(p);
    const promo = p.priceDiscounted && p.priceDiscounted < p.price ? p.priceDiscounted : null;
    return {
      product: p,
      id: p.id || '',
      status,
      statusLabel: status === 'hidden' && p.moderation ? `Fora do ar · ${MODERATION_LABEL[p.moderation.reason]}` : STATUS_LABEL[status],
      photo: p.photoURL?.[0] || '',
      price: promo ?? p.price,
      listPrice: promo ? p.price : null,
      stock: p.stock || 0,
      sold: p.soldCount || 0,
      saved: p.savedCount || 0,
      rating: p.reviewCount ? p.rating ?? null : null,
      reviews: p.reviewCount || 0,
      created: toDate(p.createdAt)?.getTime() ?? 0,
    };
  }));

  readonly counts = computed(() => {
    const rows = this.rows();
    return {
      all: rows.length,
      active: rows.filter(r => r.status === 'active' || r.status === 'low').length,
      out: rows.filter(r => r.status === 'out').length,
      hidden: rows.filter(r => r.status === 'hidden').length,
      low: rows.filter(r => r.status === 'low').length,
    };
  });

  readonly summary = computed(() => {
    const live = this.rows().filter(r => r.status !== 'hidden');
    return {
      units: live.reduce((sum, r) => sum + r.stock, 0),
      // Valor do que está parado no estoque, pelo preço de venda (combinação a combinação).
      stockValue: live.reduce((sum, r) => sum + stockValue(r.product), 0),
      sold: this.rows().reduce((sum, r) => sum + r.sold, 0),
    };
  });

  readonly visible = computed(() => {
    const f = this.filter();
    const term = normalizeSearch(this.search().trim());
    const list = this.rows().filter(r => {
      if (f === 'active' && r.status !== 'active' && r.status !== 'low') return false;
      if (f !== 'all' && f !== 'active' && r.status !== f) return false;
      return !term || normalizeSearch(r.product.name || '').includes(term);
    });
    const by = this.sort();
    return list.sort((a, b) => {
      if (by === 'sold') return b.sold - a.sold || b.created - a.created;
      if (by === 'stock') return a.stock - b.stock || b.created - a.created;
      if (by === 'price') return b.price - a.price;
      return b.created - a.created;
    });
  });

  constructor() {
    let stop: (() => void) | undefined;
    const stopAuth = onAuthUserChanged(user => {
      stop?.();
      if (!user) return;
      const sub = this.fbProducts.getBySeller(user.uid, true).subscribe({
        next: products => {
          this.products.set(products);
          this.failed.set(false);
        },
        error: err => {
          console.error('[meus anúncios]', err);
          this.failed.set(true);
        },
      });
      stop = () => sub.unsubscribe();
    });
    this.destroyRef.onDestroy(() => {
      stopAuth();
      stop?.();
    });
  }

  private initialFilter(): ListingFilter {
    const q = this.route.snapshot.queryParamMap.get('filtro');
    return FILTERS.some(f => f.id === q) ? (q as ListingFilter) : 'all';
  }

  setFilter(filter: ListingFilter) {
    this.filter.set(filter);
    void this.router.navigate([], { queryParams: { filtro: filter === 'all' ? null : filter }, replaceUrl: true, queryParamsHandling: 'merge' });
  }

  // ------------------------------------------------------------ ações

  edit(row: ListingRow) {
    void this.router.navigate(['/edit-product', row.id]);
  }

  async remove(row: ListingRow) {
    if (!row.id || this.deleting()) return;
    const alert = await this.alertCtrl.create({
      header: 'Excluir anúncio?',
      message: `"${row.product.name}" sai da vitrine e não pode ser recuperado. Vendas já feitas continuam no seu histórico.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Excluir anúncio', role: 'destructive' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;

    this.deleting.set(row.id);
    try {
      await this.fbProducts.delete(row.id);
      await this.toast('Anúncio excluído.', 'success');
    } catch (err) {
      console.error('[meus anúncios] excluir', err);
      await this.toast('Não deu para excluir agora. Tente de novo.', 'danger');
    } finally {
      this.deleting.set(null);
    }
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }

  // ------------------------------------------------------------ formato

  brl(value: number): string {
    return formatBRL(value || 0);
  }

  int(value: number): string {
    return new Intl.NumberFormat('pt-BR').format(value || 0);
  }

  rating(value: number): string {
    return value.toFixed(1).replace('.', ',');
  }

  private async toast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 3000, color, position: 'bottom' });
    await t.present();
  }
}

function stockValue(p: Product): number {
  const base = p.priceDiscounted && p.priceDiscounted < p.price ? p.priceDiscounted : p.price;
  if (p.hasVariants && p.skus) {
    // Combinação sem preço próprio usa o preço do anúncio.
    return Object.values(p.skus).reduce((sum, sku) => sum + (sku.price ?? base) * (sku.stock || 0), 0);
  }
  return base * (p.stock || 0);
}
