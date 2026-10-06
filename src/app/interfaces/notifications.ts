import { VnIconName } from '../core/vn-icons';

/**
 * Aviso da tela Notificações: `users/{uid}/notifications/{id}`.
 * Escrito só pela Cloud Function (functions/src/notifications.ts).
 */
export type NotificationKind = 'order' | 'sale' | 'message' | 'review' | 'system' | 'support';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  icon: VnIconName;
  title: string;
  body: string;
  /** Rota interna do app. */
  link: string;
  image: string | null;
  read: boolean;
  createdAt: Date | null;
}

/** Categorias que a pessoa pode silenciar no push (`users/{uid}.notificationPrefs`). */
export interface NotificationPrefs {
  orders: boolean;
  sales: boolean;
  messages: boolean;
  reviews: boolean;
}
