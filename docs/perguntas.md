# Perguntas aos vendedores

Como funciona o sistema de perguntas e respostas da Vineon (outubro de 2026).
Referência de mercado: Mercado Livre ("Perguntas": públicas, respondidas pela
loja, tempo de resposta pesa na reputação, sem contato por fora, loja bloqueia
ou denuncia) e Amazon ("Perguntas e respostas": a resposta ajuda quem vem
depois, busca por perguntas parecidas antes de perguntar).

## Para quem compra

- **Onde perguntar:** página do produto > **Perguntas e respostas** (fica entre
  a descrição e as opiniões; o card do vendedor tem o atalho "Ver perguntas e
  respostas"). O chat continua existindo para combinar detalhes do pedido.
- **Precisa de conta.** Visitante lê as respondidas e é levado ao login para
  perguntar (`requireAccount`, volta para o mesmo anúncio).
- **A pergunta:** 5 a 500 caracteres. Sugestões de pergunta (disponível? prazo?
  troca? garantia?…), aviso na hora se tiver contato por fora, e "Já responderam
  algo parecido" com a resposta embaixo (evita pergunta repetida).
- **Limites:** até 3 perguntas aguardando resposta por anúncio, 20 por dia, 8 s
  entre uma e outra, e a mesma pergunta não se repete no mesmo anúncio.
- **Só aparece no anúncio depois de respondida**, com primeiro nome e inicial do
  sobrenome ("Henrique F."). Enquanto espera, só quem perguntou e a loja veem.
- **Minha conta > Perguntas aos vendedores** (`/my-questions`): todas as que a
  pessoa fez (Todas / Respondidas / Aguardando), há quanto tempo a loja foi
  avisada, a resposta, "Nova" até ver, apagar. Depois de 48 h sem resposta o
  cartão sugere conversar com a loja pelo chat.
- **Aviso** (no app e no push) quando a loja responde: abre `/my-questions`.
  Silenciar o push de "Mensagens" silencia também as perguntas.

## Para quem vende

- **Minha conta > Sua loja > Perguntas dos clientes** (`/my-questions?aba=loja`),
  com selo de quantas esperam resposta. Aviso "Nova pergunta no seu anúncio".
- **Painel:** esperando resposta, quantas passam de 24 h ("atrasada"), tempo
  médio de resposta, respondidas e taxa de resposta. Meta recomendada: 1 hora.
- **Fila:** "Sem resposta" (a mais antiga primeiro), "Respondidas" e "Todas",
  com busca por pergunta, produto ou cliente.
- **Responder:** resposta pública de 2 a 1000 caracteres, **respostas rápidas**
  (4 sugeridas pela Vineon + até 10 da própria loja, salvas na conta), editar,
  **retirar a resposta** (a pergunta volta para a fila), **excluir** pergunta
  repetida ou sem sentido e **denunciar** pergunta ofensiva.
- A loja não pergunta no próprio anúncio; na página do produto ela vê quantas
  esperam e um atalho para a fila.
- Na página do produto aparece "A loja costuma responder em X" (mediana do tempo
  de resposta), a partir de 3 respostas.

## Contato por fora

Perguntas **e** respostas passam por um filtro que barra e-mail, telefone com
DDD, link/endereço de site, WhatsApp/Instagram/Telegram/@perfil e combinações do
tipo "pix direto" e "por fora". O texto não é enviado e a pessoa vê o motivo.
O filtro erra para o lado de deixar passar (número de modelo, medida, CEP e
"128 GB" são perguntas normais). Duas cópias do detector: `core/question-rules.ts`
(aviso antes de enviar) e `functions/src/questions.ts` (quem decide).

## Moderação

- A pergunta pode ser **denunciada** (pela loja, qualquer uma; por qualquer
  pessoa, só as respondidas, que são públicas). Cai na aba **Denúncias** do
  admin, filtro "Perguntas", com o texto da pergunta e da resposta. Ações:
  descartar, **remover pergunta** (sem volta) ou suspender a conta de quem
  perguntou.
- Conta suspensa não pergunta nem responde.

## Dados e segurança

| O quê | Onde | Quem escreve |
| --- | --- | --- |
| Pergunta e resposta | `productQuestions/{id}` | só as functions |
| `askerUnread` (resposta ainda não vista) | mesmo documento | function liga; a própria pessoa desliga |
| Respostas rápidas | `sellerQuickReplies/{uid}` | a própria loja (até 10) |
| Apagar por moderação | `productQuestions/{id}` | admin |

Campos: `productId`, `productName`, `productPhoto`, `sellerId` (copiados do
anúncio pela function), `userId`, `userName`, `text`, `status`
(`open`/`answered`), `answer {text, createdAt, updatedAt}`, `askerUnread`,
`createdAt`, `updatedAt`, `answeredAt`, `responseMs`.

Functions HTTP (todas com token do Firebase):

- `askProductQuestion {productId, text}` — valida, barra contato por fora,
  confere conta suspensa, anúncio no ar e que quem pergunta não é a loja,
  aplica os limites, grava e avisa a loja.
- `answerProductQuestion {questionId, text}` — só a loja dona; a primeira
  resposta grava o tempo de resposta e avisa quem perguntou; editar não avisa.
- `deleteProductQuestion {questionId, scope: 'question'|'answer'}` — quem
  perguntou ou a loja apaga a pergunta; só a loja retira a resposta.
- `onProductDeletedQuestions` (gatilho) — anúncio apagado leva as perguntas dele.
  Se o anúncio existir de novo (gatilho atrasado, mesmo id), não apaga.

**Leitura:** pergunta respondida é pública; a aberta só o autor, a loja e o
admin. A consulta pública precisa trazer `status == 'answered'` (a regra exige).
Todas as consultas são de igualdade (sem índice composto) e ordenam no app. O
único índice composto é `productQuestions (userId, createdAt desc)`, usado pela
function para os limites.

**Excluir conta:** apaga as perguntas que a pessoa fez, as feitas nos anúncios
dela e as respostas rápidas. A exportação de dados (LGPD) inclui as perguntas.

## Testes

```bash
npm run emulators
node functions/scripts/questions.test.mjs
```

68 verificações: 28 de regras (visitante, autor, loja, outra loja, admin, tentar
criar/editar/apagar direto, denúncias) e 40 das functions (filtro de contato com
casos legítimos, limites, resposta, edição, retirada, exclusão, conta suspensa,
anúncio apagado, exclusão de conta). O seed traz perguntas respondidas, abertas, uma atrasada
(>24 h) e uma resposta ainda não vista.

## Publicação

Regras e índice (`firestore:rules,firestore:indexes`) primeiro; esperar o índice
"Pronto". Depois as functions pelo nome, em lote: `askProductQuestion`,
`answerProductQuestion`, `deleteProductQuestion`, `onProductDeletedQuestions`, `deleteMyAccount`. Site por
push em `main` (App Hosting), depois das functions. Cota de CPU do Cloud Run:
nunca `deploy --only functions` inteiro.

## Ficou de fora (próximos passos possíveis)

- Lembrete para a loja de pergunta parada há mais de 24 h (função agendada).
- Tempo de resposta público no perfil da loja e nos cards (hoje só na página do
  produto, calculado das respostas daquele anúncio).
- Bloquear comprador de perguntar (a loja denuncia ou exclui; o admin suspende).
- Voto "útil" nas respostas e pergunta por e-mail.
