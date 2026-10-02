# Notificações (tela de avisos + push no app instalado)

Desde 2026-10-02. Os avisos aparecem na tela **Notificações** (`/tabs/notifications`)
para todo mundo logado; o **push** no celular só existe no site **instalado** (PWA):

| Onde a pessoa está          | Lista de avisos | Push no celular |
| --------------------------- | --------------- | --------------- |
| iPhone, "Adicionar à Tela de Início" (iOS 16.4+) | sim | sim |
| Android, "Instalar app"     | sim             | sim             |
| Celular no navegador        | sim             | não — a tela ensina a instalar |
| Computador                  | sim             | não (cartão de push nem aparece) |
| APK nativo (Capacitor)      | sim             | não (Web Push não roda no WebView) |

## Peças

- `src/manifest.webmanifest` + ícones `assets/icon/pwa-*.png`: o que faz o iPhone abrir
  como app e liberar push, e o Android oferecer "Instalar".
- `src/sw.js`: service worker escrito à mão, só `push` e `notificationclick`. **Sem
  handler de `fetch`** de propósito (nada de cache de página). O `server.mjs` serve
  `sw.js` e o manifest com `no-cache`.
- `core/pwa.ts` (bundle inicial): detecta app instalado, registra o SW, guarda o
  convite de instalação do Android, tira a inscrição do aparelho no logout.
- `core/push.ts` (lazy): permissão, `pushManager.subscribe`, grava a inscrição.
- `services/notification-center.service.ts`: contador de não lidos (menu, sino do site,
  ícone do app), convite de ativação (uma vez; "Agora não" adia 7 dias) e o toque na
  notificação → tela certa (`?aviso=<id>` ou mensagem `vn-open` do SW).
- `functions/src/notifications.ts`: `notifyUser()` grava o aviso e manda o push
  (biblioteca `web-push`, padrão VAPID — sem Firebase Cloud Messaging).

## Dados

- `users/{uid}/notifications/{id}` — `kind`, `icon`, `title`, `body`, `link`, `image`,
  `read`, `createdAt`, `expireAt`. Só as functions criam; o dono marca lido e apaga.
  ID determinístico por evento (não duplica em retentativa). Conversa tem UM aviso
  (`chat-<id>`), sempre com a última mensagem.
- **TTL** em `notifications.expireAt` (+90 dias), ligado no projeto em 2026-10-02.
- `users/{uid}/pushSubscriptions/{sha256 do endpoint}` — uma por aparelho. Endpoint
  que o serviço de push dá como morto (404/410) é apagado pela function.
- `users/{uid}.notificationPrefs` — `{orders, sales, messages, reviews}`. Desligado =
  sem push daquela categoria; o aviso continua na lista.

## Quando avisa

`onOrderWrittenNotify` (só mudança de etapa de pedido que já existia — mesma regra de
`orderStage()` em `core/order-stage.ts`, duplicada na function):
pagamento aprovado (comprador) + venda nova (cada loja), a caminho, entregue, cancelado,
devolução pedida (loja) e aprovada/recusada/estornada (comprador).
`onChatMessageNotify`: mensagem nova. `onProductReviewNotify`: avaliação nova (loja).
`sendTestNotification`: botão "Testar" da tela (só para a própria conta, 1 a cada 20 s).

## Chaves VAPID

Par gerado com `web-push`. Pública em `src/environments/*.ts` (`vapidPublicKey`) e em
`functions/.env` (`VAPID_PUBLIC_KEY`); privada só em `functions/.env`
(`VAPID_PRIVATE_KEY`, fora do git). **Trocar o par invalida a inscrição de todos os
celulares** (o app refaz sozinho na próxima abertura).

## Testar

No emulador ([testes-com-emulador.md](testes-com-emulador.md)) as functions de aviso
rodam de verdade: mude a etapa de um pedido do seed pela UI do emulador e o aviso
aparece em `?testUser=comprador`. O push sai pela rede real (o `.env` tem as chaves).
Para simular "app instalado" no navegador, sobrescreva `matchMedia('(display-mode:
standalone)')` antes de carregar a página.

## Publicar

Functions novas só pelo nome (o `.env` de pagamentos pode estar em sandbox):
`firebase deploy --only functions:onOrderWrittenNotify,functions:onChatMessageNotify,functions:onProductReviewNotify,functions:sendTestNotification`.
Não rodar junto com rollout do App Hosting (disputam cota do Cloud Run).
