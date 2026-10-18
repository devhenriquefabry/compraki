# Auditoria de segurança e telas — 18/10/2026

Rodada pedida antes do lançamento (testes com usuários, divulgação). Tudo foi
testado no emulador (`demo-vineon`); ver "Como testar" no fim.

## Falhas de segurança corrigidas

| # | Gravidade | O que dava para fazer | Correção |
|---|-----------|----------------------|----------|
| 1 | Crítica | O navegador calculava o total, emitia o Pix/boleto com esse valor e gravava o pedido com os preços que quisesse em `items`. O webhook conferia "pago == total do pedido", mas os dois números vinham do mesmo navegador: um produto de R$ 500 saía por R$ 5 e a loja via o pedido como pago. | Cloud Function `placeOrder` (`functions/src/orders.ts`): o app manda só produto/variação/quantidade, endereço, serviço de entrega e reserva do cupom. O servidor lê o preço em `products/`, confere estoque e anúncio no ar, recota o frete no Melhor Envio, aplica frete grátis, confere a reserva do cupom contra esse carrinho e esse frete, emite a cobrança e grava o pedido. `orders` não aceita mais `create` do cliente. Se o total mudou em relação ao que a pessoa viu, a compra para (409 `TOTAL_CHANGED`). |
| 2 | Crítica | A loja podia mudar `shippingInfo.serviceId` / `shipmentId` do pedido: trocar PAC por Sedex na etiqueta paga pelo saldo da Vineon, ou apontar para a etiqueta de outro pedido (dados de outro comprador). | Regra de `orders` virou lista do que PODE mudar: loja só mexe em andamento da entrega, rastreio e a própria nota fiscal, e só em pedido pago; comprador só confirma recebimento e pede devolução. Entregue só depois de enviado e não volta atrás. |
| 3 | Alta | Estoque e "vendidos" nunca mudavam: o navegador do comprador tentava baixar e a regra (só a loja edita o anúncio) recusava em silêncio. | Gatilho `onOrderWrittenInventory`: baixa estoque (inclusive da variação) e soma vendidos quando o pagamento é confirmado; devolve se o pedido pago for cancelado/estornado. Idempotente pelo campo `inventory` do pedido. |
| 4 | Alta | Loja gravava `soldCount`/`savedCount` no próprio anúncio (prova social falsa); preço negativo/texto passava. | `soldCount` e `savedCount` travados para o vendedor; preço e estoque validados na regra. |
| 5 | Alta | Qualquer conta logada sobrescrevia a foto de anúncio de outra loja (caminho público `products/{arquivo}`). | Fotos novas em `products/{uid}/...` (só a dona). Caminho antigo: só cria arquivo que não existe (`resource == null` — no Storage, enviar por cima conta como `create`). Mídia de conversa e anexo de atendimento também não podem ser sobrescritos. |
| 6 | Alta | `dispatchWhatsappTrigger` aceitava qualquer conta: dava para mandar mensagens sem limite pelo WhatsApp da Vineon para a equipe (risco de banimento do número), inclusive "venda" falsa. | "Venda" só sai do servidor (no pagamento confirmado). Os outros avisos do app: dados curtos, sem objeto, até 6 por hora por pessoa. |
| 7 | Alta | `meAuthorizer` (volta do OAuth do Melhor Envio) não conferia `state`: qualquer um trocava o token da Vineon pelo da própria conta e as etiquetas (com endereço dos compradores) passariam por ela. | Exige `state` de uso único (10 min) gerado pelo admin (`melhorEnvioSettings` com `action: 'oauthStart'`). |
| 8 | Média | `createCoraCharge`/`createAsaasPayment` emitiam cobrança com valor do navegador para qualquer conta. | Só admin (cobrança avulsa); o checkout usa `placeOrder`. |
| 9 | Média | Admin "por e-mail" (`ADMIN_EMAILS`) valia sem e-mail verificado: se o endereço não tivesse conta, alguém criava uma com ele e virava admin nas functions. | `isAdminUser()` exige `email_verified`; bootstrap também. As cópias locais em `index.ts` saíram (usa `shared/http.ts`). |
| 10 | Média | Participante de conversa podia trocar `participantIds` (pôr outra conta na conversa); mensagem sem limite de tamanho; denúncia de chat sem validação; usuário mudava `asaasCustomerId` e `createdAt` ("na Vineon desde"). | Regras de `chats`, `messages`, `reports` e `users` endurecidas. |
| 11 | Média | Dois cliques rápidos em "Gerar etiqueta" compravam duas etiquetas (o 2º lia o pedido antes da trava). | Relê o pedido depois de pegar a trava. |
| 12 | Baixa | Site sem cabeçalhos de segurança (podia ser embutido em iframe — clickjacking no checkout). | `server.mjs`: `X-Frame-Options`/`frame-ancestors`, `nosniff`, `Referrer-Policy`, HSTS, `Permissions-Policy`. |
| 13 | Baixa | Cadastro aceitava CPF com dígito errado, senha de 6 caracteres e tinha o atalho de preenchimento de teste (Ctrl+Shift+') no site no ar. | CPF validado de verdade, senha 8+ com letras e números, atalho só fora da produção. |

Também: o checkout cotava o frete para um CEP de exemplo de São Paulo
(`01001-000`) até o endereço carregar; agora espera o endereço da pessoa.

## Telas e funções que faltavam

- **Página "não encontrada" (404)** — rota `**` (`pages/not-found`). Antes, link
  errado abria tela em branco. Busca, início e Central de ajuda.
- **Recebimentos da loja** (`/my-payouts`, Minha conta › Sua loja) — chave Pix
  do repasse (`sellerPayouts/{uid}`, só a loja e o admin leem) e, venda por
  venda, quanto está retido, quando libera, quanto já foi liberado e a taxa.
  Minha conta avisa quando a loja já vendeu e não tem chave.
- **Admin › Devoluções** — no pedido retido, quanto vai para cada loja (já sem
  a taxa) e a chave Pix com botão de copiar; ao liberar, grava o retrato do
  repasse em `escrowInfo.payouts`.
- **Cancelar pedido não pago** (Minhas compras › A pagar) — `cancelOrder`
  cancela a cobrança no Cora antes do pedido. Pedido sem pagamento depois do
  vencimento (3 dias + folga) é cancelado sozinho (`expireUnpaidOrders`, a cada
  6 h), e o cupom volta para a pessoa.
- Excluir conta também apaga a chave Pix.

## Como testar

```
functions/.env.local  →  MELHOR_ENVIO_API_URL / EVOLUTION_API_URL / EVOLUTION_API_KEY / MELHOR_ENVIO_WEBHOOK_SECRET (falsos)
node functions/scripts/fake-integrations.mjs
npm run emulators
node functions/scripts/orders.test.mjs        # 110 verificações (esta rodada)
node functions/scripts/coupons.test.mjs       # 97 (agora passa pelo placeOrder)
node functions/scripts/integrations.test.mjs  # 85
node functions/scripts/support.test.mjs       # 115
node functions/scripts/questions.test.mjs     # 68
node functions/scripts/reviews.test.mjs       # 30
```

O Cora no emulador é falso (`CORA_FAKE=1` em `functions/.env.demo-vineon`;
só vale com `FUNCTIONS_EMULATOR` + projeto `demo-*`): o checkout inteiro roda
sem rede nem certificado, inclusive "simular pagamento".

## Pendências que não são de código

- **App Android:** o Capacitor serve o app em `https://localhost`, que não
  estava em `ALLOWED_ORIGINS` — as functions recusavam o app nativo por CORS.
  Já entrou no padrão do código e no `functions/.env`, mas só vale nas functions
  republicadas. Antes de publicar o APK: republicar todas (em lotes) e trocar o
  `appId` `io.ionic.starter`.
- Cartão (Asaas) segue "em breve": o `placeOrder` já cobra cartão pelo servidor,
  mas o número do cartão ainda passa pelas functions (falta tokenizar no app).
- Pagamentos seguem em sandbox (`functions/.env`).
