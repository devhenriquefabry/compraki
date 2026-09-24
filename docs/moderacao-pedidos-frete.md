# Moderação, acompanhamento de pedidos, frete grátis e redes sociais

Rodada de 24/09/2026. Seis pedidos do cliente, **publicados no mesmo dia**:
regras do Firestore/Storage, as três functions novas e o site (commit 5367635).

## O que entrou

| Pedido | Onde está |
|---|---|
| Redes sociais | Admin → **Ajustes**. Aparecem no rodapé do site e no fim da tela Conta do app (`SocialLinksComponent`). Rede sem link não aparece. |
| Nota fiscal / declaração de conteúdo | Tela da venda (`sale-details`): a loja anexa PDF ou foto. O comprador vê em Minhas compras → "Acompanhar pedido"; o admin, na aba Pedidos. Storage `orders/{orderId}/fiscal/{sellerId}/`. |
| Andamento de todos os pedidos | Admin → **Pedidos** (tempo real, filtros por etapa, "precisam de atenção"). Comprador: Minhas compras → "Acompanhar pedido", linha do tempo com data/hora de cada marco (`OrderTimelineComponent`). |
| Frete grátis por valor | Admin → **Ajustes**: liga/desliga + valor mínimo. Selo na vitrine, ficha e carrinho; no checkout o frete zera quando **todos** os itens têm frete grátis. O pedido guarda `shippingInfo.freeShipping` e `quotedPrice` (custo real da etiqueta). |
| Produtos não aceitos | Admin → **Ajustes**: lista de termos. O formulário de anúncio (criar e editar) mostra "Esse produto não é aceito" na hora e trava o botão. Garantia no servidor: função `moderateProductName` tira do ar o que passar; `onStorefrontConfigWritten` revarre o catálogo quando a lista muda. |
| Denunciar / derrubar conta | Links discretos "Denunciar anúncio / vendedor" na ficha e "Denunciar loja" na página da loja. Admin → **Denúncias**: tirar anúncio do ar, suspender conta, descartar, desfazer. Admin → Usuários também tem "Suspender conta". |

Configuração em `appConfig/storefront` (leitura pública, escrita só admin).
Denúncias em `contentReports` (separado de `reports`, que é do chat).

## Suspensão de conta (`setAccountSuspension`)

Desativa o usuário no Firebase Auth e revoga as sessões, cria
`accountSuspensions/{uid}` (as regras consultam para barrar escrita com token
ainda válido), espelha em `users/{uid}.suspended` e `sellers/{uid}.suspended`,
tira do ar os anúncios (`moderation.reason = 'account_suspended'`) e registra em
`moderationLog`. Reativar desfaz tudo e só devolve ao ar o que saiu pela
suspensão. Admin não pode ser suspenso (tire o claim antes).

## Ordem de publicação (usada no deploy de 24/09; repetir ao mexer de novo)

1. **Regras** (as duas já compilam — conferido com `--dry-run`):
   `firebase deploy --only firestore:rules,storage`
   Sem isso: a config não é lida (site cai no padrão: frete grátis desligado,
   nada bloqueado), denúncia e anexo de nota falham por permissão.
2. **As três functions novas, só elas** — o `functions/.env` está em modo
   sandbox do Cora (ver `docs/pagamentos-sandbox.md`), então não fazer deploy
   de todas:
   `firebase deploy --only functions:setAccountSuspension,functions:moderateProductName,functions:onStorefrontConfigWritten`
   Não rodar junto com rollout do App Hosting (cota de escrita do Cloud Run).
3. **Site**: commit + push em `main` (App Hosting publica sozinho).

## Limites conhecidos

- Pedido com itens de frete grátis **e** itens sem: o frete é cobrado inteiro
  (a cotação do Melhor Envio é uma só para o pacote).
- O preço do pedido continua vindo do navegador (dívida já registrada em
  `estado-atual.md`); a regra de frete grátis é aplicada no cliente.
- `arma*` (prefixo) também pega "armário" — o painel tem um campo de teste.
