import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { formatBRL, normalizeSearch, toDate } from '../../core/order-stage';
import { INVOICE_EMAIL_LABEL, SellerInvoice } from '../../interfaces/seller-invoice';
import {
  INVOICE_ACCEPT, INVOICE_MAX_BYTES, SellerMonthRow, SellersMonthReport, SellerInvoicesService,
  currentPeriod, periodLabel, periodTitle, shiftPeriod,
} from '../../services/seller-invoices.service';

type RowFilter = 'sales' | 'pending' | 'all';

interface InvoiceState {
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted';
  icon: string;
}

const ACCEPTED_EXT = /\.(pdf|xml|jpe?g|png|webp)$/i;

/**
 * Aba "Vendedores" do painel: o que cada loja vendeu no mês, a taxa que ficou
 * com a Vineon e a nota fiscal mensal que a Vineon emite para a loja. Anexar a
 * nota publica no perfil do vendedor e dispara o e-mail para ele.
 */
@Component({
  selector: 'app-manage-sellers',
  templateUrl: './manage-sellers.page.html',
  styleUrls: ['./manage-sellers.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class ManageSellersPage {
  private readonly service = inject(SellerInvoicesService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly destroyRef = inject(DestroyRef);

  readonly accept = INVOICE_ACCEPT;
  readonly thisMonth = currentPeriod();
  /** Últimos 24 meses, do mais recente para o mais antigo. */
  readonly monthOptions = Array.from({ length: 24 }, (_, i) => {
    const value = shiftPeriod(this.thisMonth, -i);
    return { value, label: periodTitle(value) };
  });

  readonly period = signal(this.thisMonth);
  readonly periodName = computed(() => periodLabel(this.period()));
  readonly periodHeading = computed(() => periodTitle(this.period()));
  readonly monthName = computed(() => this.periodName().split(' de ')[0]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly report = signal<SellersMonthReport | null>(null);
  readonly invoices = signal<Map<string, SellerInvoice>>(new Map());

  readonly filter = signal<RowFilter>('sales');
  readonly search = signal('');
  readonly expanded = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly dragOver = signal<string | null>(null);

  readonly rateLabel = computed(() => this.report()?.rateLabel ?? '');
  readonly withSales = computed(() => (this.report()?.rows ?? []).filter(r => r.grossRevenue > 0));
  readonly pending = computed(() => this.withSales().filter(r => !this.invoices().has(r.sellerId)));
  readonly invoicedCount = computed(() => this.withSales().length - this.pending().length);

  readonly rows = computed(() => {
    const all = this.report()?.rows ?? [];
    const base = this.filter() === 'sales' ? this.withSales() : this.filter() === 'pending' ? this.pending() : all;
    const term = normalizeSearch(this.search());
    if (!term) return base;
    return base.filter(r => normalizeSearch(`${r.name} ${r.shopName ?? ''} ${r.email ?? ''}`).includes(term));
  });

  readonly canGoNext = computed(() => this.period() < this.thisMonth);

  private invoiceSub?: Subscription;
  private loadSeq = 0;

  constructor() {
    effect(() => {
      const period = this.period();
      void this.load(period);
      this.watchInvoices(period);
    });
    this.destroyRef.onDestroy(() => this.invoiceSub?.unsubscribe());
  }

  // ------------------------------------------------------------- período

  stepMonth(delta: number) {
    const next = shiftPeriod(this.period(), delta);
    if (next > this.thisMonth) return;
    this.period.set(next);
  }

  pickMonth(value: string) {
    if (value) this.period.set(value);
  }

  private async load(period: string) {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set('');
    this.expanded.set(null);
    try {
      const report = await this.service.loadMonthReport(period);
      if (seq !== this.loadSeq) return;
      this.report.set(report);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      console.error('[vendedores] relatório', err);
      this.error.set('Não deu para carregar as vendas do mês. Confira a conexão e tente de novo.');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  reload() {
    void this.load(this.period());
  }

  private watchInvoices(period: string) {
    this.invoiceSub?.unsubscribe();
    this.invoices.set(new Map());
    this.invoiceSub = this.service.watchPeriodInvoices(period).subscribe({
      next: list => this.invoices.set(new Map(list.map(inv => [inv.sellerId, inv]))),
      error: err => console.error('[vendedores] notas', err),
    });
  }

  // ------------------------------------------------------------- linhas

  toggle(row: SellerMonthRow) {
    this.expanded.update(id => (id === row.sellerId ? null : row.sellerId));
  }

  invoiceOf(row: SellerMonthRow): SellerInvoice | undefined {
    return this.invoices().get(row.sellerId);
  }

  invoiceState(row: SellerMonthRow): InvoiceState {
    const invoice = this.invoiceOf(row);
    if (!invoice) {
      return row.grossRevenue > 0
        ? { label: 'Nota pendente', tone: 'warn', icon: 'time-outline' }
        : { label: 'Sem vendas', tone: 'muted', icon: 'remove-outline' };
    }
    const status = invoice.email?.status ?? 'sending';
    const tone: InvoiceState['tone'] =
      status === 'sent' ? 'ok' : status === 'failed' ? 'danger' : status === 'no_email' ? 'warn' : 'info';
    const icon = status === 'sent' ? 'checkmark-circle' : status === 'failed' ? 'alert-circle-outline' : 'mail-outline';
    return { label: status === 'sent' ? 'Nota enviada' : INVOICE_EMAIL_LABEL[status], tone, icon };
  }

  share(row: SellerMonthRow, revenue: number): number {
    return row.grossRevenue > 0 ? Math.max(2, (revenue / row.grossRevenue) * 100) : 0;
  }

  initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
  }

  brl(value: number): string {
    return formatBRL(value);
  }

  fileSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  when(value: unknown): string {
    const date = toDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  fileIcon(invoice: SellerInvoice): string {
    const type = invoice.file.contentType || '';
    if (type.includes('pdf')) return 'document-text-outline';
    if (type.includes('xml')) return 'code-slash-outline';
    return 'image-outline';
  }

  // ------------------------------------------------------------- nota fiscal

  onDrag(event: DragEvent, row: SellerMonthRow, over: boolean) {
    event.preventDefault();
    this.dragOver.set(over ? row.sellerId : null);
  }

  onDrop(event: DragEvent, row: SellerMonthRow) {
    event.preventDefault();
    this.dragOver.set(null);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.sendInvoice(row, file);
  }

  onFilePicked(event: Event, row: SellerMonthRow) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.sendInvoice(row, file);
  }

  private async sendInvoice(row: SellerMonthRow, file: File) {
    if (!ACCEPTED_EXT.test(file.name)) {
      await this.toast('Use PDF, XML ou foto (JPG, PNG) da nota.', 'danger');
      return;
    }
    if (file.size > INVOICE_MAX_BYTES) {
      await this.toast('Arquivo acima de 15 MB. Envie uma versão menor.', 'danger');
      return;
    }

    const previous = this.invoiceOf(row);
    const destination = row.email ? `no app e no e-mail ${row.email}` : 'no app (a loja não tem e-mail cadastrado)';
    const confirmed = await this.confirm(
      previous ? 'Trocar a nota fiscal?' : 'Enviar nota fiscal?',
      `${row.name} recebe a nota de ${this.periodName()} ${destination}.` +
        (previous ? ' O arquivo anterior será substituído.' : ''),
      previous ? 'Trocar e enviar' : 'Enviar nota',
    );
    if (!confirmed) return;

    this.busy.set(row.sellerId);
    try {
      await this.service.attachInvoice(row, this.period(), file, previous);
      await this.toast(`Nota de ${this.monthName()} enviada para ${row.name}.`, 'success');
    } catch (err) {
      console.error('[vendedores] anexar nota', err);
      await this.toast('Não deu para enviar a nota. Tente de novo.', 'danger');
    } finally {
      this.busy.set(null);
    }
  }

  async resend(row: SellerMonthRow) {
    const invoice = this.invoiceOf(row);
    if (!invoice) return;
    this.busy.set(row.sellerId);
    try {
      await this.service.resendEmail(invoice);
      await this.toast('Reenviando o e-mail…', 'success');
    } catch {
      await this.toast('Não deu para reenviar. Tente de novo.', 'danger');
    } finally {
      this.busy.set(null);
    }
  }

  async remove(row: SellerMonthRow) {
    const invoice = this.invoiceOf(row);
    if (!invoice) return;
    const confirmed = await this.confirm(
      'Remover a nota fiscal?',
      `A nota de ${this.periodName()} some do perfil de ${row.name}. O e-mail já enviado não é desfeito.`,
      'Remover',
      true,
    );
    if (!confirmed) return;
    this.busy.set(row.sellerId);
    try {
      await this.service.removeInvoice(invoice);
      await this.toast('Nota removida.', 'success');
    } catch {
      await this.toast('Não deu para remover. Tente de novo.', 'danger');
    } finally {
      this.busy.set(null);
    }
  }

  private async confirm(header: string, message: string, okText: string, destructive = false): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: okText, role: destructive ? 'destructive' : 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm' || role === 'destructive';
  }

  private async toast(message: string, color: 'success' | 'danger') {
    const toast = await this.toastCtrl.create({ message, color: color === 'success' ? 'dark' : 'danger', duration: 2800, position: 'bottom' });
    await toast.present();
  }
}
