import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertController, IonicModule, LoadingController, NavController, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, arrowBack, barcodeOutline, callOutline, chatbubblesOutline, checkmarkCircle,
  copyOutline, cubeOutline, documentAttachOutline, documentTextOutline, locationOutline, mailOutline, mapOutline,
  printOutline, shieldHalfOutline, timeOutline,
} from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';

import { waitForAuthUser } from 'src/app/core/auth-state';
import {
  REFUND_LABEL, SALE_STAGE_LABEL, SALE_TRACK_STEPS, formatDay, isPaid, listUnitPrice,
  orderStage, paidUnitPrice, productIdOf, sellerAmount, sellerItems, shipByDate, toDate, trackIndex, trackingUrl,
} from 'src/app/core/order-stage';
import { FISCAL_DOCUMENT_LABEL, FiscalDocumentType, Order } from 'src/app/interfaces/order';
import { FirebaseChatService } from 'src/app/services/firebase-chat.service';
import { MelhorEnvioService } from 'src/app/services/melhor-envio.service';
import { SalesService } from 'src/app/services/sales.service';

const PAYMENT_LABEL: Record<Order['paymentMethod'], string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão de crédito',
};

@Component({
  selector: 'app-sale-details',
  templateUrl: './sale-details.page.html',
  styleUrls: ['./sale-details.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule],
})
export class SaleDetailsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly salesService = inject(SalesService);
  private readonly melhorEnvioService = inject(MelhorEnvioService);
  private readonly chatService = inject(FirebaseChatService);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly alertCtrl = inject(AlertController);

  readonly trackSteps = SALE_TRACK_STEPS;
  readonly paymentLabel = PAYMENT_LABEL;

  readonly isLoading = signal(true);
  readonly sale = signal<Order | null>(null);
  readonly sellerId = signal<string | null>(null);
  readonly busy = signal(false);

  // Nota fiscal / declaração de conteúdo desta loja
  readonly fiscalLabel = FISCAL_DOCUMENT_LABEL;
  readonly fiscalType = signal<FiscalDocumentType>('NFE');
  fiscalNumber = '';
  readonly uploadingFiscal = signal(false);

  readonly view = computed(() => {
    const order = this.sale();
    const seller = this.sellerId();
    if (!order || !seller) return null;

    const stage = orderStage(order);
    const mine = sellerItems(order, seller);
    const onlySeller = (order.sellerIds || []).length <= 1;
    const amount = sellerAmount(order, seller);
    const shipping = onlySeller ? order.shippingInfo?.price ?? 0 : 0;
    const shipBy = stage === 'preparing' ? shipByDate(order) : null;
    const release = toDate(order.escrowInfo?.releasedAt) ?? toDate(order.escrowInfo?.releaseDate);
    const a = order.addressData;
    const refundStatus = order.refundInfo?.status;

    return {
      order,
      stage,
      id: order.id || '',
      shortId: (order.id || '').substring(0, 8).toUpperCase(),
      statusLabel: stage === 'refund' && refundStatus ? REFUND_LABEL[refundStatus] : SALE_STAGE_LABEL[stage],
      track: trackIndex(stage),
      paid: isPaid(order),
      items: mine.map((item, i) => ({
        key: `${productIdOf(item) ?? i}:${item.skuId ?? ''}:${i}`,
        productId: productIdOf(item),
        name: item.productData?.name || 'Produto',
        photo: item.productData?.photoURL?.[0] || 'assets/imagens/placeholder.png',
        variant: item.variantLabel || null,
        quantity: item.quantity || 1,
        price: paidUnitPrice(item),
        listPrice: listUnitPrice(item),
      })),
      amount,
      shipping,
      onlySeller,
      shipBy: shipBy ? { label: formatDay(shipBy), late: endOfDay(shipBy) < Date.now() } : null,
      placedAt: formatDay(toDate(order.createdAt), true),
      paidAt: formatDay(toDate(order.paymentConfirmedAt)),
      release: release ? formatDay(release, true) : null,
      released: order.escrowInfo?.status === 'RELEASED',
      trackingCode: order.shippingInfo?.trackingCode || null,
      fiscal: order.fiscalDocuments?.[seller] ?? null,
      fiscalAt: formatDay(toDate(order.fiscalDocuments?.[seller]?.uploadedAt), true),
      addressLines: a
        ? [
            `${a.street}, ${a.number}${a.complement ? ' – ' + a.complement : ''}`,
            [a.neighborhood, `${a.city}/${a.state}`].filter(Boolean).join(' · '),
            `CEP ${a.postalCode}`,
          ]
        : [],
      mapsUrl: a
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.street}, ${a.number}, ${a.city} - ${a.state}, ${a.postalCode}`)}`
        : null,
    };
  });

  private stop?: () => void;

  constructor() {
    addIcons({
      alertCircleOutline, arrowBack, barcodeOutline, callOutline, chatbubblesOutline, checkmarkCircle,
      copyOutline, cubeOutline, documentAttachOutline, documentTextOutline, locationOutline, mailOutline, mapOutline,
      printOutline, shieldHalfOutline, timeOutline,
    });
    inject(DestroyRef).onDestroy(() => this.stop?.());
    void this.load();
  }

  private async load() {
    const id = this.route.snapshot.paramMap.get('id');
    const user = await waitForAuthUser();
    if (!id || !user) {
      this.isLoading.set(false);
      return;
    }
    this.sellerId.set(user.uid);
    const sub = this.salesService.watchSale(id).subscribe({
      next: order => {
        this.sale.set(order);
        this.isLoading.set(false);
      },
      error: err => {
        console.error('Falha ao carregar venda', err);
        this.isLoading.set(false);
      },
    });
    this.stop = () => sub.unsubscribe();
  }

  goBack() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/my-sales');
  }

  openProduct(productId: string | null) {
    if (productId) this.router.navigate(['/product-admin', productId]);
  }

  // ------------------------------------------------------------ entrega

  async markShipped() {
    const v = this.view();
    if (!v) return;
    const code = await this.askTrackingCode('Marcar como enviada', 'Marcar como enviada', v.trackingCode);
    if (code === null) return;
    await this.run(() => this.salesService.markShipped(v.id, code), 'Venda marcada como enviada. O comprador já vê "A caminho".');
  }

  async editTracking() {
    const v = this.view();
    if (!v) return;
    const code = await this.askTrackingCode('Código de rastreio', 'Salvar', v.trackingCode);
    if (!code) return;
    await this.run(() => this.salesService.setTrackingCode(v.id, code), 'Código de rastreio salvo.');
  }

  async markDelivered() {
    const v = this.view();
    if (!v) return;
    const alert = await this.alertCtrl.create({
      header: 'Marcar como entregue?',
      message: 'Use quando o rastreio já mostra a entrega. O comprador também pode confirmar pelo app.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Marcar como entregue', role: 'confirm' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'confirm') return;
    await this.run(() => this.salesService.updateShipmentStatus(v.id, 'DELIVERED'), 'Venda marcada como entregue.');
  }

  async reportProblem() {
    const v = this.view();
    if (!v) return;
    const alert = await this.alertCtrl.create({
      header: 'Problema na entrega?',
      message: 'O comprador verá um aviso para falar com você pelo chat. Você pode voltar a marcar como enviada quando resolver.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Sinalizar problema', role: 'confirm' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'confirm') return;
    await this.run(() => this.salesService.updateShipmentStatus(v.id, 'PROBLEM'), 'Problema sinalizado ao comprador.');
  }

  track() {
    const code = this.view()?.trackingCode;
    if (code) window.open(trackingUrl(code), '_blank', 'noopener');
  }

  /** Compra e gera a etiqueta no Melhor Envio (mesmo fluxo de antes, só reorganizado). */
  async generateShippingLabel() {
    const order = this.sale();
    if (!order?.id) return;

    const loading = await this.loadingCtrl.create({ message: 'Gerando etiqueta no Melhor Envio...' });
    await loading.present();
    try {
      const config = await firstValueFrom(this.melhorEnvioService.getConfig());
      if (!config) throw new Error('Melhor Envio não configurado.');

      const cartRes = await firstValueFrom(this.melhorEnvioService.addToCart(config, order));
      const shipmentId = cartRes.id;
      await firstValueFrom(this.melhorEnvioService.checkout(config, [shipmentId]));
      await firstValueFrom(this.melhorEnvioService.generateLabel(config, [shipmentId]));
      await this.salesService.updateSaleData(order.id, { 'shippingInfo.shipmentId': shipmentId });

      this.toast('Etiqueta gerada. Imprima e cole na embalagem.', 'success');
    } catch (err: any) {
      console.error('Erro Melhor Envio:', err);
      this.toast('Não foi possível gerar a etiqueta: ' + (err?.error?.message || err?.message || 'erro desconhecido'), 'danger');
    } finally {
      loading.dismiss();
    }
  }

  async printLabel() {
    const shipmentId = this.sale()?.shippingInfo?.shipmentId;
    if (!shipmentId) return;

    const tab = window.open('', '_blank');
    try {
      const config = await firstValueFrom(this.melhorEnvioService.getConfig());
      if (!config) throw new Error('Melhor Envio não configurado.');
      const res = await firstValueFrom(this.melhorEnvioService.getLabelUrl(config, [shipmentId]));
      if (!res?.url) throw new Error('sem url');
      if (tab) tab.location.href = res.url;
      else window.location.href = res.url;
    } catch (err) {
      console.error(err);
      tab?.close();
      this.toast('Não foi possível abrir a etiqueta.', 'danger');
    }
  }

  // ------------------------------------------ nota fiscal / declaração

  /** PDF ou foto, até 10 MB (mesmo teto do storage.rules). */
  async onFiscalFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const v = this.view();
    if (!file || !v) return;

    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(file.type)) {
      this.toast('Envie um PDF ou uma foto (JPG, PNG).', 'warning');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.toast('Arquivo muito grande. O limite é 10 MB.', 'warning');
      return;
    }

    this.uploadingFiscal.set(true);
    try {
      await this.salesService.attachFiscalDocument(v.id, file, { type: this.fiscalType(), number: this.fiscalNumber }, v.fiscal);
      this.fiscalNumber = '';
      this.toast(`${FISCAL_DOCUMENT_LABEL[this.fiscalType()]} anexada. O comprador já pode ver.`, 'success');
    } catch (err) {
      console.error('Falha ao anexar documento', err);
      this.toast('Não foi possível enviar o arquivo. Tente de novo.', 'danger');
    } finally {
      this.uploadingFiscal.set(false);
    }
  }

  async removeFiscal() {
    const v = this.view();
    if (!v?.fiscal) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover documento?',
      message: 'O comprador deixa de ver o arquivo no pedido.',
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Remover', role: 'confirm' }],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'confirm') return;
    const doc = v.fiscal;
    await this.run(() => this.salesService.removeFiscalDocument(v.id, doc), 'Documento removido.');
  }

  // ----------------------------------------------------------- comprador

  async talkToBuyer() {
    const order = this.sale();
    if (!order) return;
    const item = order.items?.[0];
    try {
      const chatId = await this.chatService.startChat(
        { uid: order.userId, name: order.customerData?.name || 'Comprador' },
        item?.productData?.id ? { id: item.productData.id, name: item.productData.name, photo: item.productData.photoURL?.[0] } : undefined
      );
      this.router.navigate(['/chat-details', chatId]);
    } catch (err: any) {
      console.error('Falha ao abrir conversa', err);
      this.toast(err?.message || 'Não foi possível abrir a conversa.', 'danger');
    }
  }

  async copy(text: string | null | undefined, what: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.toast(`${what} copiado.`, 'dark');
    } catch {
      this.toast(`Não foi possível copiar.`, 'warning');
    }
  }

  // --------------------------------------------------------------- apoio

  private async askTrackingCode(header: string, confirm: string, current: string | null): Promise<string | null> {
    const alert = await this.alertCtrl.create({
      header,
      message: 'O comprador acompanha a entrega por esse código. Se ainda não tiver, deixe em branco e adicione depois.',
      inputs: [{ name: 'code', type: 'text', placeholder: 'Ex.: AN123456789BR', value: current ?? '' }],
      buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: confirm, role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    return role === 'confirm' ? String(data?.values?.code ?? '') : null;
  }

  private async run(action: () => Promise<void>, success: string) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await action();
      this.toast(success, 'success');
    } catch (err) {
      console.error(err);
      this.toast('Não foi possível salvar. Tente de novo.', 'danger');
    } finally {
      this.busy.set(false);
    }
  }

  private async toast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 3000, color, position: 'bottom' });
    await t.present();
  }
}

function endOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

