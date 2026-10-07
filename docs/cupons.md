# Cupons de desconto

Publicado em 2026-10-07. Código em `functions/src/coupons.ts` (servidor) e
`src/app/core/coupons.ts` (textos e limites no app).

## O que existe

| Quem cria | Onde | Tipos | Vale em | Quem paga |
| --- | --- | --- | --- | --- |
| Vineon (admin) | /admin/coupons | % · R$ fixo · frete grátis (com teto) | carrinho todo / frete | Vineon |
| Loja | Minha conta > Cupons da loja (`/my-coupons`) | % · R$ fixo | produtos da loja (todos ou até 50 escolhidos) | a loja (sai da venda) |

Regras por cupom: código (4–15 letras/números, único no app inteiro — é o id do
documento), compra mínima, desconto máximo (%), início e fim (loja é obrigada a
ter fim; máx. 1 ano), quantidade total, usos por pessoa (1–10), só 1ª compra
(Vineon), público (aparece no app) ou privado (só com o código). **Um cupom por
pedido.** Cupom nunca deixa o pedido abaixo de R$ 5,00 (mínimo do Cora/Asaas).
Loja não usa o próprio cupom. Loja tem até 20 cupons ativos.

Onde o comprador vê: selo "Cupom da loja" na ficha do produto
(`components/store-coupons`), tela **Cupons** (`/coupons`, aberta a visitante),
e no checkout (etapas Entrega e Revisão) com campo de código + lista dos que
servem para o carrinho. Regras sempre por extenso (`couponConditions`).

## Como o uso é garantido (não confiar no navegador)

1. `couponQuote` `preview` — calcula com o preço ATUAL de `products/` (variação:
   `skus[id].price`), nunca com o que o app manda.
2. `couponQuote` `reserve` — no "Finalizar compra", ANTES da cobrança: transação
   que confere limite total e por pessoa e grava `couponRedemptions/{id}`
   (`reserved`, 30 min). Reservar de novo troca a reserva anterior da pessoa.
   Reservas vencidas de outros são encerradas na próxima reserva do mesmo cupom
   (não há rotina agendada).
3. O pedido nasce com `coupon` = cópia da reserva. **A regra do Firestore confere
   campo a campo** (`couponMatchesReservation`): dono, status `reserved`, prazo,
   código, tipo e cada valor de desconto.
4. `onOrderWrittenCoupon` marca a reserva `used` e grava `couponCheck: ok`. Reserva
   usada por dois pedidos: o segundo fica `couponCheck: invalid`, e
   `asaasWebhook`/`applyCoraInvoiceToOrder` **não aprovam o pagamento**
   (`paymentAlert.reason = COUPON_INVALID`).
5. Pedido `CANCELLED` devolve o uso (reserva `cancelled`, contadores voltam).
   Reembolso não devolve.

Falhou a cobrança depois da reserva → o app chama `release`.
Código errado 15× em 10 min → 429 (`couponAttempts/{uid}`, TTL em `expireAt`).

Contadores no cupom (só servidor): `redeemedCount` (reservas abertas + usos — é
o que o limite conta), `ordersCount`, `discountTotal`.

## Dinheiro e relatórios

- `order.total` já vem com o desconto; a cobrança é desse valor.
- `sellerAmount()` (`core/order-stage.ts`) desconta só cupom **da própria loja**
  (`sellerCouponDiscount`). Mesma regra em `seller-invoices.service.ts` (taxa
  Vineon sobre o valor com desconto), no aviso "Nova venda" e no resumo do
  atendimento (`sellerCouponOf` em `functions/src/notifications.ts`).
- Cupom Vineon não muda o que a loja recebe; o custo aparece na aba Cupons
  ("Desconto pago pela Vineon").

## Moderação

Admin pausa/encerra qualquer cupom; cupom de loja pausado pela Vineon fica com
`pausedByAdmin` e a loja não reativa. Admin não edita regra de cupom de loja.
Apagar só cupom nunca usado; usado se encerra (fica no histórico).

## Coleções e regras

- `coupons/{CODIGO}` — leitura: público+ativo (qualquer um, até sem conta), a
  loja dona, admin. Escrita: só `saveCoupon`.
- `couponRedemptions/{id}` — leitura: dono e admin. Escrita: só servidor.
- `couponAttempts/{uid}` — fechada.
- `orders`: `coupon`, `couponCheck`, `couponCheckReason` protegidos no update;
  `couponCheck*` proibidos no create.
- Índices: `couponRedemptions (couponId,status)` e `(couponId,uid)`;
  `coupons (visibility,status)` e `(sellerId,visibility,status)`.

## Testes

```bash
npm run emulators
node functions/scripts/coupons.test.mjs
```

97 verificações (cálculo, limites, corrida no último cupom, regras do pedido,
gatilho, cancelamento, trava do pagamento, criar/editar/moderar, leitura). Seed
tem 8 cupons: `VINEON10`, `FRETEGRATIS`, `BEMVINDO20` (1ª compra), `ULTIMO1`
(1 uso, privado), `VENCIDO`, `LOJA15` (Loja de Teste), `MARE20` (Ateliê Maré,
privado, 2 produtos), `PAUSADO`.

No emulador não há conta do Melhor Envio: para testar cupom de frete no
checkout, simule a cotação (`ng.getComponent(app-checkout-shipping).selectQuote`).

## Publicar (ordem)

1. `firebase deploy --only firestore:rules,firestore:indexes` e esperar os
   índices ficarem "Prontos".
2. `firebase deploy --only functions:couponQuote,functions:saveCoupon,functions:onOrderWrittenCoupon,...`
   (pelo nome; nunca todas enquanto o `.env` estiver em sandbox).
3. Push em `main` (App Hosting). Nunca junto com o deploy de functions.

## Junto com os cupons (2026-10-07)

O checkout lia `settings/melhor_envio` direto do Firestore antes de cotar o
frete; a regra fecha `settings` desde a Fase 0, então a cotação ficava
carregando para sempre. Agora o app chama só `calculateMelhorEnvioShipping`,
que lê a configuração no servidor.
