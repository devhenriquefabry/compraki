# Entrega grátis da loja (entrega própria)

Rodada de 29/10/2026. Pedido do Henrique para o lançamento: lojas parceiras
entregam elas mesmas, de graça, dentro da cidade (ou de algumas cidades), sem
passar pelo Melhor Envio.

## Como funciona

| Onde | O quê |
|---|---|
| Anúncio (criar e editar) | Em **Entrega e pagamento**, o bloco **Entrega grátis da loja** (`LocalDeliveryEditorComponent`). A loja liga, escolhe as cidades (UF + nome; a lista do IBGE garante a grafia oficial; atalho com a cidade do endereço padrão), o prazo (mesmo dia, 1, 2, 3 ou 5 dias úteis depois do pagamento) e se **também envia pela transportadora** ou **vende só para essas cidades**. Com "só essas cidades", as opções de envio nacional somem do formulário. |
| Dado | `products/{id}.localDelivery = { cities: [{city, state}], days, onlyLocal }` ou `null`. A regra `isValidLocalDelivery` (firestore.rules) aceita 1–20 cidades, prazo 0–10 e nada além desses três campos. |
| Vitrine | Card do desktop e do celular: "Entrega grátis em <1ª cidade> +N" (quando não há frete grátis nacional). Página do produto: título "Entrega grátis da loja" com as cidades, o prazo e o que vale fora delas. |
| Checkout | `CheckoutShippingComponent` relê os anúncios e chama `planDelivery` com a cidade/UF do endereço. Todos os itens entregues pela loja ali → só aparece **Entrega da loja — Grátis**, sem cotar o Melhor Envio. Senão, cotação normal. Item "só essa cidade" fora da área, ou junto com item que vai por transportadora → o checkout explica e não deixa seguir. |
| Servidor | `placeOrder` aceita `shippingServiceId: 'local'` e confere com a mesma regra (`functions/src/local-delivery.ts`). O pedido sai com `shippingCost: 0` e `shippingInfo = { serviceId: null, serviceName: 'Entrega da loja', localDelivery: true, deliveryTime: <prazo>, freeShipping: true, quotedPrice: 0 }`. |
| Venda (loja) | `sale-details`: sem "Gerar etiqueta" nem rastreio. **Combinar pelo chat** → **Saiu para entrega** (`SHIPPED`) → **Marcar como entregue**. O prazo mostrado é o do anúncio (`shipByDate`). |
| Compra (comprador) | Minhas compras: "A própria loja entrega no seu endereço", **Falar com a loja** no lugar de "Rastrear", e **Recebi o pedido** como sempre. Previsão = pagamento + prazo da loja. |

## Regras (as mesmas no app e no servidor)

- A cidade é comparada sem acento, sem caixa e sem pontuação, junto com a UF
  (`cityKey`). "Sao  Paulo/sp" no anúncio bate com "São Paulo/SP" no endereço.
- Entrega da loja vale quando **todos** os itens do pedido são entregues por
  loja que atende a cidade do endereço (como o frete grátis, que também é do
  pacote inteiro). Pedido com duas lojas que entregam ali: grátis, prazo da
  mais lenta, cada loja leva os próprios itens.
- Carrinho misto (um item com entrega da loja e outro sem): vai tudo pela
  transportadora, com frete — **a não ser** que algum item seja "só essa
  cidade": aí o pedido é recusado com "faça um pedido só com ele".
- App antigo que mandar um serviço do Melhor Envio para um carrinho que tinha
  entrega da loja: aceito, desde que nenhum item seja "só essa cidade".
- Sem etiqueta: `createMelhorEnvioShipment` recusa pedido sem `serviceId`
  ("Este pedido não tem forma de entrega do Melhor Envio"). Nada sai do saldo
  da Vineon. Repasse e taxa não mudam (o frete já não entrava na conta).

Mudou a regra, mude nos dois arquivos: `src/app/core/local-delivery.ts` e
`functions/src/local-delivery.ts`.

## Testes

`node functions/scripts/local-delivery.test.mjs` (precisa do Melhor Envio
falso e do `.env.local`, como a bateria de pedidos — ver
`docs/testes-com-emulador.md`). Cobre entrega da loja aceita e recusada,
grafia, duas lojas, carrinho misto, "só essa cidade", total esperado, etiqueta
recusada, loja marcando saiu/entregue e a regra do anúncio.

## Publicação

1. `firestore.rules` (só acrescenta a validação de `localDelivery`; anúncio
   sem o campo passa igual).
2. Function `placeOrder`, pelo nome (`.env` de produção).
3. Site: push em `main` (App Hosting publica sozinho).

Ordem: function antes do site. O site novo manda `'local'`, que o
`placeOrder` antigo recusaria.

## Limites conhecidos

- A área é por cidade inteira (não por bairro, raio ou CEP).
- Pedido com várias lojas tem um só andamento de entrega (`shipmentStatus`),
  como já acontecia com transportadora: a primeira loja que marca "entregue"
  fecha a entrega do pedido.
- O selo da vitrine mostra a cidade da loja para todo mundo; quem é de outra
  cidade vê o selo e descobre no anúncio/checkout que lá o frete é cobrado.

## Quem paga o frete grátis (desde 29/10/2026)

| Origem do frete grátis | Quem paga a etiqueta |
|---|---|
| Loja marcou **Frete grátis** no anúncio | A loja: sai do repasse, depois da taxa (a taxa continua só sobre os produtos). |
| Regra da Vineon por valor mínimo (Admin › Ajustes) | A Vineon. Se o item já entraria na regra, a Vineon paga mesmo que a loja tenha marcado. |
| Cupom de frete da Vineon | A Vineon (como antes: cupom `platform` não sai da loja). |
| Entrega própria da loja | Ninguém: não tem etiqueta. |

O `placeOrder` grava `shippingInfo.sellerShippingCost = { <uid>: valor }` só
quando há parte paga pela loja. Pedido de várias lojas divide o custo da
etiqueta (`quotedPrice`) pelo valor dos produtos, arredondando para baixo (o
centavo que sobra fica com a Vineon). Quem lê: `sellerShippingCost()` em
`core/order-stage.ts`, usado em Recebimentos, Admin › Devoluções (repasse),
relatório mensal da aba Vendedores (`shippingCost`, guardado no resumo da nota
e mostrado no e-mail) e no resumo da venda. Pedido antigo, sem o campo, não
desconta nada.

Bateria: `node functions/scripts/free-shipping-cost.test.mjs` (9).
