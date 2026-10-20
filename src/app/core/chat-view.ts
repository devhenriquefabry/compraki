import { ChatParticipant, ChatRoom } from '../interfaces/chat';
import { PublicSellerProfile } from '../interfaces/seller';

/**
 * Leitura de uma conversa do ponto de vista de quem está logado: quem é o
 * outro lado, se ele é a loja, quantas faltam ler e como mostrar datas.
 * Compartilhado pela lista de Mensagens e pela caixa de conversa.
 */

/**
 * Quem vende na conversa. As novas gravam `sellerId`; nas antigas, quem abriu
 * a conversa (comprador) vem primeiro em `participantIds` e a loja em seguida.
 */
export function chatSellerId(chat: ChatRoom | undefined): string | undefined {
  if (!chat) return undefined;
  return chat.sellerId ?? chat.participantIds?.[1];
}

export function otherParticipantOf(chat: ChatRoom | undefined, me: string | undefined): ChatParticipant | undefined {
  if (!chat?.participants?.length) return undefined;
  return chat.participants.find(p => p.uid !== me) ?? chat.participants[0];
}

export function unreadOf(chat: ChatRoom | undefined, me: string | undefined): number {
  if (!chat || !me) return 0;
  return Math.max(0, Number(chat.unread?.[me] || 0));
}

/** Conversa aberta e largada sem mensagem só aparece para quem a abriu. */
export function isVisibleTo(chat: ChatRoom, me: string | undefined): boolean {
  return !!chat.lastSenderId || !chat.createdBy || chat.createdBy === me;
}

/**
 * Nome e foto do outro lado. O perfil público (`sellers/{uid}`) é a fonte
 * viva; o que ficou gravado na conversa é só o plano B — as antigas guardavam
 * "Você" como nome de quem abriu.
 */
export function displayOf(chat: ChatRoom, other: ChatParticipant | undefined, profile?: PublicSellerProfile | null) {
  const isStore = !!other && other.uid === chatSellerId(chat);
  const stored = other?.name && other.name !== 'Você' ? other.name : '';
  const name = (isStore ? profile?.shopName : null) || profile?.displayName || stored || (isStore ? 'Loja Vineon' : 'Cliente Vineon');
  return { name, photo: profile?.photoURL || other?.photoUrl || '', isStore };
}

export function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'V';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function toMillis(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  return null;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 86_400_000;

/** Hora na lista: hoje mostra a hora; ontem; dia da semana; data. */
export function listTime(ts: any, now = Date.now()): string {
  const ms = toMillis(ts);
  if (ms == null) return '';
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  const d = new Date(ms);
  if (days <= 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Ontem';
  if (days < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Separador de dia dentro da conversa. */
export function dayLabel(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  const d = new Date(ms);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days < 7) {
    const w = d.toLocaleDateString('pt-BR', { weekday: 'long' });
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function clockTime(ms: number | null): string {
  if (ms == null) return '';
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
