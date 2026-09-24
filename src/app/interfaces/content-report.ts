/**
 * Denúncia de anúncio ou de vendedor feita por quem usa o app.
 *
 * Coleção `contentReports`, separada de `reports` (denúncias de conversa, que
 * a aba Conversas do admin lista inteira). Id do documento =
 * `{targetType}_{targetId}_{reporterId}`: uma denúncia por pessoa por alvo,
 * e as regras do Firestore conferem esse formato.
 */

export type ReportTargetType = 'product' | 'seller';

export type ReportStatus = 'open' | 'resolved';

export type ReportResolution = 'dismissed' | 'product_removed' | 'account_suspended';

export type ReportReason =
  | 'prohibited'
  | 'fraud'
  | 'counterfeit'
  | 'misleading'
  | 'offensive'
  | 'no_delivery'
  | 'abusive'
  | 'fake_profile'
  | 'other';

export interface ContentReport {
  id?: string;
  targetType: ReportTargetType;
  /** Id do produto ou uid do vendedor denunciado. */
  targetId: string;
  /** Dono do anúncio (para produto) ou o próprio vendedor. */
  sellerId: string;
  /** Foto do nome e da capa no momento da denúncia, para o painel não depender do anúncio existir. */
  targetName: string;
  targetPhoto?: string | null;
  reason: ReportReason;
  details: string;
  reporterId: string;
  reporterName: string;
  status: ReportStatus;
  createdAt: any;

  resolution?: ReportResolution;
  resolutionNote?: string;
  resolvedAt?: any;
  resolvedBy?: string;
}

export const REPORT_REASONS: Record<ReportTargetType, { id: ReportReason; label: string; hint: string }[]> = {
  product: [
    { id: 'prohibited', label: 'Produto proibido ou ilegal', hint: 'Armas, drogas, medicamentos controlados, animais silvestres...' },
    { id: 'counterfeit', label: 'Falsificado ou pirata', hint: 'Réplica vendida como original' },
    { id: 'fraud', label: 'Golpe ou fraude', hint: 'Preço irreal, pede pagamento por fora do Vineon' },
    { id: 'misleading', label: 'Anúncio enganoso', hint: 'Fotos ou descrição não batem com o produto' },
    { id: 'offensive', label: 'Conteúdo ofensivo', hint: 'Imagens ou textos impróprios' },
    { id: 'other', label: 'Outro motivo', hint: '' },
  ],
  seller: [
    { id: 'fraud', label: 'Golpe ou fraude', hint: 'Pediu pagamento por fora, sumiu com o dinheiro' },
    { id: 'no_delivery', label: 'Não entregou o produto', hint: '' },
    { id: 'abusive', label: 'Comportamento abusivo', hint: 'Ameaças, assédio, ofensas no chat' },
    { id: 'fake_profile', label: 'Perfil falso', hint: 'Se passa por outra pessoa ou empresa' },
    { id: 'prohibited', label: 'Vende produtos proibidos', hint: '' },
    { id: 'other', label: 'Outro motivo', hint: '' },
  ],
};

export function reportReasonLabel(reason: ReportReason): string {
  for (const list of Object.values(REPORT_REASONS)) {
    const found = list.find(r => r.id === reason);
    if (found) return found.label;
  }
  return 'Outro motivo';
}

export const REPORT_RESOLUTION_LABEL: Record<ReportResolution, string> = {
  dismissed: 'Descartada',
  product_removed: 'Anúncio tirado do ar',
  account_suspended: 'Conta suspensa',
};
