import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  addBusinessDays, deliveryWindow, formatBRL, formatDay, isPaid, paymentDueDate, toDate, trackingUrl,
} from '../../core/order-stage';
import { FISCAL_DOCUMENT_LABEL, FiscalDocument, Order } from '../../interfaces/order';

type StepState = 'done' | 'current' | 'upcoming' | 'alert';

interface TimelineStep {
  key: string;
  label: string;
  detail?: string;
  at: string | null;
  state: StepState;
}

interface FiscalLink {
  label: string;
  fileName: string;
  url: string;
  number?: string | null;
  at: string | null;
}

const PAYMENT_LABEL: Record<Order['paymentMethod'], string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão de crédito',
};

/**
 * Linha do tempo do pedido, do pagamento à entrega — com data e hora de cada
 * marco. Recebe o pedido já em tempo real (quem usa passa o documento do
 * `onSnapshot`), então muda sozinha quando o pagamento cai ou a loja posta.
 *
 * Usada em Minhas compras (comprador) e na aba Pedidos do admin.
 */
@Component({
  selector: 'app-order-timeline',
  standalone: true,
  templateUrl: './order-timeline.component.html',
  styleUrls: ['./order-timeline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderTimelineComponent {
  readonly order = input.required<Order>();

  readonly steps = computed(() => buildTimeline(this.order()));

  readonly fiscalDocuments = computed<FiscalLink[]>(() =>
    Object.values(this.order().fiscalDocuments || {})
      .filter((doc): doc is FiscalDocument => !!doc?.url)
      .map(doc => ({
        label: FISCAL_DOCUMENT_LABEL[doc.type] ?? 'Documento',
        fileName: doc.fileName,
        url: doc.url,
        number: doc.number,
        at: stamp(doc.uploadedAt),
      }))
  );

  readonly trackingCode = computed(() => this.order().shippingInfo?.trackingCode || null);

  trackingLink(code: string): string {
    return trackingUrl(code);
  }
}

/** "24 set, 14:05" — com o ano quando não é o corrente. */
function stamp(value: unknown): string | null {
  const date = toDate(value);
  if (!date) return null;
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${formatDay(date, true)}, ${time}`;
}

export function buildTimeline(order: Order): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const paid = isPaid(order) || order.status === 'REFUNDED' || !!order.paymentConfirmedAt;
  const cancelled = order.status === 'CANCELLED';
  const method = PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod;

  steps.push({
    key: 'placed',
    label: 'Pedido realizado',
    detail: `${formatBRL(order.total)} via ${method}`,
    at: stamp(order.createdAt),
    state: 'done',
  });

  // ------------------------------------------------------------- pagamento
  if (paid) {
    steps.push({ key: 'paid', label: 'Pagamento aprovado', at: stamp(order.paymentConfirmedAt), state: 'done' });
  } else if (cancelled) {
    steps.push({
      key: 'cancelled',
      label: 'Pedido cancelado',
      detail: 'O pagamento não foi concluído.',
      at: stamp(order.updatedAt),
      state: 'alert',
    });
    return steps;
  } else if (order.paymentAlert) {
    steps.push({
      key: 'paid',
      label: 'Pagamento em conferência',
      detail: 'O valor pago não bateu com o total do pedido. A equipe Vineon está verificando.',
      at: stamp(order.paymentAlert.detectedAt),
      state: 'alert',
    });
  } else {
    const due = paymentDueDate(order);
    steps.push({
      key: 'paid',
      label: 'Aguardando pagamento',
      detail: order.paymentMethod === 'CREDIT_CARD'
        ? 'A operadora do cartão está analisando.'
        : due ? `Pague até ${formatDay(due)}. A confirmação é automática.` : undefined,
      at: null,
      state: 'current',
    });
  }

  // ---------------------------------------------------- nota / declaração
  for (const doc of Object.values(order.fiscalDocuments || {})) {
    if (!doc?.url) continue;
    steps.push({
      key: `fiscal-${doc.uploadedBy}`,
      label: doc.type === 'NFE' ? 'Nota fiscal emitida' : 'Declaração de conteúdo anexada',
      detail: doc.number ? `Nº ${doc.number}` : undefined,
      at: stamp(doc.uploadedAt),
      state: 'done',
    });
  }

  // ---------------------------------------------------------------- envio
  const delivered = order.status === 'DELIVERED' || order.shipmentStatus === 'DELIVERED';
  const shipped = delivered || order.shipmentStatus === 'SHIPPED' || order.shipmentStatus === 'PROBLEM' || !!order.shippedAt;
  const inRefund = !!order.refundInfo?.status || order.status === 'REFUNDED';

  if (shipped) {
    const code = order.shippingInfo?.trackingCode;
    const service = order.shippingInfo?.serviceName;
    steps.push({
      key: 'shipped',
      label: 'Enviado',
      detail: [service, code ? `rastreio ${code}` : null].filter(Boolean).join(' · ') || undefined,
      at: stamp(order.shippedAt),
      state: 'done',
    });
  } else if (paid && !inRefund) {
    const base = toDate(order.paymentConfirmedAt) ?? toDate(order.createdAt);
    const shipBy = base ? addBusinessDays(base, 2) : null;
    steps.push({
      key: 'shipped',
      label: 'Preparando envio',
      detail: shipBy ? `A loja separa, embala e posta até ${formatDay(shipBy)}.` : 'A loja está separando e embalando.',
      at: null,
      state: 'current',
    });
  } else if (!inRefund) {
    steps.push({ key: 'shipped', label: 'Envio', at: null, state: 'upcoming' });
  }

  if (order.shipmentStatus === 'PROBLEM') {
    steps.push({
      key: 'problem',
      label: 'Problema na entrega',
      detail: 'A loja sinalizou um problema. O contato é pelo chat.',
      at: stamp(order.shipmentProblemAt),
      state: 'alert',
    });
  }

  // -------------------------------------------------------------- entrega
  if (delivered) {
    const confirmed = !!order.deliveryConfirmedAt;
    steps.push({
      key: 'delivered',
      label: 'Entregue',
      detail: confirmed ? 'Recebimento confirmado pelo comprador.' : 'Marcado como entregue pela loja.',
      at: stamp(order.deliveryConfirmedAt ?? order.deliveredAt),
      state: 'done',
    });
  } else if (!inRefund) {
    const window = deliveryWindow(order);
    steps.push({
      key: 'delivered',
      label: 'Entrega',
      detail: window ? `Previsão: ${formatDay(window.from)} a ${formatDay(window.to)}` : undefined,
      at: null,
      state: shipped && order.shipmentStatus !== 'PROBLEM' ? 'current' : 'upcoming',
    });
  }

  // ------------------------------------------------------------ devolução
  const refund = order.refundInfo;
  if (refund?.status) {
    steps.push({
      key: 'refund-requested',
      label: 'Devolução solicitada',
      detail: refund.reason ? `“${refund.reason}”` : undefined,
      at: stamp(refund.requestedAt),
      state: 'done',
    });
    if (refund.status === 'REQUESTED') {
      steps.push({ key: 'refund-review', label: 'Em análise pela equipe Vineon', at: null, state: 'current' });
    } else if (refund.status === 'REJECTED') {
      steps.push({ key: 'refund-review', label: 'Devolução recusada', detail: refund.adminNotes, at: stamp(refund.processedAt), state: 'alert' });
    } else {
      steps.push({ key: 'refund-review', label: 'Devolução aprovada', detail: refund.adminNotes, at: stamp(refund.processedAt), state: 'done' });
      steps.push({
        key: 'refund-done',
        label: 'Estorno concluído',
        at: null,
        state: refund.status === 'COMPLETED' || order.status === 'REFUNDED' ? 'done' : 'current',
      });
    }
  } else if (order.status === 'REFUNDED') {
    steps.push({ key: 'refund-done', label: 'Valor estornado', at: stamp(order.updatedAt), state: 'done' });
  }

  return steps;
}
