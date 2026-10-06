# Central de ajuda (`/help`)

Tela aberta (sem login) com perguntas e respostas para quem compra e para quem vende,
busca, atalhos e contato. Linkada em Minha conta › Ajuda, no Menu do celular e no rodapé
do site.

## Onde está o texto

Tudo em `src/app/core/help-content.ts`: **11 assuntos, ~65 perguntas**. Cada pergunta é um
objeto `{ id, q, a: [blocos], links?, keys?, popular? }`.

- Blocos: `p` (parágrafo), `ul`, `ol`, `note` (`alert: true` deixa a nota azul-noite).
- `**negrito**` é o único recurso inline.
- `links`: botões no fim da resposta — `{ label, route, query? }` para uma tela do app ou
  `{ label, article: '<id>' }` para outra pergunta da Central.
- `keys`: palavras que a pessoa digita e que não estão no texto ("paguei", "comissão").
  A busca ignora acento e casa o começo de palavras longas ("devolver" acha "devolução").
- `popular: true` põe a pergunta nos atalhos "Mais procurados" da abertura (só
  perguntas de assuntos de comprar ou de vender, não dos compartilhados).
- Cada assunto tem `profile`: `buy`, `sell` ou `both` (aparece nas duas visões).

O texto segue `/terms` e `/privacy`. **Mudou uma regra lá, mude aqui** (prazo de devolução,
retenção de 7 dias, 2 dias úteis para postar, taxa sobre produtos sem frete…).

## Quando boleto e cartão forem ligados

No checkout de hoje só o **Pix** está ativo (boleto e cartão aparecem como "Disponível em
breve"). A constante `PAGAMENTO` no topo de `help-content.ts` controla as respostas de
"formas de pagamento" e "como o dinheiro volta": vire `boleto`/`cartao` para `true` e elas
se ajustam. Revise também a pergunta de Pix (`pag-pix`) e a de vencimento (`pag-venceu`),
que hoje falam só do código Pix de 3 dias.

## URL

| Parâmetro | Efeito |
| --- | --- |
| `?perfil=vender` | visão de quem vende (sem o parâmetro: quem compra) |
| `?assunto=<id>` | abre um assunto (`pagamento`, `entrega`, `devolucao`, `repasse`…) |
| `?pergunta=<id>` | abre a pergunta e rola até ela (o assunto vem junto) |

A busca não vai para a URL. Perguntas e assuntos inexistentes caem na tela inicial.

## Contato

O cartão "Ainda precisa de ajuda?" usa `COMPANY.supportEmail` (`core/legal-info.ts`) —
hoje o e-mail provisório. Trocando lá, a Central, os Termos e o rodapé mudam juntos.
O corpo do e-mail já vem com "Número do pedido / O que aconteceu".

## Arquivos

- `pages/help/help.page.{ts,html,scss}` — a tela. Rota `help` em `app-routing.module.ts`, sem guard.
- `core/help-content.ts` — conteúdo e busca (`searchHelp`).
- `theme/_vn-legal.scss` — os mixins `btn`, `note` e `foot` foram separados de `page` para a
  Central usar só o que precisa (Termos e Privacidade compilam o mesmo CSS de antes).
