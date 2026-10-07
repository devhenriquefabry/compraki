# Avaliações de produto

Como funciona o sistema de avaliações da Vineon (outubro de 2026). Referência
de mercado: Mercado Livre (opiniões só de quem recebeu, "é útil", fotos),
Amazon ("Avalie suas compras" com estrelas na lista, selo de compra
verificada) e Shopee/Magalu (resposta pública da loja).

## Para quem compra

- **Só avalia quem recebeu.** O pedido precisa estar pago e entregue (a loja
  marcou "entregue" ou o comprador tocou em "Recebi o pedido"). Antes disso a
  página do produto diz "a avaliação abre assim que ele for entregue".
- **Onde aparece o convite:**
  - aviso "Pedido entregue" (no app e no push) abre `/my-reviews?pedido=<id>`,
    com os produtos daquele pedido na frente e o selo "Acabou de chegar";
  - "Recebi o pedido" em Minhas compras mostra um aviso com o botão "Avaliar";
  - botão "Avaliar" nos pedidos entregues de Minhas compras;
  - linha "Minhas avaliações" em Minha conta, com o número de compras
    esperando opinião;
  - página do produto ("Você recebeu este produto. Conte como foi").
- **A avaliação:** nota de 1 a 5 (obrigatória), "o produto é como no
  anúncio?" (sim / em parte / não, opcional), comentário até 2.000
  caracteres e até 5 fotos (o app reduz para ~1600 px antes de subir).
- **Uma avaliação por produto por pessoa.** Dá para editar e excluir quando
  quiser em Minhas avaliações > Avaliadas. Editar não muda a data nem o pedido.
- Nome público: primeiro nome + inicial do sobrenome ("Henrique F.").

## Para quem vende

- Minha conta > Sua loja > **Avaliações da loja** (`/my-reviews?aba=loja`):
  nota geral da loja, distribuição, quantas estão sem resposta, % "igual ao
  anúncio" e filtros (sem resposta, 1 e 2 estrelas, com foto).
- **Resposta pública**, uma por avaliação, editável e removível. O comprador
  recebe aviso na primeira resposta. A loja não altera nem apaga avaliação.
- Aviso "Nova avaliação" leva direto para essa aba.

## Na página do produto

Nota média, barras por estrela (tocar filtra), "X% disseram que é igual ao
anúncio", faixa "Fotos dos compradores", filtro "Com foto", ordem "Mais
relevantes" (mais "útil" primeiro, depois as com foto/texto) / recentes /
melhor / pior nota. Em cada avaliação: selo Compra verificada, fotos
ampliáveis, resposta da loja, botão **Útil** e **Denunciar**.

## Moderação

- Denúncia de avaliação (ofensiva, não fala do produto, spam, expõe dados
  pessoais, parece falsa, outro) cai na aba **Denúncias** do admin, filtro
  "Avaliações". Ações: descartar, **remover avaliação** (sem volta; a pessoa
  pode avaliar de novo) ou suspender a conta de quem escreveu.

## Dados e segurança

| O quê | Onde | Quem escreve |
| --- | --- | --- |
| Avaliação | `products/{produto}/reviews/{uid}` | autor: nota, texto, fotos, "como no anúncio" |
| Selo, loja, nome/foto do produto | mesmo documento | só `onProductReviewWritten` |
| `helpfulCount` | mesmo documento | só `onReviewVotesWritten` |
| `sellerReply` | mesmo documento | só a loja dona do produto |
| Votos "útil" | `products/{produto}/reviewVotes/{uid}` (`reviewIds`) | a própria pessoa |
| Fotos | Storage `review-photos/{uid}/{produto}/` | a própria pessoa (≤ 5 MB, imagem) |
| Nota agregada | `products/{id}`: `rating`, `reviewCount`, `ratingBreakdown`, `reviewPhotoCount`, `listingMatch` | só a função |

`onProductReviewWritten` confere que o produto está no pedido citado (a regra
não consegue olhar `items`) e apaga a avaliação se não estiver; limpa caminhos
de foto que não sejam da pasta do autor; apaga do Storage as fotos que saíram
da avaliação; recalcula a nota só quando nota/fotos/"como no anúncio" mudam;
avisa o comprador da primeira resposta da loja.

"Minhas avaliações" e "Avaliações da loja" são consultas de grupo em
`reviews` por `userId` / `sellerId` (índices de campo único em
`firestore.indexes.json`; ordenação no app).

## Testes

```bash
npm run emulators
node functions/scripts/reviews.test.mjs
```

Roda o seed e testa 22 regras (inclusive as tentativas de burlar: avaliar sem
receber, inflar "útil", loja mexer na nota) e 8 comportamentos das functions.
No seed, a Marina (Ateliê) tem três compras entregues da Loja de Teste e
avaliou as três; o comprador avaliou duas e tem o resto em "Para avaliar".

## Publicação

Regras e índices (`firestore:rules,firestore:indexes,storage`) antes das
functions, e functions pelo nome: `onProductReviewWritten`,
`onReviewVotesWritten`, `onOrderWrittenNotify`, `onProductReviewNotify`,
`deleteMyAccount`. Site por push em `main` (App Hosting), depois das
functions — os dois juntos disputam a cota de CPU do Cloud Run.

## Ficou de fora (próximos passos possíveis)

- Lembrete automático alguns dias depois da entrega (precisa de função
  agendada + Cloud Scheduler).
- Nota da loja no perfil público do vendedor e nos cards de produto.
- Vídeo na avaliação.
