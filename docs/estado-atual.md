# Estado atual do Vineon — handoff

Última atualização: 25/08/2026.

Documento de passagem de bastão. Se você está começando uma sessão nova, leia
isto primeiro, depois `docs/runbook-fase-0.md` para o deploy.

---

## Resumo em três linhas

Foi feita uma auditoria de arquitetura completa, seguida da **Fase 0**
(contenção de segurança) e da maior parte da **Fase 2** (performance e custo).
O trabalho está commitado no branch `fase-0-seguranca`, ainda **não deployado** e
não empurrado. Há uma ação urgente que só o Henrique pode fazer: revogar a chave
do Asaas.

Relatório da auditoria:
https://claude.ai/code/artifact/7b75f845-daaa-47ce-933b-ca4bc5c2788b

---

## AÇÕES PENDENTES DO HENRIQUE (em ordem)

1. **Revogar a chave de produção do Asaas e o token de webhook**, no painel do
   Asaas. A chave `$aact_prod_000Mzkw…` e o `whsec_RS2WNLw9…` estavam dentro do
   bundle publicado e continuam no histórico do Git (commit `c9747d1`). Trocar
   o código não invalida o que já vazou. Conferir o extrato da conta.
2. Preencher `functions/.env` com os valores novos (modelo em `.env.example`),
   incluindo o `ASAAS_WEBHOOK_TOKEN` novo.
3. **Cadastrar o webhook de pagamento no painel do Asaas** (passo 2b do
   runbook). Sem ele nenhum pedido sai de `PENDING` — confirmar pagamento
   deixou de ser coisa do aplicativo.
4. Deployar **na ordem do `docs/runbook-fase-0.md`** — a ordem importa: o
   backfill de `sellers/` tem que rodar antes das regras novas, senão os perfis
   de vendedor ficam vazios.
5. Decidir sobre o histórico do Git (reescrever ou tratar o repositório como
   comprometido).

---

## Fase 0 — contenção de segurança (feita no código)

**Escalonamento de admin.** O app gravava `isAdmin: true` em todo login e o
`adminGuard` devolvia `true` para qualquer logado — a base inteira era
administradora. Agora privilégio é **exclusivamente** o custom claim `admin` no
ID token. Nunca voltar a autorizar por campo de documento: `users/{uid}` é
gravável pelo dono.

**Dado pessoal.** `users/{uid}` tinha `allow read: if true` com CPF, telefone e
endereço. Como regra do Firestore é por documento (não dá para liberar campos
soltos), criei `sellers/{uid}` — espelho público mantido pelo trigger
`syncSellerProfile`, com lista fechada de campos. No cliente, ler outro usuário
é `getPublicSellerProfile()`, nunca `getUserById()`.

**Regras reescritas** (`firestore.rules`): subcoleção `messages` valida
participante (não herda a regra do pai), `products` valida `resource.data` e
separa create/update/delete, `orders` protege `total`/`items`/`asaasPaymentId`,
e todas as coleções que faltavam entraram. Criados também `database.rules.json`
(o RTDB de presença não tinha regra nenhuma) e `firestore.indexes.json`.

**Asaas fora do navegador.** A integração virou `functions/src/payments/asaas.ts`
com a chave em `functions/.env`. O `customerId` vem sempre de `users/{uid}` no
servidor. Estorno é admin-only. `getCustomerByCpf` foi removido (permitia
enumerar clientes). Isso também consertou o fato de o proxy `/asaas-api` só
existir no `ng serve` — pagamento estava quebrado no build de produção.

**Reset de senha.** Guarda hash em vez do código, 8 dígitos com `randomInt`,
máximo 5 tentativas, 1 envio/min e 5/hora, comparação em tempo constante, revoga
sessões ao trocar. Removido o `code:` que voltava no corpo da resposta quando o
envio falhava — era takeover de qualquer conta.

**Confirmação de pagamento.** Não existia nenhuma no servidor: quem marcava
pedido como pago era o botão "SIMULAR PAGAMENTO" no navegador do próprio
comprador. Desligar o botão sozinho deixaria PIX e boleto presos em `PENDING`
para sempre. Entrou `functions/src/payments/asaas-webhook.ts` — valida o token
no cabeçalho `asaas-access-token`, é idempotente por evento
(`asaasWebhookEvents`), só permite transição de status que faça sentido, e
**confere o valor pago contra o total do pedido** antes de confirmar. Divergiu,
o pedido não vira pago e ganha `paymentAlert`.

Junto com isso, `status` entrou na lista de campos que o cliente não escreve em
`orders` — sem essa parte o comprador continuaria confirmando o próprio
pagamento pelo SDK, e o webhook seria decoração.

**Outros:** assinatura no `melhorEnvioWebhook`; autenticação nos dois endpoints
abertos do Melhor Envio; `maxInstances` nas 39 functions; `user-scalable=no`
removido; `simulatePayment` (marcava pedido como pago sem cobrança) travado fora
de produção; status de cartão passa a vir do Asaas em vez de aprovação
presumida; segredos e URLs `localhost` movidos para `environment`.

---

## Fase 2 — performance e custo (feita em grande parte)

- **Sondagem removida:** `app.component` fazia `getUserById()` num `setInterval`
  de 1,5s (~40 leituras/min por usuário logado). Agora são listeners.
- **`shareReplay` em toda leitura** + cache de stream por chave em
  `FirebaseProducts`. Os Observables eram frios: cada `| async` abria um
  listener novo, e a ficha de produto chegava a 17.
- **`getAll()` desmontado** onde era abuso: `getRelated()` consulta por categoria
  com `limit` (a ficha baixava o catálogo inteiro para mostrar 10);
  `product-admin`, `edit-product` e `stats.service` passaram a usar `getById()`.
  `getPage()` (`limit`/`startAfter`) está pronto para paginação.
- **`savedCount` desnormalizado** por gatilho, no lugar de varrer
  `collectionGroup('savedProducts')` a cada abertura de tela.
- **Métricas admin** por Function agendada (`aggregateDailyMetrics`, de hora em
  hora) usando aggregation queries `count`/`sum`, gravando em `metrics/summary`.
- **Build migrado** para `@angular/build:application`. Isso consertou uma
  inconsistência: `capacitor.config.ts` já apontava para `www/browser` enquanto
  o builder antigo gerava `www/` plano — o `cap sync` pegava o diretório errado.
  Configurado também o bloco `hosting` no `firebase.json`, que não existia.
  Budgets viraram 800 kB (aviso) / 2 MB (erro), como catraca.
- **Preload seletivo** no lugar de `PreloadAllModules`, que baixava até o painel
  admin no primeiro acesso. E `trackBy` nas listas de maior tráfego.

---

## O que sobrou

**Da Fase 2:**
- Apontar a UI do painel admin para `getSummaryMetrics()`. O serviço já tem o
  método e a Function que o alimenta; a página ainda usa listeners de coleção
  inteira. Falta decidir como mostrar "número de X minutos atrás" e onde fica o
  botão de atualizar — decisão de produto.
- Migrar a vitrine `tab2` para rolagem paginada com `getPage()`. Muda a UX: o
  filtro hoje é client-side e passaria a ser server-side.
- `OnPush` (só o `trackBy` foi feito). Continua 0 de 98 componentes.
- Regra de lint contra `subscribe()` sem encerramento — precisa instalar
  `eslint-plugin-rxjs`.

**Fase 1 (pulada, ainda pendente):** CI no GitHub Actions, projeto Firebase de
staging separado, testes de regras com emulador, Crashlytics/Sentry, budgets
apertando.

**O item mais importante da Fase 1 é o total calculado no servidor.**
`createAsaasPayment` recebe o `value` do navegador, e o `total` do pedido também
é escrito pelo cliente — dá para montar um pedido de R$ 500 e uma cobrança de
R$ 0,01. O webhook mitiga (compara os dois e se recusa a confirmar quando
divergem), mas a correção de verdade é a função receber o `orderId`, ler os
itens e recalcular o preço a partir de `products/`. O navegador não deveria ter
opinião sobre quanto custa.

Vale junto: tokenizar o cartão com o SDK do Asaas no front, para número e CCV
nunca passarem pelas Functions (está comentado em `createAsaasPayment`).

**Fase 3:** a11y (41 de 87 imagens sem `alt`, 0 com dimensão, 38 `<div (click)>`,
3 `autocomplete` em 133 campos), Reactive Forms, estado na URL, quebrar
`functions/src/index.ts` (3.016 linhas) em módulos por domínio.
**Destrava uma economia de bundle:** trocar `IonicModule.forRoot()` por
`provideIonicAngular()` foi testado e falha com `NG8001` — exige o
`AppComponent` standalone primeiro.

**Fase 4:** busca (Typesense/Algolia sincronizado por Function), E2E dos fluxos
de receita, signals, push, métricas de negócio.

---

## Decisão de arquitetura de longo prazo

Conversada em 25/08. Firebase **fica** para auth, chat, mídia e push — é onde
ele ganha. O que sai, e quando:

1. **Catálogo → motor de busca** (Typesense), sincronizado do Firestore por
   Function. Gatilho: busca decente virar requisito, ou a segunda cidade.
   Resolve busca textual, facetas, geo e relevância de uma vez.
2. **Núcleo financeiro → Postgres/Supabase.** Gatilho: split de pagamento,
   repasse a vendedor, ou a segunda cidade.
3. **Camada de leitura com cache** para a vitrine.

O motivo não é capacidade — o Firestore aguenta o tráfego. É formato de
consulta: não tem busca textual, não tem geo por raio combinado com filtros,
não tem GROUP BY, e facetas explodem em índice composto. É isso que trava um
marketplace multi-cidade.

**Mas a prioridade continua sendo arrumar o padrão de acesso a dado antes de
migrar** — senão os mesmos problemas vão junto para o Postgres.

---

## Arquivos criados nesta rodada

```
firestore.indexes.json                      11 índices compostos
database.rules.json                         regras do RTDB (presença)
docs/runbook-fase-0.md                      deploy passo a passo (Fase 0 + Fase 2)
docs/estado-atual.md                        este arquivo

functions/src/shared/http.ts                CORS, auth, requireAdmin, maxInstances
functions/src/admin-claims.ts               setAdminClaim, bootstrap, limpeza
functions/src/seller-profile.ts             espelho users/ → sellers/
functions/src/payments/asaas.ts             Asaas server-side
functions/src/payments/asaas-webhook.ts     confirmacao de pagamento
functions/src/counters.ts                   savedCount por gatilho
functions/src/metrics.ts                    métricas agregadas agendadas

src/app/core/auth-state.ts                  estado de auth compartilhado
src/app/core/selective-preload.strategy.ts  preload por rota marcada
src/app/core/track-by.ts                    trackBy padrão
```

## Dívida técnica registrada

`functions/src/index.ts` ainda mantém cópias locais dos helpers de
`functions/src/shared/http.ts`. Ao mexer em regra de autorização, mexer **nos
dois lugares** até a Fase 3 unificar. Está comentado nos dois arquivos.
