export interface WhatsappInstanceView {
  name: string;
  status: string;
  raw: unknown;
}

export interface WhatsappChatRow {
  remoteJid: string;
  title: string;
  preview: string;
  initial: string;
  avatarUrl?: string;
}

export interface WhatsappMessageRow {
  id: string;
  fromMe: boolean;
  text: string;
  timeLabel: string;
  sortKey: number;
  mediaType?: 'image' | 'video' | 'audio' | 'sticker';
  mediaUrl?: string;
  mediaMimeType?: string;
  caption?: string;
  rawMessage?: unknown;
}

export interface WhatsappMessagePageMeta {
  currentPage: number;
  totalPages: number;
}

export type WhatsappNormalizedStatus = 'connected' | 'connecting' | 'disconnected' | 'unknown';

export function getNormalizedStatus(status: string): WhatsappNormalizedStatus {
  const value = (status || '').toLowerCase().trim();

  if (['open', 'opened', 'connected', 'connectado', 'conectado', 'online'].includes(value)) {
    return 'connected';
  }
  if (['connecting', 'pairing', 'qrcode', 'qr', 'loading', 'starting'].includes(value)) {
    return 'connecting';
  }
  if (['close', 'closed', 'disconnected', 'disconnect', 'desconectado', 'offline'].includes(value)) {
    return 'disconnected';
  }
  return 'unknown';
}

export function isInstanceConnected(status: string): boolean {
  return getNormalizedStatus(status) === 'connected';
}

export function getInstanceStatusLabel(status: string): string {
  const normalized = getNormalizedStatus(status);
  if (normalized === 'connected') return 'Conectado';
  if (normalized === 'connecting') return 'Conectando';
  if (normalized === 'disconnected') return 'Desconectado';
  return 'Status indefinido';
}

export function getInstanceStatusIcon(status: string): string {
  const normalized = getNormalizedStatus(status);
  if (normalized === 'connected') return 'checkmark-circle-outline';
  if (normalized === 'connecting') return 'sync-outline';
  if (normalized === 'disconnected') return 'close-circle-outline';
  return 'help-circle-outline';
}

export function getInstanceStatusClass(status: string): string {
  return `status-${getNormalizedStatus(status)}`;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro inesperado ao gerenciar WhatsApp.';
}
