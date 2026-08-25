# Runbook — Fase 0 (contenção de segurança)

Passo a passo para colocar em produção as correções da Fase 0.

**A ordem importa.** As regras novas fecham a leitura de `users/`, e as telas de
vitrine passam a ler `sellers/`. Se as regras subirem antes do backfill, o perfil
dos vendedores aparece vazio para todo mundo. Siga de cima para baixo.

Tempo estimado: 40–60 min, boa parte de espera de deploy.

---

## 0. Antes de tudo — revogar as credenciais vazadas

**Isto é com você, no painel do Asaas. Não dá para automatizar e é o passo mais
urgente da lista.**

A chave de produção `$aact_prod_000Mzkw…` e o webhook secret `whsec_RS2WNLw9…`
estavam dentro do bundle JavaScript publicado e continuam no histórico do Git
(commit `c9747d1`). Trocar o código não invalida o que já vazou.

1. Painel do Asaas → **Integrações → API** → revogar a chave atual e gerar uma nova.
2. Painel do Asaas → **Webhooks** → gerar um novo token de autenticação.
3. Confira o extrato da conta em busca de cobrança que você não reconheça.

Guarde os dois valores novos — vão para o `functions/.env` no passo 1.

---

## 1. Preencher `functions/.env`

O arquivo já existe e **não** é versionado. Acrescente:

```bash
# Chave NOVA gerada no passo 0
ASAAS_API_KEY=
ASAAS_API_URL=https://api.asaas.com/v3

# Token do webhook de pagamento do Asaas. Gere agora com `openssl rand -hex 32`
# e guarde: o MESMO valor vai no painel do Asaas, no passo 2b.
ASAAS_WEBHOOK_TOKEN=

# Token NOVO de webhook gerado no passo 0
MELHOR_ENVIO_WEBHOOK_SECRET=

# E-mails que devem ser administradores, separados por vírgula
ADMIN_EMAILS=dev.henriquefabry@gmail.com

# Token de uso único para criar o primeiro admin (apagado no passo 7)
ADMIN_BOOTSTRAP_TOKEN=
```

Gere o token de bootstrap:

```bash
openssl rand -hex 32
```

Confirme que as origens de CORS estão certas para produção — `ALLOWED_ORIGIN=*`
serve em desenvolvimento, não em produção:

```bash
ALLOWED_ORIGINS=https://compraki-mcu.web.app,capacitor://localhost,ionic://localhost
```

---

## 2. Deploy das Functions (antes das regras)

```bash
firebase deploy --only functions
```

Sobe 47 funções, entre elas as novas: `setAdminClaim`, `bootstrapAdminClaims`,
`cleanupLegacyAdminFlags`, `syncSellerProfile`, `backfillSellerProfiles`,
`createAsaasCustomer`, `createAsaasPayment`, `getAsaasPayment`,
`refundAsaasPayment`, `asaasWebhook`.

---

## 2b. Cadastrar o webhook de pagamento no painel do Asaas

**Não pule este passo.** Confirmar pagamento deixou de ser coisa do aplicativo —
quem escreve `status` no pedido é a função `asaasWebhook`, pelo Admin SDK, e as
regras do Firestore barram o cliente. Sem o webhook cadastrado, **nenhum pedido
sai de `PENDING`**: nem PIX, nem boleto, nem cartão.

Painel do Asaas → **Integrações → Webhooks → Adicionar**:

| Campo | Valor |
|---|---|
| URL | `https://us-central1-compraki-mcu.cloudfunctions.net/asaasWebhook` |
| Token de autenticação | o mesmo `ASAAS_WEBHOOK_TOKEN` do passo 1 |
| Versão da API | v3 |
| Eventos | Cobranças (`PAYMENT_*`) |
| Fila de sincronização | ativada |

Confira que responde:

```bash
curl -i -X POST https://us-central1-compraki-mcu.cloudfunctions.net/asaasWebhook \
  -H "Content-Type: application/json" -d '{}'
```

Esperado: **401**. Se vier 503, o `ASAAS_WEBHOOK_TOKEN` não subiu no passo 2.

O que a função faz com cada evento:

- `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED` → pedido vai de `PENDING` para
  `RECEIVED`, **desde que o valor pago bata com o total do pedido**. Divergiu, o
  pedido continua `PENDING` e ganha um campo `paymentAlert` para conferência.
- `PAYMENT_REFUNDED` → `REFUNDED`. `PAYMENT_DELETED` → `CANCELLED`.
- Qualquer outro evento é reconhecido com 200 e ignorado.
- Reenvio do mesmo evento é descartado pela coleção `asaasWebhookEvents`.

---

## 3. Criar o primeiro administrador

Enquanto ninguém tem o custom claim, o painel fica inacessível — inclusive para
você. Este passo resolve isso.

```bash
curl -X POST \
  -H "x-bootstrap-token: SEU_ADMIN_BOOTSTRAP_TOKEN" \
  https://us-central1-compraki-mcu.cloudfunctions.net/bootstrapAdminClaims
```

A resposta traz `granted` com os e-mails que receberam o claim. Se algum cair em
`failed`, confira se a conta existe no Firebase Auth com aquele e-mail exato.

**Depois disso, saia e entre de novo no app.** O claim só entra no ID token na
renovação.

---

## 4. Espelhar os perfis públicos de vendedor

Simulação primeiro (não grava nada):

```bash
TOKEN=$(: "cole aqui o ID token de um admin logado")

curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://us-central1-compraki-mcu.cloudfunctions.net/backfillSellerProfiles
```

Confira `scanned` e `mirrored`. Se os números baterem com o total de usuários,
aplique:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"apply": true}' \
  https://us-central1-compraki-mcu.cloudfunctions.net/backfillSellerProfiles
```

> **Como pegar o ID token:** com o app aberto e logado como admin, no console do
> navegador: `await firebase.auth().currentUser.getIdToken()`. Ou pegue no
> DevTools → Network, no header `Authorization` de qualquer chamada às Functions.

Confirme no console do Firestore que a coleção `sellers` foi criada e que os
documentos **não** têm `cpf`, `email`, `phoneNumber` nem `address`.

---

## 5. Deploy das regras e índices

Só agora — com `sellers/` populada.

```bash
firebase deploy --only firestore:rules,firestore:indexes,database,storage
```

Os índices compostos levam alguns minutos para construir. Acompanhe em
**Firestore → Índices**; enquanto estiverem em `Building`, as consultas que
dependem deles falham.

---

## 6. Limpar as flags legadas de admin

Enquanto o app gravava `isAdmin: true` em todo login, a base inteira ficou
marcada. Os campos não autorizam mais nada, mas poluem o painel.

```bash
# simulação
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://us-central1-compraki-mcu.cloudfunctions.net/cleanupLegacyAdminFlags

# aplicar
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"apply": true}' \
  https://us-central1-compraki-mcu.cloudfunctions.net/cleanupLegacyAdminFlags
```

`keptAsAdmin` lista quem foi preservado por ter o claim de verdade. Confira essa
lista antes de aplicar.

---

## 7. Fechar a porta do bootstrap

```bash
# functions/.env — apague ou esvazie:
ADMIN_BOOTSTRAP_TOKEN=
```

```bash
firebase deploy --only functions
```

Sem a variável, `bootstrapAdminClaims` responde 503 e para de existir na prática.
Daqui para frente, admin se concede pelo painel (que chama `setAdminClaim`).

---

## 8. Publicar o app

```bash
npm run build
firebase deploy --only hosting
```

Para o app Android:

```bash
npx cap sync android
```

---

## 9. Verificação

Marque cada item:

- [ ] Criar uma conta nova e confirmar que **não** aparece menu de administração.
- [ ] Com essa conta, tentar `/admin/metrics` na URL → redireciona para a home.
- [ ] No DevTools, tentar `setDoc(doc(db,'users',meuUid),{isAdmin:true},{merge:true})` → erro de permissão.
- [ ] Abrir um produto → nome, foto e loja do vendedor aparecem normalmente.
- [ ] Abrir o perfil de um vendedor → carrega com os dados da vitrine.
- [ ] Comprar via PIX → cobrança é criada (agora pela Function, não pelo app).
- [ ] Pagar esse PIX de verdade e conferir que o pedido vira `RECEIVED`
      **sozinho**, em segundos, sem ninguém tocar em nada. É o webhook.
- [ ] No DevTools, com um pedido seu na tela, tentar
      `updateDoc(doc(db,'orders',meuPedido),{status:'RECEIVED'})` → erro de
      permissão. Se isso passar, a confirmação de pagamento continua nas mãos
      do comprador.
- [ ] `curl -X POST .../asaasWebhook -d '{}'` sem o header
      `asaas-access-token` → 401.
- [ ] Conferir que o botão "SIMULAR PAGAMENTO" **não** aparece no build de produção.
- [ ] Pedir recuperação de senha duas vezes seguidas → a segunda pede para aguardar.
- [ ] Errar o código 5 vezes → bloqueia e manda pedir um novo.
- [ ] `curl -X POST .../melhorEnvioWebhook -d '{}'` sem header → 401.
- [ ] `grep -r "aact_prod" www/` → sem resultado.

---

## Se algo quebrar

**Perfil de vendedor vazio:** o backfill do passo 4 não rodou ou rodou em
simulação. Rode com `{"apply": true}`.

**"Missing or insufficient permissions" numa tela nova:** provavelmente uma
coleção sem `match` em `firestore.rules`. O Firestore nega por padrão o que não
casa. Veja qual coleção no console do navegador e adicione a regra.

**Pedido pago que não sai de `PENDING`:** olhe o log da função `asaasWebhook`
no console do Firebase.

- Nenhuma execução → o webhook não está cadastrado no Asaas (passo 2b), ou está
  com a URL errada. O painel do Asaas mostra a fila de entregas com o erro.
- `401` → o token do painel não bate com o `ASAAS_WEBHOOK_TOKEN` das Functions.
- `Webhook do Asaas sem pedido correspondente` → a cobrança existe mas nenhum
  pedido tem aquele `asaasPaymentId`. Provavelmente o app caiu entre criar a
  cobrança e gravar o pedido.
- `Valor pago diverge do total do pedido` → o pedido tem `paymentAlert`. **Não
  confirme sem conferir**: é exatamente o sinal de alguém pagando menos do que
  o carrinho vale. O total do pedido ainda vem do navegador; o cálculo no
  servidor está na Fase 1.

**Painel admin inacessível para você:** o claim não entrou no token. Saia,
entre de novo, e confira em:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://us-central1-compraki-mcu.cloudfunctions.net/getMyAdminStatus
```

**Voltar atrás nas regras:** as anteriores estão no Git.

```bash
git show HEAD:firestore.rules > firestore.rules
firebase deploy --only firestore:rules
```

Só faça isso como último recurso — as regras antigas deixam CPF de todo mundo com
leitura pública.

---

# Fase 2 — Performance e custo

Passos adicionais, depois que a Fase 0 estiver no ar.

## 1. Deploy

```bash
firebase deploy --only functions,firestore:indexes
```

Funções novas: `onProductSaved`, `onProductUnsaved`, `recomputeSavedCounts`,
`aggregateDailyMetrics` (agendada, de hora em hora), `refreshMetricsNow`.

Aguarde os índices novos saírem de `Building` em **Firestore → Índices** antes
de seguir — são 4 a mais: `products (categoryIds, createdAt)`,
`orders (status, createdAt)`, `orders (sellerIds, status)` e `users (createdAt)`.

## 2. Popular os contadores e as métricas

Os produtos salvos que já existem nunca passaram pelos gatilhos, então
`savedCount` começa vazio:

```bash
# simulação
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://us-central1-compraki-mcu.cloudfunctions.net/recomputeSavedCounts

# aplicar
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"apply": true}' \
  https://us-central1-compraki-mcu.cloudfunctions.net/recomputeSavedCounts
```

Primeira apuração de métricas (a agendada roda sozinha depois):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://us-central1-compraki-mcu.cloudfunctions.net/refreshMetricsNow
```

## 3. Publicar o app

A saída do build mudou de `www/` para `www/browser/` — que é justamente o que o
`capacitor.config.ts` já esperava. O `firebase.json` agora aponta o hosting para
lá também.

```bash
npm run build
firebase deploy --only hosting
npx cap sync android
```

## 4. Verificação

- [ ] Abrir uma ficha de produto e conferir no DevTools → Network que **não** há
      mais download da coleção `products` inteira.
- [ ] Salvar e dessalvar um produto; conferir `savedCount` subindo e descendo no
      documento do produto.
- [ ] Abrir a tela de estatísticas do produto (`/product-admin/:id`) e ver o
      número de salvos correto.
- [ ] Ficar 5 minutos com o app aberto e conferir que a contagem de leituras do
      Firestore **não** cresce sozinha (era ~40/min pela sondagem da sidebar).
- [ ] Conferir `metrics/summary` criado no Firestore.
- [ ] Primeiro acesso: o painel admin **não** deve ser baixado (Network mostra só
      os chunks das rotas marcadas com `preload`).
