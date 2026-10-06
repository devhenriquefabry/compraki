# Fale com a Vineon (`/support`) — central de atendimento

Atendimento por protocolo, dentro do app. A pessoa abre um atendimento em 3 passos, recebe o
número na hora, acompanha a conversa (tempo real) e é avisada por app e por e-mail; a equipe
responde de uma fila na aba **Atendimento** do `/admin`. A pesquisa e o plano aprovado em
2026-10-06 estão resumidos na seção "Por que assim".

## Telas

| Rota | Quem | O que é |
| --- | --- | --- |
| `/support` | logado | Porta de entrada: busca da Central, botão de abrir, lista "Seus atendimentos" |
| `/support/new` | logado | Assunto → pedido (se o assunto pede) → detalhes → protocolo |
| `/support/:id` | dono | A conversa: responder, anexar, marcar resolvido, reabrir (7 dias), avaliar |
| `/admin/support` | admin | Fila + conversa + contexto + notas internas + respostas prontas |

Entradas: Minha conta › Fale com a Vineon (com selo de resposta nova), Menu do celular,
rodapé do site, cartão final da Central de ajuda (e o "Não resolveu?" de cada resposta),
"Preciso de ajuda" no pedido do comprador, "Falar com a Vineon" na venda do vendedor, Termos.

Parâmetros de `/support/new`: `?pedido=<id>&perfil=buy|sell` (botão do pedido), `?assunto=<id>`,
`?de=<id da pergunta da Central>` (mede o que a Central não resolveu), `?relacionado=<id>`
(novo atendimento depois de um encerrado). O rascunho fica em `sessionStorage` por 2 horas
(`vn_support_draft`), para a pessoa poder sair e ler uma resposta da Central.

## Dados (`supportTickets`)

```
supportTickets/{id}            protocolo VN-AAAA-NNNNNN, dono, assunto, status, prioridade,
                               prazo da 1ª resposta, não lidos (pessoa/equipe), avaliação…
supportTickets/{id}/replies    a conversa (senderRole: user | staff | system)
supportTickets/{id}/notes      notas internas — só admin (fora de `replies` de propósito)
supportCounters/{ano}          sequência do protocolo — só Admin SDK
Storage: support/{uid}/{ticketId}/{arquivo}   anexos (foto JPG/PNG/WebP ou PDF, até 5 MB, até 3)
```

Status: `waiting_staff` (na fila da Vineon) · `waiting_customer` (bola com a pessoa) ·
`resolved` (pode reabrir por 7 dias) · `closed` (encerrado, não recebe mais nada).

**O cliente só lê.** Criar atendimento, gravar mensagem e mudar status passam pelas functions:

| Function | O que faz |
| --- | --- |
| `createSupportTicket` | valida, confere que o pedido é da pessoa, limita (5 abertos, 20 s entre um e outro), numera, grava o resumo do pedido e o prazo, manda e-mail de confirmação e aviso à equipe |
| `replySupportTicket` | responde e/ou muda o status (pessoa: só `resolved`; equipe: também `waiting_customer`, `waiting_staff`, `closed`); aviso no app + e-mail à pessoa quando a equipe responde |

Direto pelo app só: marcar como lido, avaliar (uma vez, depois de resolvido), e — equipe —
atribuir, prioridade e notas. **Status só muda pela function** (a regra recusa o resto).

Prazo: a meta interna de 1ª resposta é 24 h úteis (8 h para prioridade alta, calculadas em
horário de Brasília sem sábado e domingo); o que a pessoa lê ("até 2 dias úteis, seg–sex 9h–18h")
mora em `core/support-config.ts`. O limite legal é 5 dias (Decreto 7.962/2013, art. 4º).

## O que mexer quando mudar

- **Assuntos, prioridade e dicas:** `core/support-topics.ts` **e** `TOPICS` em `functions/src/support.ts`.
- **Limites e textos de prazo:** `core/support-config.ts` **e** `LIMITS` em `functions/src/support.ts`.
- **Respostas prontas da equipe:** `core/support-macros.ts` (marcadores `{nome}`, `{protocolo}`, `{pedido}`).
- **E-mail que recebe os avisos de atendimento novo:** `SUPPORT_INBOX` no `functions/.env`
  (sem ela vale o `SMTP_USER`). O e-mail de contato exibido é `COMPANY.supportEmail`.
- **Mudou `orderStage()`:** o resumo do pedido usa `stageOf` de `functions/src/notifications.ts`.

## Deflexão (Central de ajuda antes do atendimento)

`suggestHelp()` (em `core/help-content.ts`) sugere perguntas da Central enquanto a pessoa
escreve o título e a mensagem; a resposta abre numa folha (`<vn-help-answer>`) sem tirar a
pessoa do formulário. É mais tolerante que `searchHelp()` e exige 2 palavras úteis em comum.

## LGPD

- Excluir conta (`deleteMyAccount`): atendimentos ficam como registro **sem nome e e-mail**, e as
  fotos e PDFs de `support/{uid}/` são apagados.
- "Baixar meus dados" inclui `atendimentos` (sem as notas internas).
- `/privacy` descreve o que é guardado. **Pendente (Josué / jurídico):** prazo de guarda. Hoje
  nada apaga atendimento sozinho; a recomendação é texto por 5 anos e anexos por 12 meses após
  o encerramento (rotina da Fase 2).

## Testar

```
npm run emulators                              # um terminal
node functions/scripts/support.test.mjs        # 115 verificações: regras, Storage, as 2 functions e a exclusão de conta
npm run start:emulator                         # abrir ?testUser=comprador|vendedor|admin
```

`support.test.mjs` roda o seed antes (zera e recria). O seed cria 5 atendimentos (novo, aguardando
cliente, resolvido, encerrado e um atrasado). Os ids do seed têm 20 caracteres de propósito: as
functions só aceitam o formato do id automático do Firestore. No emulador o e-mail só é
registrado no log (`simulated`); nenhum e-mail real sai.

## Publicar

Nesta ordem (nunca junto com rollout do App Hosting — disputam cota do Cloud Run):

1. `firebase deploy --only firestore:rules,firestore:indexes,storage` e **esperar o índice
   `supportTickets (userId, updatedAt)` ficar "Pronto"** (a function de abrir consulta por ele).
2. `firebase deploy --only functions:createSupportTicket,functions:replySupportTicket`
   (só pelo nome: o `.env` de pagamentos pode estar em sandbox). `deleteMyAccount` também mudou:
   `functions:deleteMyAccount`.
3. `SUPPORT_INBOX` no `functions/.env` se a caixa de atendimento não for o `SMTP_USER`.
4. Push na `main` (rollout do site).

## Por que assim (resumo da pesquisa)

- **Construir dentro do app** em vez de helpdesk de terceiros: o contexto do pedido já está no
  Firestore; mesma identidade, avisos e painel; sem novo operador de dados. Zoho Desk grátis é
  só e-mail e 3 agentes; o plano grátis do Freshdesk acabou; Chatwoot exige servidor.
- **Sem WhatsApp e sem chat/IA agora:** a Evolution API não é oficial, mora num Fly.io dividido com
  outro projeto e já causou a conta de faturamento suspensa; a API oficial da Meta passa a cobrar
  mensagens de serviço desde 2026-10-01. Fica para a Fase 3, se houver volume.
- **Prazo:** Decreto 7.962/2013 art. 4º — canal eletrônico eficaz, confirmação imediata do
  recebimento (a tela de protocolo) e resposta em até 5 dias.

## Fase 2 (não feita)

Formulário público para quem não consegue entrar (conta suspensa, senha perdida) com proteção
contra robô; rotina diária (lembrete após 3 dias sem a pessoa, resolver sozinho em 7, encerrar
7 dias depois, limpar anexos); push para a equipe; respostas prontas editáveis em Ajustes;
relatórios (1ª resposta, tempo de solução, avaliação, artigos da Central que viram atendimento).
Até lá, quem não consegue entrar escreve para o e-mail de atendimento.
