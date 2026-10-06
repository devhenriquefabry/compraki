import type { SupportPriority, SupportStatus } from '../interfaces/support';

/**
 * Regras e textos do atendimento. Os limites espelham `functions/src/support.ts`
 * (LIMITS): mudou aqui, mude lá.
 *
 * O que a pessoa lê sobre prazo e horário mora só aqui — é uma promessa da
 * Vineon (a lei, Decreto 7.962/2013 art. 4º, dá no máximo 5 dias), então quem
 * decide o texto são o Henrique e o Josué.
 */
export const SUPPORT = {
  /** Promessa mostrada ao cliente. A meta interna é mais curta (1 dia útil). */
  promise: 'até 2 dias úteis',
  hours: 'segunda a sexta, das 9h às 18h',

  subjectMin: 3,
  subjectMax: 120,
  messageMin: 20,
  messageMax: 2000,
  replyMax: 2000,
  noteMax: 2000,

  maxAttachments: 3,
  maxFileBytes: 5 * 1024 * 1024,
  fileTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as readonly string[],
  /** Para o `accept` do input de arquivo. */
  fileAccept: 'image/jpeg,image/png,image/webp,application/pdf',

  maxOpen: 5,
  /** Dias para a pessoa reabrir um atendimento resolvido. */
  reopenDays: 7,
} as const;

/** Como a pessoa vê cada status. */
export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  waiting_staff: 'Em análise',
  waiting_customer: 'Aguardando sua resposta',
  resolved: 'Resolvido',
  closed: 'Encerrado',
};

/** Como a equipe vê cada status. */
export const SUPPORT_STAFF_STATUS_LABEL: Record<SupportStatus, string> = {
  waiting_staff: 'Aguardando a Vineon',
  waiting_customer: 'Aguardando o cliente',
  resolved: 'Resolvido',
  closed: 'Encerrado',
};

export const SUPPORT_PRIORITY_LABEL: Record<SupportPriority, string> = {
  normal: 'Normal',
  high: 'Prioridade alta',
};

export function isOpenStatus(status: SupportStatus): boolean {
  return status === 'waiting_staff' || status === 'waiting_customer';
}

/** "VN-2026-000123" → "000123" (o que cabe num cartão estreito). */
export function protocolTail(protocol: string): string {
  return protocol.split('-').pop() ?? protocol;
}

/** "agora", "há 5 min", "há 3 h", "ontem" ou "24 set". */
export function relativeTime(date: Date | null, now = new Date()): string {
  if (!date) return '';
  const diff = now.getTime() - date.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${date.getDate()} ${months[date.getMonth()]}${date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : ''}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
