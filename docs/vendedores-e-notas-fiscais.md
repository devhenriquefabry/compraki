# Vendedores e nota fiscal mensal (2026-09-25)

Pedido do Josué: uma aba no painel para ver as lojas, o que cada uma vendeu no
mês, a taxa da Vineon e anexar a nota fiscal mensal que a Vineon emite para a
loja — que a loja recebe no perfil e por e-mail.

## Onde está

| Peça | Arquivo |
|---|---|
| Aba **Vendedores** (`/admin/sellers`) | `src/app/pages/manage-sellers/` |
| Conta do mês, upload, reenvio | `src/app/services/seller-invoices.service.ts` |
| **Notas fiscais** do vendedor (`/my-invoices`) + atalho em Minha conta | `src/app/pages/my-invoices/`, `pages/my-account/` |
| E-mail com a nota anexada | `functions/src/seller-invoices.ts` (`onSellerInvoiceWritten`) |
| Taxa configurável (Ajustes) | `src/app/core/commission.ts`, `appConfig/storefront.commission` |

## Regras de negócio

- **Vendido** = soma dos produtos da loja em pedidos pagos (`RECEIVED`,
  `CONFIRMED`, `DELIVERED`, `IN_ESCROW`), **sem frete**. O mês conta pela data
  do pagamento (`paymentConfirmedAt`; sem ela, a criação do pedido).
- **Taxa Vineon**: configurada em Ajustes (começa em 10%). Cada mudança entra
  no histórico com a data; a venda usa a taxa em vigor **na data do
  pagamento**. Mudar a taxa não altera meses anteriores nem notas já
  enviadas. Se mudou no meio do mês, as telas mostram "5% e 8%".
  **Repasse** = vendido − taxa.
- A taxa é só de relatório e da nota: hoje não existe divisão automática do
  pagamento (split) — o dinheiro não é separado pelo gateway.
- `COMMISSION_RATE` (10%) em `functions/src/metrics.ts` alimenta só o resumo
  `metrics/summary`, que nenhuma tela usa hoje.
- "Vendedor" é quem tem anúncio ou vendeu no mês (todo usuário nasce com
  `isSeller: true`, então esse campo não serve de filtro).
- Uma nota por loja por mês: `sellerInvoices/{sellerId}_{AAAA-MM}`; arquivo em
  Storage `sellerInvoices/{sellerId}/{AAAA-MM}/`. PDF, XML ou foto, até 15 MB.
- O e-mail sai quando `emailRequestedAt` muda (anexar, trocar arquivo ou
  "Reenviar e-mail"). No emulador nada sai: status `simulated`.

## Publicação

Regras (`firestore:rules,storage`) e a function `onSellerInvoiceWritten`
publicadas em 2026-09-25, pelo nome. Site pelo push em `main`.
