# Testes com o emulador do Firebase

Ambiente local completo — Auth, Firestore, Realtime Database, Storage e as
Cloud Functions — com contas de teste que entram **sem tela de login**. Serve
para desenvolver e validar fluxos de ponta a ponta (admin, vendedor, comprador)
sem tocar no `compraki-mcu` de produção.

## Subir

Três terminais, na pasta `vineon/`:

```bash
npm run emulators        # compila as functions e sobe os emuladores (UI em http://localhost:4000)
npm run emulators:seed   # zera e popula: contas, categorias, produtos
npm run start:emulator   # app em http://localhost:4210
```

O seed pode ser rodado a qualquer momento para voltar ao estado inicial.

## Entrar como alguém

Acrescente `?testUser=` a qualquer URL do app:

| URL                                          | Conta           | O que tem                         |
| -------------------------------------------- | --------------- | --------------------------------- |
| `http://localhost:4210/admin?testUser=admin` | `test-admin`    | claim `admin`, painel liberado    |
| `…?testUser=vendedor`                        | `test-vendedor` | "Loja de Teste" com 8 anúncios    |
| `…?testUser=atelie`                          | `test-atelie`   | segunda loja (aba Vendedores)     |
| `…?testUser=comprador`                       | `test-comprador`| endereço padrão cadastrado        |
| `…?testUser=none`                            | —               | sai da conta                      |

O seed também cria o **catálogo** (8 fichas, 1 rascunho) — ver `docs/catalogo.md`.

No console do navegador também dá: `vineonTest.loginAs('vendedor')`,
`vineonTest.logout()`.

Para testar a tela de login em si, as mesmas contas aceitam e-mail e senha
(`admin@vineon.test` / `vineon-teste`, etc.) — só no emulador.

Um selo laranja "EMULADOR · <conta>" fica no canto da tela o tempo todo.

## Por que é seguro

- **Projeto `demo-vineon`.** O Firebase trata ID `demo-*` como projeto sem
  nuvem: o SDK não consegue falar com serviço real nenhum, nem por engano.
- **O login de teste não existe em produção.** Ele mora em
  `src/app/core/emulator-bootstrap.emulator.ts`, que só entra no bundle pelo
  `fileReplacements` da configuração `emulator` em `angular.json`. O build de
  produção usa `emulator-bootstrap.ts`, que não faz nada. E o token usado
  (custom token sem assinatura) é recusado pelo Firebase de verdade.
- **Functions sem efeito externo.** `functions/.env.demo-vineon` só é lido no
  projeto demo e desliga SMTP e WhatsApp (Evolution), além de travar Asaas e
  Cora em sandbox.

## Limites

- Webhooks de pagamento (Asaas, Cora, Melhor Envio) não chegam ao localhost:
  a cobrança é criada no sandbox, mas a confirmação de pagamento não volta
  sozinha. Para testar pós-pagamento, marque o pedido pela UI do emulador
  (http://localhost:4000/firestore) ou chame o webhook local à mão.
- Telas de bots/WhatsApp respondem "Evolution API não configurada" — é
  proposital.
- Funções agendadas (`aggregateDailyMetrics`) não disparam sozinhas no emulador.
- Fotos dos produtos do seed vêm de `picsum.photos` (precisa de internet).

## Melhor Envio e WhatsApp falsos (integrações)

Para testar frete, etiqueta da loja, a aba Melhor Envio e o WhatsApp do admin
sem tocar nos serviços reais:

1. Crie `functions/.env.local` (só o emulador lê; está no `.gitignore`):

   ```
   MELHOR_ENVIO_API_URL=http://127.0.0.1:2626
   EVOLUTION_API_URL=http://127.0.0.1:2727
   EVOLUTION_API_KEY=chave-falsa-local
   MELHOR_ENVIO_WEBHOOK_SECRET=segredo-falso-local
   ```

2. `node functions/scripts/fake-integrations.mjs` — sobe os dois falsos. O do
   Melhor Envio valida o pedido de etiqueta com as regras da documentação oficial
   (CNPJ em `company_document`, `state_abbr`, um volume só para Correios).
3. `npm run emulators` e `node functions/scripts/integrations.test.mjs`
   (84 verificações).

Apague o `.env.local` depois: com ele, o emulador nunca fala com o WhatsApp real.

Baterias por API (todas zeram o seed antes): `coupons`, `support`, `reviews`,
`integrations` e `password-reset` (esta precisa de um SMTP falso — ver o
cabeçalho do arquivo).
