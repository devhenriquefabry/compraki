import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, NavController } from '@ionic/angular';

import { onAuthUserChanged } from '../../core/auth-state';
import { formatRate } from '../../core/commission';
import { formatBRL, toDate } from '../../core/order-stage';
import { SellerInvoice } from '../../interfaces/seller-invoice';
import { SellerInvoicesService, periodLabel, periodTitle } from '../../services/seller-invoices.service';

interface YearGroup {
  year: string;
  invoices: SellerInvoice[];
}

/**
 * "Notas fiscais" do vendedor: a nota mensal que a Vineon emite sobre a taxa
 * cobrada nas vendas da loja. Anexada pelo admin na aba Vendedores; chega
 * também por e-mail.
 */
@Component({
  selector: 'app-my-invoices',
  templateUrl: './my-invoices.page.html',
  styleUrls: ['./my-invoices.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class MyInvoicesPage {
  private readonly service = inject(SellerInvoicesService);
  private readonly navCtrl = inject(NavController);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly invoices = signal<SellerInvoice[]>([]);

  readonly unseen = computed(() => this.invoices().filter(inv => !inv.seenAt).length);
  readonly latest = computed(() => this.invoices()[0] ?? null);
  readonly groups = computed<YearGroup[]>(() => {
    const map = new Map<string, SellerInvoice[]>();
    for (const invoice of this.invoices()) {
      const year = invoice.period.slice(0, 4);
      map.set(year, [...(map.get(year) ?? []), invoice]);
    }
    return [...map.entries()].map(([year, invoices]) => ({ year, invoices }));
  });

  constructor() {
    let stopInvoices: (() => void) | undefined;
    const stopAuth = onAuthUserChanged(user => {
      stopInvoices?.();
      if (!user) {
        this.invoices.set([]);
        this.loading.set(false);
        return;
      }
      const sub = this.service.watchMyInvoices(user.uid).subscribe({
        next: list => {
          this.invoices.set(list);
          this.loading.set(false);
        },
        error: err => {
          console.error('[notas] lista', err);
          this.error.set('Não deu para carregar suas notas. Confira a conexão e tente de novo.');
          this.loading.set(false);
        },
      });
      stopInvoices = () => sub.unsubscribe();
    });
    this.destroyRef.onDestroy(() => {
      stopAuth();
      stopInvoices?.();
    });
  }

  month(invoice: SellerInvoice): string {
    return periodLabel(invoice.period).split(' de ')[0];
  }

  monthYear(invoice: SellerInvoice): string {
    return periodTitle(invoice.period);
  }

  rateLabel(invoice: SellerInvoice): string {
    return invoice.summary.commissionLabel || formatRate(invoice.summary.commissionRate || 0);
  }

  brl(value: number): string {
    return formatBRL(value || 0);
  }

  when(value: unknown): string {
    const date = toDate(value);
    return date ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' }).format(date) : '';
  }

  fileKind(invoice: SellerInvoice): string {
    const type = invoice.file.contentType || '';
    if (type.includes('pdf')) return 'PDF';
    if (type.includes('xml')) return 'XML';
    return 'Imagem';
  }

  open(invoice: SellerInvoice) {
    void this.service.markSeen(invoice);
    window.open(invoice.file.url, '_blank', 'noopener');
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/my-account');
  }
}
