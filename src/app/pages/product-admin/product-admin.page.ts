import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertController, IonicModule, NavController, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircle, arrowBack, cartOutline, cashOutline, checkmarkCircle, chevronForward, createOutline,
  eyeOutline, heartOutline, imagesOutline, layersOutline, shareSocialOutline, star, trashOutline,
} from 'ionicons/icons';

import { waitForAuthUser } from 'src/app/core/auth-state';
import {
  SALE_STAGE_LABEL, formatDay, isPaid, orderStage, paidUnitPrice, productIdOf, toDate,
} from 'src/app/core/order-stage';
import { Order } from 'src/app/interfaces/order';
import { Product } from 'src/app/interfaces/product';
import { FirebaseProducts } from 'src/app/services/firebase-products';
import { SalesService } from 'src/app/services/sales.service';

type AdminTab = 'overview' | 'manage';

interface QualityCheck {
  id: string;
  ok: boolean;
  label: string;
  hint: string;
}

/** Quantas vendas recentes a visão geral lista. */
const RECENT_SALES = 5;

@Component({
  selector: 'app-product-admin',
  templateUrl: './product-admin.page.html',
  styleUrls: ['./product-admin.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule],
})
export class ProductAdminPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly fbProducts = inject(FirebaseProducts);
  private readonly salesService = inject(SalesService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly tabs: { id: AdminTab; label: string }[] = [
    { id: 'overview', label: 'Desempenho' },
    { id: 'manage', label: 'Gerenciar' },
  ];

  readonly isLoading = signal(true);
  readonly product = signal<Product | null>(null);
  readonly orders = signal<Order[]>([]);
  readonly tab = signal<AdminTab>('overview');

  // Edição rápida
  readonly draftPrice = signal<number | null>(null);
  readonly draftPromo = signal<number | null>(null);
  readonly draftStock = signal<number | null>(null);
  readonly saving = signal(false);

  private productId = '';

  /** Linhas de venda deste produto, somando só os itens dele em cada pedido. */
  readonly sales = computed(() => {
    const id = this.productId;
    return this.orders()
      .map(order => {
        const lines = (order.items || []).filter(item => productIdOf(item) === id);
        if (!lines.length) return null;
        const stage = orderStage(order);
        return {
          id: order.id || '',
          buyer: firstName(order.customerData?.name),
          date: formatDay(toDate(order.createdAt), true),
          quantity: lines.reduce((s, i) => s + (i.quantity || 0), 0),
          amount: lines.reduce((s, i) => s + paidUnitPrice(i) * (i.quantity || 0), 0),
          variants: lines.map(i => i.variantLabel).filter(Boolean).join(' · '),
          stage,
          stageLabel: SALE_STAGE_LABEL[stage],
          counts: isPaid(order) && stage !== 'refund',
        };
      })
      .filter((s): s is NonNullable<typeof s> => !!s);
  });

  readonly recentSales = computed(() => this.sales().slice(0, RECENT_SALES));

  readonly metrics = computed(() => {
    const p = this.product();
    const counted = this.sales().filter(s => s.counts);
    return {
      units: counted.reduce((s, x) => s + x.quantity, 0),
      revenue: counted.reduce((s, x) => s + x.amount, 0),
      saved: p?.savedCount ?? 0,
      rating: p?.reviewCount ? (p.rating ?? 0) : null,
      reviews: p?.reviewCount ?? 0,
    };
  });

  /**
   * Checklist de qualidade: só critérios que o vendedor controla e que dá
   * para conferir no próprio documento. Nada de "conversão acima da média"
   * sem ter o dado.
   */
  readonly checks = computed<QualityCheck[]>(() => {
    const p = this.product();
    if (!p) return [];
    const photos = p.photoURL?.length ?? 0;
    const description = (p.description || '').trim().length;
    const specs = p.specs?.filter(s => s.label && s.value).length ?? 0;
    const dims = [p.weight, p.width, p.height, p.length].every(v => typeof v === 'number' && v > 0);
    return [
      { id: 'stock', ok: (p.stock ?? 0) > 0, label: 'Estoque disponível', hint: 'Sem estoque o anúncio não pode ser comprado.' },
      { id: 'photos', ok: photos >= 3, label: `Fotos (${photos} de 3+)`, hint: 'Mostre o produto de vários ângulos e com detalhes: mais fotos passam mais confiança.' },
      { id: 'description', ok: description >= 120, label: 'Descrição completa', hint: 'Conte material, medidas, estado e o que vem na caixa.' },
      { id: 'specs', ok: specs >= 3, label: `Ficha técnica (${specs} de 3+)`, hint: 'Marca, modelo e cor ajudam o produto a aparecer na busca.' },
      { id: 'dims', ok: dims, label: 'Peso e medidas para frete', hint: 'Sem eles o frete não é calculado no checkout.' },
    ];
  });

  readonly score = computed(() => this.checks().filter(c => c.ok).length);

  readonly hasPromo = computed(() => {
    const p = this.product();
    return !!p?.priceDiscounted && p.priceDiscounted < p.price;
  });

  readonly dirty = computed(() => {
    const p = this.product();
    if (!p) return false;
    return this.draftPrice() !== p.price
      || (this.draftPromo() ?? null) !== (p.priceDiscounted ?? null)
      || this.draftStock() !== p.stock;
  });

  constructor() {
    addIcons({
      alertCircle, arrowBack, cartOutline, cashOutline, checkmarkCircle, chevronForward, createOutline,
      eyeOutline, heartOutline, imagesOutline, layersOutline, shareSocialOutline, star, trashOutline,
    });

    const destroy = inject(DestroyRef);
    this.productId = this.route.snapshot.paramMap.get('id') || '';
    if (this.route.snapshot.queryParamMap.get('aba') === 'gerenciar') this.tab.set('manage');

    if (!this.productId) {
      this.isLoading.set(false);
      return;
    }

    const productSub = this.fbProducts.getById(this.productId).subscribe({
      next: product => {
        const first = !this.product();
        this.product.set(product);
        if (product && (first || !this.dirty())) this.resetDraft(product);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
    destroy.onDestroy(() => productSub.unsubscribe());

    void waitForAuthUser().then(user => {
      if (!user) return;
      const salesSub = this.salesService.getSellerSales(user.uid).subscribe({
        next: orders => this.orders.set(orders),
        error: err => console.warn('Vendas do anúncio indisponíveis', err),
      });
      destroy.onDestroy(() => salesSub.unsubscribe());
    });
  }

  // ------------------------------------------------------------------- UI

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/my-products');
  }

  selectTab(tab: AdminTab) {
    this.tab.set(tab);
  }

  openListing() {
    this.router.navigate(['/product-details', this.productId]);
  }

  edit() {
    this.router.navigate(['/edit-product', this.productId]);
  }

  openSale(id: string) {
    this.router.navigate(['/sale-details', id]);
  }

  async share() {
    const p = this.product();
    const url = `${window.location.origin}/product-details/${this.productId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: p?.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        this.toast('Link do anúncio copiado.', 'dark');
      }
    } catch {
      // Compartilhamento cancelado: nada a fazer.
    }
  }

  // --------------------------------------------------------- edição rápida

  private resetDraft(p: Product) {
    this.draftPrice.set(p.price ?? null);
    this.draftPromo.set(p.priceDiscounted ?? null);
    this.draftStock.set(p.stock ?? null);
  }

  discardDraft() {
    const p = this.product();
    if (p) this.resetDraft(p);
  }

  async saveQuickEdit() {
    const p = this.product();
    if (!p || this.saving()) return;

    const price = Number(this.draftPrice());
    const promoRaw = this.draftPromo();
    const promo = promoRaw === null || promoRaw === undefined || (promoRaw as any) === '' ? null : Number(promoRaw);
    const stock = Number(this.draftStock());

    if (!Number.isFinite(price) || price <= 0) return this.toast('Informe um preço maior que zero.', 'warning');
    if (promo !== null && (!Number.isFinite(promo) || promo <= 0 || promo >= price)) {
      return this.toast('O preço promocional precisa ser menor que o preço normal. Deixe em branco para tirar a promoção.', 'warning');
    }
    if (!Number.isInteger(stock) || stock < 0) return this.toast('O estoque precisa ser um número inteiro, zero ou mais.', 'warning');

    this.saving.set(true);
    try {
      await this.fbProducts.updateFields(this.productId, {
        price: round2(price),
        priceDiscounted: promo === null ? null : round2(promo),
        stock,
      });
      this.toast('Anúncio atualizado.', 'success');
    } catch (err) {
      console.error('Falha ao salvar anúncio', err);
      this.toast('Não foi possível salvar. Tente de novo.', 'danger');
    } finally {
      this.saving.set(false);
    }
  }

  async deleteProduct() {
    const p = this.product();
    if (!p) return;

    const alert = await this.alertCtrl.create({
      header: 'Excluir anúncio?',
      message: `"${p.name}" sai da vitrine e não pode ser recuperado. Vendas já feitas continuam no seu histórico.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Excluir anúncio', role: 'destructive' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;

    try {
      await this.fbProducts.delete(this.productId);
      this.toast('Anúncio excluído.', 'success');
      this.router.navigate(['/my-products']);
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível excluir o anúncio.', 'danger');
    }
  }

  private async toast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 3000, color, position: 'bottom' });
    await t.present();
  }

  readonly formatDay = formatDay;
  readonly toDate = toDate;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function firstName(name: string | undefined): string {
  const first = (name || '').trim().split(/\s+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : 'Comprador';
}
