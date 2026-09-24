# Pagamentos: Cora (PIX e boleto) + Asaas (cartão), em sandbox

Desde 2026-09-23:

| Forma      | Quem cobra | Functions                                                    |
|------------|------------|--------------------------------------------------------------|
| PIX        | Cora       | `createCoraCharge`, `getCoraCharge`, `syncCoraCharge`, `coraWebhook` |
| Boleto     | Cora       | idem (boleto com QR PIX embutido)                            |
| Cartão     | Asaas      | `createAsaasCustomer`, `createAsaasPayment`, `asaasWebhook`  |
| Simulação  | Cora stage | `simulateCoraPayment` (recusa tudo quando `CORA_ENV=production`) |

Comportamentos do Cora vistos no stage (2026-09-24) e já tratados no código:
fatura só com PIX falha (`REC-0030 Bank slip not registered in CIP`), então
toda cobrança sai como boleto + PIX; valor mínimo R$ 5,00; após o pagamento a
fatura fica `OPEN` por alguns segundos antes de `PAID` (o webhook pede reenvio).

O `functions/.env` está em **modo sandbox**: enquanto estiver assim, nenhuma
compra real funciona no site. O status do pedido só muda pelo servidor (webhook
ou "Já paguei"), nunca pelo navegador.

---

## 1. O que o cliente precisa gerar

### Cora — credenciais de **Stage** (Integração Direta)
No app do Cora ou no Cora Web: **Conta > Integrações via APIs**, pedir
credenciais de **Integração Direta** para o ambiente de **Stage/testes**. Vêm três
coisas:

- `client_id` (texto, ex.: `int-xxxxxxxx`)
- certificado (`certificate.pem`)
- chave privada (`private-key.key`)

Stage e produção têm credenciais **diferentes**; as de produção não abrem o
stage. Se o painel não oferecer stage, pedir em **suporteapi@cora.com.br**.
Para o PIX sair, a conta precisa ter **ao menos uma chave PIX cadastrada**.

### Asaas — conta de **Sandbox**
O sandbox do Asaas é uma **conta separada**: criar em
<https://sandbox.asaas.com> (pode ser com o mesmo e-mail). Lá dentro:

- **Integrações > API** → gerar chave (começa com `$aact_hmlg_`).
- **Integrações > Webhooks** → novo webhook:
  - URL: `https://us-central1-compraki-mcu.cloudfunctions.net/asaasWebhook`
  - Token de autenticação: o valor de `ASAAS_WEBHOOK_TOKEN` do `functions/.env`
  - Eventos: cobranças (pelo menos `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
    `PAYMENT_REFUNDED`, `PAYMENT_DELETED`)

> Não mandar certificado, chave privada ou API key por WhatsApp/e-mail aberto.
> O ideal é o cliente te dar acesso ao painel, ou mandar por um cofre de senhas.

---

## 2. Configurar a env (máquina do dev)

```powershell
cd functions
# 1) Cole o client_id e a chave do Asaas sandbox no functions/.env:
#      CORA_CLIENT_ID=...
#      ASAAS_API_KEY=$aact_hmlg_...
# 2) Certificado e chave do Cora (grava em base64 no .env):
node scripts/cora.mjs import-cert C:\caminho\certificate.pem C:\caminho\private-key.key
# 3) Confere se o Cora aceita as credenciais:
node scripts/cora.mjs token
```

Depois do `import-cert`, apague os arquivos originais de Downloads.

## 3. Publicar

```powershell
# Na raiz do projeto. Não rodar junto com rollout do App Hosting (cota do Cloud Run).
firebase deploy --only functions,firestore:rules
```

O app (checkout, tela de PIX) sobe pelo App Hosting com o push na `main`.

## 4. Cadastrar o webhook do Cora (uma vez, depois do deploy)

```powershell
cd functions
node scripts/cora.mjs webhooks register   # invoice.paid e invoice.canceled
node scripts/cora.mjs webhooks list
```

---

## 5. Roteiro de teste

**PIX (Cora)**
1. Logado, carrinho com um produto barato → checkout → PIX.
2. Tela do QR: deve mostrar QR + copia e cola e o aviso "Ambiente de testes".
3. **Simular pagamento** → o Cora paga no stage e dispara `invoice.paid`.
4. A tela avança sozinha para "Pagamento aprovado"; em **Meus pedidos** o pedido
   sai de "A pagar" e vai para "Em preparação".
5. Se não avançar: **Já paguei, verificar** (consulta o Cora direto). Se isso
   resolve e o webhook não, o problema é o cadastro do webhook — ver logs de
   `coraWebhook`.

**Boleto (Cora)**
1. Checkout → Boleto → alerta com linha digitável + "Abrir boleto".
2. Em **Meus pedidos** → Pagar → abre o PDF.
3. Simular: `node scripts/cora.mjs pay inv_...` (id em `orders/{id}.coraInvoiceId`).

**Cartão (Asaas)**
- No sandbox todo cartão válido é aprovado; os números que simulam recusa estão
  em <https://docs.asaas.com/docs/testando-pagamento-com-cart%C3%A3o-de-cr%C3%A9dito>.
- Aprovado → o webhook do Asaas leva o pedido para "Em preparação" em segundos.

**Acompanhamento do pedido** (depois de pago): vendedor marca envio na tela de
venda → comprador vê "A caminho" → confirma recebimento → avaliação.

**Estorno**: cartão estorna pela API do Asaas. PIX/boleto do Cora: a tela de
estornos pede para devolver o valor por PIX no app do Cora e só registra.

### Onde olhar quando algo falhar
- Logs: `firebase functions:log --only coraWebhook` (ou `createCoraCharge`,
  `asaasWebhook`).
- `coraCharges/{inv_...}`: dono e último status visto da fatura.
- `orders/{id}.paymentAlert`: `VALUE_MISMATCH` (valor pago ≠ total) ou
  `OWNER_MISMATCH` (pedido apontando para fatura de outro usuário). O pedido
  **não** vira pago nesses casos.

---

## 6. Virar para produção

1. Cliente gera as credenciais de **produção** do Cora (outro client_id,
   certificado e chave) e a chave de produção do Asaas **da conta dele**.
2. No `functions/.env`:
   - `CORA_ENV=production`, `CORA_CLIENT_ID=` de produção,
     `node scripts/cora.mjs import-cert ...` com os arquivos de produção.
   - `ASAAS_API_URL=https://api.asaas.com/v3`, `ASAAS_API_KEY=` de produção.
   - Cadastrar o webhook do Asaas também na conta de produção (mesmo token).
3. `firebase deploy --only functions` e `node scripts/cora.mjs webhooks register`
   (o cadastro de webhook é por ambiente).
4. Apagar os pedidos de teste do Firestore.

O botão "Simular pagamento" some sozinho: ele depende de a cobrança ter sido
emitida no stage, e o servidor recusa simulação em produção.
