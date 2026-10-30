import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { Subscription, catchError, combineLatest, map, of } from 'rxjs';

import { VnIconComponent } from '../../components/vn-icon/vn-icon.component';
import { formatBRL, normalizeSearch, toDate } from '../../core/order-stage';
import { hasFreeShipping, priceMain } from '../../core/product-pricing';
import { Product } from '../../interfaces/product';
import { SavedItem } from '../../interfaces/saved-item';
import { AppConfigService } from '../../services/app-config.service';
import { FirebaseCartService } from '../../services/firebase-cart.service';
import { FirebaseProducts } from '../../services/firebase-products';
import { FirebaseSavedService } from '../../services/firebase-saved.service';
import { SellerDirectoryService } from '../../services/seller-directory.service';

/** Por que um favorito não pode ser comprado agora. */
type Unavailable = 'gone' | 'hidden' | 'out';
type SavedFilter = 'all' | 'deals' | 'unavailable';

interface SavedRow {
  item: SavedItem;
  id: string;
  productId: string;
  /** O anúncio como está agora; `null` quando foi excluído. */
  live: Product | null;
  /** O que mostrar: o anúncio atual ou, se sumiu, a cópia de quando foi salvo. */
  shown: Product;
  unavailable: Unavailable | null;
  price: number;
  listPrice: number | null;
  /** Quanto o preço caiu (0–1) desde que a pessoa salvou. */
  drop: number;
  freeShipping: boolean;
  localDelivery: boolean;
  savedAt: number;
}

const UNAVAILABLE_LABEL: Record<Unavailable, string> = {
  gone: 'Não está mais à venda',
  hidden: 'Fora do ar',
  out: 'Esgotado',
};

/** Quanto tempo o aviso com "Desfazer" fica na tela. */
const UNDO_MS = 4500;

/**
 * Favoritos: o que a pessoa salvou, sempre com o anúncio de agora.
 *
 * O salvo guarda uma cópia do produto do dia em que foi salvo. Antes a tela
 * mostrava só essa cópia: preço velho, anúncio excluído aparecendo como se
 * existisse (e indo para o carrinho), nome de loja e "frete grátis" fixos.
 * Agora cada favorito lê o anúncio ao vivo; o que sumiu, esgotou ou saiu do
 * ar aparece como indisponível e pode ser limpo de uma vez.
 */
@Component({
  selector: 'app-saved-page',
  templateUrl: './saved.page.html',
  styleUrls: ['./saved.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, VnIconComponent],
})
export class SavedPage {
  private readonly savedService = inject(FirebaseSavedService);
  private readonly products = inject(FirebaseProducts);
  private readonly cart = inject(FirebaseCartService);
  private readonly sellers = inject(SellerDirectoryService);
  private readonly appConfig = inject(AppConfigService);
  private readonly toastCtrl = inject(ToastController);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly filters: { id: SavedFilter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'deals', label: 'Baixou de preço' },
    { id: 'unavailable', label: 'Indisponíveis' },
  ];

  readonly items = signal<SavedItem[] | null>(null);
  readonly liveById = signal<Record<string, Product | null>>({});
  readonly failed = signal(false);
  readonly filter = signal<SavedFilter>('all');
  readonly search = signal('');
  /** Removidos que somem da tela na hora, antes de o Firestore confirmar. */
  readonly pending = signal<Set<string>>(new Set());
  readonly cartQty = signal<Record<string, number>>({});
  readonly adding = signal<string | null>(null);

  private liveSub?: Subscription;

  readonly rows = computed<SavedRow[]>(() => {
    const items = this.items() ?? [];
    const live = this.liveById();
    const rule = this.appConfig.freeShippingRule();
    const hidden = this.pending();
    return items
      .filter(item => item.id && !hidden.has(item.id))
      .map(item => {
        const current = item.productId in live ? live[item.productId] : undefined;
        const shown = current ?? item.productData;
        const unavailable: Unavailable | null = current === null ? 'gone'
          : current?.moderation?.hidden ? 'hidden'
          : current && (current.stock || 0) <= 0 ? 'out'
          : null;
        const price = priceMain(shown);
        const savedPrice = priceMain(item.productData);
        return {
          item,
          id: item.id!,
          productId: item.productId,
          live: current ?? null,
          shown,
          unavailable,
          price,
          listPrice: shown.priceDiscounted && shown.priceDiscounted < shown.price ? shown.price : null,
          drop: current && !unavailable && savedPrice > 0 && price < savedPrice ? 1 - price / savedPrice : 0,
          freeShipping: !!current && hasFreeShipping(current, rule),
          localDelivery: !!current?.localDelivery?.cities?.length,
          savedAt: toDate(item.savedAt)?.getTime() ?? 0,
        };
      });
  });

  readonly counts = computed(() => {
    const rows = this.rows();
    return {
      all: rows.length,
      deals: rows.filter(r => r.drop > 0).length,
      unavailable: rows.filter(r => r.unavailable).length,
    };
  });

  readonly visible = computed(() => {
    const f = this.filter();
    const term = normalizeSearch(this.search().trim());
    return this.rows().filter(r => {
      if (f === 'deals' && !(r.drop > 0)) return false;
      if (f === 'unavailable' && !r.unavailable) return false;
      return !term || normalizeSearch(r.shown.name || '').includes(term);
    });
  });

  /** Ainda esperando a leitura dos anúncios: sem isso tudo piscaria como "disponível". */
  readonly resolving = computed(() => {
    const live = this.liveById();
    return (this.items() ?? []).some(i => !(i.productId in live));
  });

  constructor() {
    const savedSub = this.savedService.getAllSaved().subscribe({
      next: items => {
        this.items.set(items);
        // Quem já saiu do banco deixa de estar pendente (se voltar pelo Desfazer, aparece de novo).
        const present = new Set(items.map(i => i.id));
        this.pending.update(set => new Set([...set].filter(id => present.has(id))));
        this.failed.set(false);
        this.watchProducts(items);
      },
      error: err => {
        console.error('[favoritos]', err);
        this.failed.set(true);
      },
    });
    const cartSub = this.cart.getAllCartItems().subscribe({
      next: items => {
        const qty: Record<string, number> = {};
        for (const i of items) qty[i.productId] = (qty[i.productId] || 0) + (i.quantity || 0);
        this.cartQty.set(qty);
      },
      error: () => this.cartQty.set({}),
    });

    // Nome das lojas (leitura pública de sellers/{uid}, uma vez por loja).
    effect(() => {
      const ids = this.rows().map(r => r.shown.sellerId).filter((id): id is string => !!id);
      if (ids.length) void this.sellers.ensure(ids);
    });

    this.destroyRef.onDestroy(() => {
      savedSub.unsubscribe();
      cartSub.unsubscribe();
      this.liveSub?.unsubscribe();
    });
  }

  /** Um ouvinte por anúncio salvo (o serviço reaproveita o mesmo fluxo por id). */
  private watchProducts(items: SavedItem[]) {
    this.liveSub?.unsubscribe();
    const ids = [...new Set(items.map(i => i.productId).filter(Boolean))];
    if (!ids.length) {
      this.liveById.set({});
      return;
    }
    this.liveSub = combineLatest(ids.map(id => this.products.getById(id).pipe(
      map(p => [id, p] as const),
      // Sem permissão ou falha de leitura: trata como indisponível, sem quebrar a lista.
      catchError(() => of([id, null] as const)),
    ))).subscribe(entries => this.liveById.set(Object.fromEntries(entries)));
  }

  // ------------------------------------------------------------ ações

  setFilter(f: SavedFilter) {
    this.filter.set(f);
  }

  open(row: SavedRow) {
    if (row.unavailable === 'gone') return;
    void this.router.navigate(['/product-details', row.productId]);
  }

  async addToCart(row: SavedRow) {
    if (!row.live || row.unavailable || this.adding()) return;
    // Com variações a pessoa precisa escolher a combinação na página do produto.
    if (row.live.hasVariants) return this.open(row);
    this.adding.set(row.id);
    try {
      await this.cart.addToCart(row.live);
      await this.toast('Adicionado ao carrinho.', [{ text: 'Ver carrinho', handler: () => void this.router.navigate(['/tabs/cart']) }]);
    } catch (err) {
      console.error('[favoritos] carrinho', err);
      await this.toast('Não deu para adicionar agora. Tente de novo.');
    } finally {
      this.adding.set(null);
    }
  }

  /**
   * Apaga na hora e oferece "Desfazer", que grava o mesmo documento de volta.
   * (Esperar o fim do aviso para apagar perdia a remoção se a página
   * recarregasse nesse meio-tempo.)
   */
  async remove(rows: SavedRow[]) {
    if (!rows.length) return;
    const ids = rows.map(r => r.id);
    this.pending.update(set => new Set([...set, ...ids]));
    const results = await Promise.allSettled(rows.map(r => this.savedService.removeProduct(r.id)));
    const failed = rows.filter((_, i) => results[i].status === 'rejected');
    const removed = rows.filter((_, i) => results[i].status === 'fulfilled');
    this.unhide(failed.map(r => r.id));
    if (failed.length) await this.toast('Não deu para remover agora. Tente de novo.');
    if (!removed.length) return;
    const message = removed.length === 1 ? 'Removido dos favoritos.' : `${removed.length} favoritos removidos.`;
    await this.toast(message, [{ text: 'Desfazer', handler: () => void this.undo(removed) }], UNDO_MS);
  }

  removeUnavailable() {
    void this.remove(this.rows().filter(r => r.unavailable));
    if (this.filter() === 'unavailable') this.filter.set('all');
  }

  private async undo(rows: SavedRow[]) {
    const results = await Promise.allSettled(rows.map(r => this.savedService.restore(r.item)));
    if (results.some(r => r.status === 'rejected')) await this.toast('Não deu para desfazer. Salve o produto de novo pela página dele.');
  }

  /** Volta a mostrar (o ouvinte do Firestore é quem tira de vez quando o documento some). */
  private unhide(ids: string[]) {
    if (ids.length) this.pending.update(set => new Set([...set].filter(id => !ids.includes(id))));
  }

  // ------------------------------------------------------------ formato

  shopName(row: SavedRow): string {
    return this.sellers.name(row.shown.sellerId);
  }

  unavailableLabel(row: SavedRow): string {
    return row.unavailable ? UNAVAILABLE_LABEL[row.unavailable] : '';
  }

  brl(value: number): string {
    return formatBRL(value || 0);
  }

  pct(value: number): string {
    return `${Math.max(1, Math.round(value * 100))}%`;
  }

  private async toast(message: string, buttons: { text: string; handler: () => void }[] = [], duration = 3000) {
    const t = await this.toastCtrl.create({ message, duration, position: 'bottom', color: 'dark', buttons });
    await t.present();
  }
}
