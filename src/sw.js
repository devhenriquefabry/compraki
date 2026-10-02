/*
 * Service worker da Vineon — só notificações.
 * ----------------------------------------------------------------------------
 * Escrito à mão, sem build: é copiado como está para a raiz do site (asset em
 * angular.json) e registrado por `core/pwa.ts`. Precisa estar na raiz para
 * ter escopo `/`.
 *
 * NÃO tem handler de `fetch` de propósito: nada de cache de página. O
 * index.html sempre revalida no servidor (server.mjs) e os chunks têm hash —
 * um cache aqui só criaria o risco de prender o app numa versão velha.
 *
 * Mensagem de push (functions/src/notifications.ts):
 *   { id, title, body, url, image, tag, kind, badge }
 */

const ICON = '/assets/icon/pwa-192.png';
const BADGE = '/assets/icon/badge-96.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Vineon';
  const options = {
    body: data.body || '',
    icon: ICON,
    badge: BADGE,
    tag: data.tag || data.id || undefined,
    // Mesma tag (mesma conversa, mesmo pedido): avisa de novo, não fica mudo.
    renotify: !!(data.tag || data.id),
    timestamp: Date.now(),
    lang: 'pt-BR',
    data: { id: data.id || null, url: data.url || '/tabs/notifications' },
  };
  if (data.image) options.image = data.image;

  const jobs = [self.registration.showNotification(title, options)];

  // Número no ícone do app (iOS 16.4+ e Android instalados).
  if (typeof data.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    jobs.push(
      (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => undefined)
    );
  }

  // App aberto: avisa a tela para atualizar sem esperar o Firestore.
  jobs.push(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      list.forEach((client) => client.postMessage({ type: 'vn-push', id: data.id || null }));
    })
  );

  event.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = data.url || '/tabs/notifications';
  const target = new URL(path, self.location.origin);
  if (data.id) target.searchParams.set('aviso', data.id);

  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      // App já aberto: troca de tela pelo roteador (sem recarregar tudo).
      client.postMessage({ type: 'vn-open', id: data.id || null, url: path });
      return client.focus();
    }
    return self.clients.openWindow(target.pathname + target.search);
  })());
});

// O navegador trocou a inscrição (raro). A nova é gravada pelo app na próxima
// abertura (`syncPushSubscription`), que compara o endpoint com o salvo.
self.addEventListener('pushsubscriptionchange', (event) => {
  const options = event.oldSubscription && event.oldSubscription.options;
  if (!options) return;
  event.waitUntil(self.registration.pushManager.subscribe(options).catch(() => undefined));
});
