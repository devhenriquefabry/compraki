import type { VnIconName } from './vn-icons';

/**
 * Conteúdo da Central de ajuda (`/help`).
 *
 * Cada resposta descreve o que o app faz de verdade e segue os textos de
 * `/terms` e `/privacy` — se uma regra mudar lá, mude aqui também. Nada de
 * prazo ou número inventado: o que não tem prazo fixo diz isso.
 *
 * Texto: `**negrito**` é o único recurso inline. Links vão em `links`.
 */

/**
 * Formas de pagamento liberadas no checkout. Hoje só o Pix; quando o boleto
 * (Cora) e o cartão (Asaas) forem ligados, vire a chave aqui e as respostas
 * de pagamento e reembolso se ajustam sozinhas.
 */
export const PAGAMENTO = { pix: true, boleto: false, cartao: false } as const;

export type HelpProfile = 'buy' | 'sell';

export type HelpBlock =
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'note'; text: string; alert?: boolean };

/** Botão no fim da resposta: ou uma rota do app, ou outra pergunta da Central. */
export interface HelpLink {
  label: string;
  route?: string;
  query?: Record<string, string>;
  /** Id de outra pergunta da Central. */
  article?: string;
}

export interface HelpArticle {
  id: string;
  q: string;
  a: HelpBlock[];
  links?: HelpLink[];
  /** Palavras que a pessoa digita e que não estão no texto ("paguei", "calote"…). */
  keys?: string;
  /** Aparece como atalho na abertura da Central. */
  popular?: boolean;
}

export interface HelpTopic {
  id: string;
  /** Quem enxerga o assunto; `both` aparece nas duas visões. */
  profile: HelpProfile | 'both';
  title: string;
  hint: string;
  icon: VnIconName;
  articles: HelpArticle[];
}

function lista(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

const metodosAtivos = ['Pix', ...(PAGAMENTO.boleto ? ['boleto'] : []), ...(PAGAMENTO.cartao ? ['cartão de crédito'] : [])];
const metodosEmBreve = [...(PAGAMENTO.boleto ? [] : ['boleto']), ...(PAGAMENTO.cartao ? [] : ['cartão de crédito'])];

const textoFormasDePagamento =
  `Hoje você paga com **${lista(metodosAtivos)}**.` +
  (metodosEmBreve.length
    ? ` ${lista(metodosEmBreve).replace(/^./, c => c.toUpperCase())} ${metodosEmBreve.length === 1 ? 'aparece' : 'aparecem'} no pagamento como "Disponível em breve".`
    : '');

export const HELP_TOPICS: HelpTopic[] = [
  // =========================================================== COMPRAR
  {
    id: 'comprar',
    profile: 'buy',
    title: 'Comprar na Vineon',
    hint: 'Conta, carrinho, frete e preços',
    icon: 'bag',
    articles: [
      {
        id: 'comprar-conta',
        q: 'Preciso ter conta para comprar?',
        keys: 'cadastro cadastrar entrar login visitante',
        a: [
          {
            t: 'p',
            text: 'Para olhar os produtos, não: você navega pela vitrine do site sem entrar. Para **comprar, salvar favoritos ou falar com uma loja**, precisa entrar ou criar uma conta. Leva poucos minutos e pode ser com e-mail e senha ou com o Google.',
          },
        ],
        links: [{ label: 'Criar conta', route: '/sign-in' }],
      },
      {
        id: 'comprar-passos',
        q: 'Como faço uma compra?',
        keys: 'comprar carrinho finalizar pedido checkout',
        a: [
          {
            t: 'ol',
            items: [
              'Abra o anúncio e toque em **Comprar agora**, ou em **Adicionar ao carrinho** para levar vários produtos de uma vez.',
              'Confira o endereço de entrega e escolha a forma de envio. O frete é calculado para o seu CEP.',
              'Revise o resumo e pague. Produto, frete, prazo e total aparecem antes de você confirmar.',
              'Acompanhe tudo em **Minhas compras**: a etapa do pedido, o rastreio e a conversa com a loja.',
            ],
          },
        ],
        links: [{ label: 'Abrir minhas compras', route: '/my-orders' }],
      },
      {
        id: 'comprar-varias-lojas',
        q: 'Posso comprar de lojas diferentes no mesmo pedido?',
        keys: 'varios vendedores carrinho misturar',
        a: [
          {
            t: 'p',
            text: 'Pode. Cada loja envia a sua parte, então os produtos podem chegar em dias diferentes. A nota fiscal também é emitida por cada loja.',
          },
        ],
      },
      {
        id: 'comprar-frete-gratis',
        q: 'Como funciona o frete grátis?',
        keys: 'frete gratis entrega gratuita selo',
        a: [
          {
            t: 'p',
            text: 'Produtos com o selo **Frete grátis** não cobram o envio de você. Isso vale quando **todos** os produtos do pedido têm o selo.',
          },
          {
            t: 'p',
            text: 'Se o pedido misturar produtos com e sem o selo, o frete do pacote é cobrado normalmente — o valor aparece antes de você pagar. Na busca, dá para filtrar só os produtos com frete grátis.',
          },
        ],
      },
      {
        id: 'comprar-frete-calculo',
        q: 'Como o frete e o prazo são calculados?',
        keys: 'cep melhor envio transportadora correios valor do frete',
        a: [
          {
            t: 'p',
            text: 'O frete e o prazo da transportadora são calculados pelo **Melhor Envio** para o seu CEP. Você escolhe a forma de envio no pagamento e vê o valor antes de pagar.',
          },
          {
            t: 'p',
            text: 'A previsão de entrega soma esse prazo ao que a loja tem para postar (até 2 dias úteis depois da confirmação do pagamento).',
          },
        ],
      },
      {
        id: 'comprar-preco-errado',
        q: 'O preço do anúncio estava errado. E agora?',
        keys: 'erro de preco preco mudou desconto promocao',
        a: [
          { t: 'p', text: 'Vale o preço que aparece quando você finaliza o pedido.' },
          {
            t: 'p',
            text: 'Se o anúncio tiver um erro de preço evidente — um celular por R$ 1, por exemplo —, o pedido pode ser cancelado e você recebe de volta tudo o que pagou. O preço riscado só aparece quando existe desconto de verdade sobre o preço anterior.',
          },
        ],
      },
      {
        id: 'comprar-loja-confiavel',
        q: 'Como sei se posso confiar em uma loja?',
        keys: 'confiavel seguro reputacao avaliacao vendedor golpe',
        a: [
          {
            t: 'ul',
            items: [
              'Leia as avaliações: só quem **comprou e pagou** pode avaliar, então são de compra de verdade.',
              'Abra a página da loja a partir do anúncio e veja os outros produtos dela.',
              'Desconfie de preço muito abaixo do normal, fotos genéricas e de quem pede para conversar ou pagar fora da Vineon.',
              'Algo estranho? Denuncie o anúncio ou a loja.',
            ],
          },
        ],
        links: [{ label: 'Como denunciar', article: 'seg-denunciar' }],
      },
      {
        id: 'comprar-falar-loja',
        q: 'Como falo com a loja antes ou depois de comprar?',
        keys: 'chat mensagem conversa perguntar duvida vendedor',
        a: [
          {
            t: 'p',
            text: 'No anúncio ou no pedido, toque em **Falar com a loja**. As conversas ficam em **Mensagens**. Use o chat para tirar dúvidas e combinar detalhes do pedido.',
          },
          {
            t: 'note',
            text: 'Nunca combine pagamento ou contato por fora, e não envie dados sensíveis na conversa.',
            alert: true,
          },
        ],
        links: [{ label: 'Abrir mensagens', route: '/tabs/chats' }],
      },
      {
        id: 'comprar-avaliar',
        q: 'Como avalio um produto?',
        keys: 'avaliacao nota estrelas comentario review',
        a: [
          {
            t: 'p',
            text: 'Quando o pedido chega, o botão **Avaliar** aparece nele, em Minhas compras. Só quem comprou e pagou pode avaliar. A avaliação mostra seu primeiro nome e a inicial do sobrenome, e deve contar a sua experiência real — sem ofensas, dados pessoais ou propaganda.',
          },
        ],
        links: [{ label: 'Pedidos entregues', route: '/my-orders', query: { aba: 'done' } }],
      },
      {
        id: 'comprar-favoritos',
        q: 'Como salvo um produto para ver depois?',
        keys: 'favoritar salvar coracao lista de desejos',
        a: [
          {
            t: 'p',
            text: 'Toque no **coração** do anúncio. Os produtos salvos ficam em **Favoritos**, no menu. Precisa estar com a conta aberta.',
          },
        ],
        links: [{ label: 'Abrir favoritos', route: '/tabs/saved' }],
      },
    ],
  },

  // ========================================================== PAGAMENTO
  {
    id: 'pagamento',
    profile: 'buy',
    title: 'Pagamento',
    hint: 'Formas de pagar, Pix e pagamento protegido',
    icon: 'wallet',
    articles: [
      {
        id: 'pag-formas',
        q: 'Quais formas de pagamento a Vineon aceita?',
        keys: 'pix boleto cartao credito debito parcelar parcelamento parcelas',
        a: [
          {
            t: 'p',
            text: textoFormasDePagamento,
          },
          {
            t: 'p',
            text: 'Qualquer que seja a forma, o pagamento acontece dentro da Vineon, e é isso que mantém o dinheiro protegido até você receber.',
          },
        ],
      },
      {
        id: 'pag-pix',
        q: 'Como pago com Pix?',
        keys: 'qr code copia e cola chave pagar',
        popular: true,
        a: [
          {
            t: 'ol',
            items: [
              'No pagamento, escolha **Pix** e finalize o pedido.',
              'A Vineon mostra um **QR Code** e o código **copia e cola**. Escaneie com a câmera do app do seu banco ou copie o código e cole na área Pix.',
              'Pague. Assim que o pagamento cair, a tela avança sozinha. Se ela não avançar, toque em **Já paguei, verificar**.',
            ],
          },
          { t: 'note', text: 'O código do Pix vale por **3 dias**.' },
        ],
      },
      {
        id: 'pag-pendente',
        q: 'Paguei, mas o pedido continua "Aguardando pagamento"',
        keys: 'paguei pagamento nao confirmou pendente comprovante nao caiu',
        a: [
          {
            t: 'p',
            text: 'O Pix costuma ser confirmado em instantes. Toque em **Já paguei, verificar** na tela do pagamento, ou abra Minhas compras, aba **A pagar**, e confira de novo.',
          },
          {
            t: 'p',
            text: 'Passaram alguns minutos e nada mudou? Escreva para a Vineon com o **comprovante** e o **número do pedido** — a equipe confere o pagamento.',
          },
        ],
        links: [{ label: 'Pedidos a pagar', route: '/my-orders', query: { aba: 'pay' } }],
      },
      {
        id: 'pag-venceu',
        q: 'Meu código de pagamento venceu. Perdi o pedido?',
        keys: 'expirou vencimento vencido prazo para pagar',
        a: [
          {
            t: 'p',
            text: 'O código vale por **3 dias**. Sem pagamento nesse prazo, o pedido não segue e **nada é cobrado**. É só fazer a compra de novo pelo anúncio.',
          },
        ],
      },
      {
        id: 'pag-protegido',
        q: 'O que é o pagamento protegido?',
        keys: 'retido reter dinheiro garantia escrow seguranca',
        a: [
          {
            t: 'p',
            text: 'O valor que você paga não vai direto para a loja. A Vineon o mantém **retido até 7 dias depois da entrega** — o prazo que você tem para desistir da compra.',
          },
          {
            t: 'p',
            text: 'Se houver devolução aprovada ou o pedido não for entregue, o dinheiro volta para você. Sem pendências, o valor é liberado à loja.',
          },
          {
            t: 'note',
            text: 'A proteção só existe para pagamentos feitos dentro da Vineon.',
          },
        ],
      },
      {
        id: 'pag-por-fora',
        q: 'A loja pediu para eu pagar por fora. Posso?',
        keys: 'pix direto deposito transferencia whatsapp fora da plataforma desconto golpe',
        a: [
          {
            t: 'p',
            text: '**Não.** Pagando por fora, você perde a proteção: a Vineon não consegue segurar o dinheiro nem devolvê-lo se algo der errado. Pedir Pix, depósito ou pagamento "por fora" é a forma mais comum de golpe.',
          },
          {
            t: 'p',
            text: 'Não pague, não passe seus dados e **denuncie** o anúncio ou a loja.',
          },
        ],
        links: [{ label: 'Como denunciar', article: 'seg-denunciar' }],
      },
      {
        id: 'pag-nota-fiscal',
        q: 'Como consigo a nota fiscal da compra?',
        keys: 'nf nfe danfe declaracao de conteudo comprovante fiscal',
        a: [
          {
            t: 'p',
            text: 'A nota fiscal — ou a declaração de conteúdo, quando a loja é dispensada de nota — é emitida pela **loja** e fica disponível no pedido, em Minhas compras. Não encontrou? Peça pelo chat com a loja.',
          },
        ],
        links: [{ label: 'Abrir minhas compras', route: '/my-orders' }],
      },
    ],
  },

  // ========================================================== ENTREGA
  {
    id: 'entrega',
    profile: 'buy',
    title: 'Entrega e rastreio',
    hint: 'Etapas do pedido, prazos e endereço',
    icon: 'truck',
    articles: [
      {
        id: 'ent-acompanhar',
        q: 'Como acompanho e rastreio meu pedido?',
        keys: 'rastrear rastreio rastreamento onde esta meu pedido status etapa',
        popular: true,
        a: [
          {
            t: 'p',
            text: 'Abra **Minhas compras**. Cada pedido mostra em que etapa está:',
          },
          {
            t: 'ul',
            items: [
              '**Aguardando pagamento** — falta pagar.',
              '**Preparando** — pagamento confirmado; a loja separa e posta o produto.',
              '**A caminho** — já foi postado. Toque em **Rastrear pedido** para ver o andamento.',
              '**Entregue** — o pedido chegou.',
            ],
          },
        ],
        links: [
          { label: 'Pedidos a caminho', route: '/my-orders', query: { aba: 'shipping' } },
          { label: 'Todas as compras', route: '/my-orders' },
        ],
      },
      {
        id: 'ent-prazo',
        q: 'Quando meu pedido chega?',
        keys: 'prazo de entrega previsao quanto tempo demora',
        a: [
          {
            t: 'p',
            text: 'A previsão aparece no pagamento e no pedido. Ela soma dois prazos: o da loja para postar (até **2 dias úteis** depois da confirmação do pagamento) e o da transportadora, calculado para o seu CEP.',
          },
          { t: 'p', text: 'Comprou de mais de uma loja? Cada uma envia a sua parte, por isso os prazos podem ser diferentes.' },
        ],
      },
      {
        id: 'ent-sem-rastreio',
        q: 'O código de rastreio não aparece',
        keys: 'sem codigo de rastreio nao postou nao enviou rastreio vazio',
        a: [
          {
            t: 'p',
            text: 'O código aparece no pedido quando a loja informa a postagem. A loja tem até **2 dias úteis** depois do pagamento para postar.',
          },
          {
            t: 'p',
            text: 'Passou desse prazo? Toque em **Falar com a loja** no pedido e cobre o envio. Sem resposta, escreva para a Vineon com o número do pedido.',
          },
        ],
      },
      {
        id: 'ent-atraso',
        q: 'Meu pedido não chegou',
        keys: 'atrasou atraso extraviado perdido constou entregue mas nao recebi nao recebi demora',
        popular: true,
        a: [
          {
            t: 'ol',
            items: [
              'Veja o rastreio: às vezes a transportadora só atrasou.',
              'O rastreio não anda, ou consta entregue sem você ter recebido? Toque em **Falar com a loja** e explique.',
              'A loja não resolveu? Escreva para a Vineon com o número do pedido.',
            ],
          },
          {
            t: 'p',
            text: 'Se o pedido se perder, for extraviado ou a loja não enviar, você recebe **todo o valor de volta**. Antes mesmo de o pedido chegar, o botão **Problema com o pedido? Solicitar devolução** já está liberado no pedido.',
          },
        ],
        links: [{ label: 'Como pedir devolução', article: 'dev-como' }],
      },
      {
        id: 'ent-endereco',
        q: 'Errei o endereço. Dá para mudar?',
        keys: 'trocar endereco corrigir endereco cep errado',
        a: [
          {
            t: 'ul',
            items: [
              '**Antes de pagar:** ajuste o endereço no pagamento, ou em Minha conta › Endereços.',
              '**Depois de pago:** fale logo com a loja pelo chat do pedido. Se ela ainda não postou, pode corrigir.',
              '**Depois de postado:** o endereço não muda. Peça ajuda à Vineon.',
            ],
          },
        ],
        links: [{ label: 'Meus endereços', route: '/address' }],
      },
      {
        id: 'ent-recebi',
        q: 'Meu pedido chegou. E agora?',
        keys: 'recebi confirmar recebimento chegou',
        a: [
          {
            t: 'p',
            text: 'Confira o produto. Estando tudo certo, toque em **Recebi o pedido** e, se quiser, avalie a compra.',
          },
          {
            t: 'p',
            text: 'Viu algum problema? Não precisa esperar: os **7 dias** para desistir da compra contam a partir da entrega.',
          },
        ],
        links: [{ label: 'Como desistir da compra', article: 'dev-desistir' }],
      },
    ],
  },

  // ========================================================= DEVOLUÇÕES
  {
    id: 'devolucao',
    profile: 'buy',
    title: 'Trocas e devoluções',
    hint: 'Desistência, defeito e reembolso',
    icon: 'returns',
    articles: [
      {
        id: 'dev-desistir',
        q: 'Posso desistir da compra?',
        keys: 'arrependimento arrependi devolver desistencia cancelar depois de receber 7 dias',
        a: [
          {
            t: 'p',
            text: 'Pode. Pelo Código de Defesa do Consumidor (art. 49), compras pela internet podem ser desfeitas em até **7 dias corridos depois que você recebe o produto**, sem precisar dar motivo.',
          },
          {
            t: 'ul',
            items: [
              'Devolva com acessórios, manual e, se possível, a embalagem. Abrir para conferir é normal e não tira o seu direito.',
              'Você recebe de volta tudo o que pagou, inclusive o frete de ida.',
              'O envio de volta não custa nada para você: a Vineon passa as instruções e a etiqueta.',
            ],
          },
        ],
        links: [
          { label: 'Como pedir a devolução', article: 'dev-como' },
          { label: 'Política completa', route: '/terms', query: { aba: 'compras' } },
        ],
      },
      {
        id: 'dev-como',
        q: 'Como peço a devolução?',
        keys: 'devolver produto solicitar devolucao reembolso estorno troca quero devolver',
        popular: true,
        a: [
          {
            t: 'ol',
            items: [
              'Abra **Minhas compras** e entre no pedido.',
              'Toque em **Problema com o pedido? Solicitar devolução** e conte o que aconteceu. O botão fica disponível até o pedido chegar e por mais 7 dias depois da entrega.',
              'Acompanhe na aba **Devoluções**. Podemos pedir fotos do produto e da embalagem.',
              'Com a devolução aprovada, envie o produto pelas instruções que você receber e guarde o comprovante de postagem.',
              'Quando o produto chegar à loja, fazemos o estorno.',
            ],
          },
          {
            t: 'note',
            text: 'Defeito descoberto depois dos 7 dias? Ainda dá tempo: veja os prazos de 30 e 90 dias na pergunta sobre defeito e escreva para a Vineon com o número do pedido.',
          },
        ],
        links: [
          { label: 'Abrir minhas compras', route: '/my-orders' },
          { label: 'Prazos de defeito', article: 'dev-defeito' },
        ],
      },
      {
        id: 'dev-defeito',
        q: 'O produto veio com defeito ou diferente do anúncio',
        keys: 'quebrado danificado errado faltando peca nao funciona garantia 30 dias 90 dias',
        a: [
          {
            t: 'p',
            text: 'Chegou com defeito, quebrado, errado, faltando peça ou diferente do que o anúncio mostrava? Avise dentro destes prazos, contados do recebimento:',
          },
          {
            t: 'ul',
            items: [
              '**Produtos não duráveis** (cosméticos, alimentos, itens de consumo): 30 dias.',
              '**Produtos duráveis** (eletrônicos, roupas, calçados, móveis): 90 dias.',
              '**Defeito que só aparece com o uso:** os mesmos prazos, contados a partir de quando o defeito aparece.',
            ],
          },
          {
            t: 'p',
            text: 'Produto errado ou diferente do anúncio pode ser devolvido na hora, com reembolso integral. Nos demais casos, o vendedor tem até 30 dias para resolver; se não resolver, você escolhe entre **troca, dinheiro de volta ou desconto proporcional** (art. 18 do CDC). Tire fotos: elas aceleram a análise.',
          },
        ],
        links: [{ label: 'Pedir devolução', article: 'dev-como' }],
      },
      {
        id: 'dev-reembolso',
        q: 'Quando e como o dinheiro volta?',
        keys: 'estorno reembolso dinheiro de volta prazo para receber o dinheiro',
        a: [
          {
            t: 'p',
            text: 'O estorno acontece quando o produto chega à loja — ou logo depois da aprovação, quando não há o que devolver (pedido que não chegou, por exemplo). O valor devolvido é o total pago no pedido, ou na parte devolvida, **sem desconto de taxas**.',
          },
          {
            t: 'ul',
            items: [
              ...(PAGAMENTO.pix || PAGAMENTO.boleto ? ['**Pix' + (PAGAMENTO.boleto ? ' ou boleto' : '') + ':** devolução por Pix para uma conta em nome de quem fez a compra.'] : []),
              ...(PAGAMENTO.cartao ? ['**Cartão de crédito:** estorno no mesmo cartão. Pode aparecer na fatura atual ou na seguinte, conforme o banco emissor.'] : []),
            ],
          },
          { t: 'p', text: 'O tempo para o dinheiro aparecer na sua conta depende também do seu banco.' },
        ],
      },
      {
        id: 'dev-cancelar',
        q: 'Quero cancelar o pedido',
        keys: 'cancelamento cancelar compra desistir antes de enviar',
        a: [
          {
            t: 'ul',
            items: [
              '**Ainda não pagou:** não precisa fazer nada. Sem o pagamento em até 3 dias, o pedido não segue e nada é cobrado.',
              '**Pagou e a loja ainda não postou:** peça o cancelamento pelo chat da loja ou escreva para a Vineon. Você recebe tudo de volta.',
              '**Já foi postado:** o botão **Solicitar devolução** já está liberado no pedido.',
            ],
          },
        ],
        links: [{ label: 'Abrir minhas compras', route: '/my-orders' }],
      },
      {
        id: 'dev-recusada',
        q: 'Minha devolução foi recusada',
        keys: 'negada negaram recusaram indeferida discordo',
        a: [
          {
            t: 'p',
            text: 'O andamento fica na aba **Devoluções** de Minhas compras: em análise, aprovada, recusada ou estorno concluído.',
          },
          {
            t: 'p',
            text: 'Não concorda com a decisão? Escreva para a Vineon com o número do pedido e as fotos. A equipe analisa cada caso e explica a decisão.',
          },
        ],
        links: [{ label: 'Ver devoluções', route: '/my-orders', query: { aba: 'refund' } }],
      },
      {
        id: 'dev-nao-cabe',
        q: 'Quando não cabe devolução?',
        keys: 'nao aceita devolucao mau uso prazo vencido',
        a: [
          {
            t: 'ul',
            items: [
              'Pedido feito depois dos prazos legais (7 dias para desistência; 30 ou 90 dias para defeito).',
              'Dano causado por mau uso, acidente ou conserto feito por terceiros depois do recebimento.',
              'Desgaste natural de uso, quando o produto funcionou como anunciado.',
            ],
          },
          { t: 'p', text: 'Na dúvida, peça mesmo assim: a equipe analisa cada caso.' },
        ],
      },
      {
        id: 'dev-garantia',
        q: 'E a garantia do fabricante?',
        keys: 'assistencia tecnica garantia estendida fabricante',
        a: [
          {
            t: 'p',
            text: 'Produtos com garantia do fabricante (um eletrônico com 1 ano, por exemplo) têm essa garantia **somada** à garantia legal. Para acioná-la depois dos prazos da Vineon, siga as instruções do fabricante ou da nota fiscal. A loja pode ajudar pelo chat.',
          },
        ],
      },
    ],
  },

  // ============================================================== CONTA
  {
    id: 'conta',
    profile: 'both',
    title: 'Minha conta',
    hint: 'Cadastro, senha, endereços e avisos',
    icon: 'account',
    articles: [
      {
        id: 'conta-criar',
        q: 'Como crio minha conta?',
        keys: 'cadastro cadastrar registrar google email',
        a: [
          {
            t: 'p',
            text: 'Na tela de entrada, toque em **Criar conta** e informe seus dados — ou escolha **Continuar com Google**. A conta é para maiores de 18 anos.',
          },
          {
            t: 'p',
            text: 'Depois, confira Minha conta › Dados pessoais: nome, CPF e telefone verdadeiros são usados no pagamento, na nota fiscal e na entrega.',
          },
        ],
        links: [{ label: 'Criar conta', route: '/sign-in' }],
      },
      {
        id: 'conta-esqueci-senha',
        q: 'Esqueci minha senha',
        keys: 'recuperar senha redefinir senha nao consigo entrar codigo whatsapp',
        a: [
          {
            t: 'ol',
            items: [
              'Na tela de entrada, toque em **Esqueci minha senha**.',
              'Informe o e-mail da sua conta.',
              'Escolha receber o código de segurança por **WhatsApp** (no celular cadastrado) ou por **e-mail** — confira também o spam.',
              'Digite o código e crie a senha nova.',
            ],
          },
          {
            t: 'note',
            text: 'Entrou só com o Google? Sua conta não tem uma senha da Vineon: use **Continuar com Google**.',
          },
        ],
        links: [{ label: 'Recuperar senha', route: '/forgot-password' }],
      },
      {
        id: 'conta-trocar-senha',
        q: 'Como troco minha senha?',
        keys: 'mudar senha alterar senha',
        a: [
          { t: 'p', text: 'Com a conta aberta, vá em **Minha conta › Senha e segurança** e siga os passos.' },
        ],
        links: [{ label: 'Abrir Minha conta', route: '/tabs/my-account' }],
      },
      {
        id: 'conta-dados',
        q: 'Como altero meu nome, telefone ou CPF?',
        keys: 'editar perfil cadastro dados pessoais foto',
        a: [
          {
            t: 'p',
            text: 'Em **Minha conta › Dados pessoais** você edita nome, telefone, CPF e a foto do perfil.',
          },
        ],
        links: [{ label: 'Abrir Minha conta', route: '/tabs/my-account' }],
      },
      {
        id: 'conta-enderecos',
        q: 'Como cadastro ou troco o endereço de entrega?',
        keys: 'endereco casa trabalho cep cadastrar endereco',
        a: [
          {
            t: 'p',
            text: 'Em **Minha conta › Endereços** você cadastra os lugares onde quer receber. No pagamento, escolha o endereço de cada pedido.',
          },
        ],
        links: [{ label: 'Meus endereços', route: '/address' }],
      },
      {
        id: 'conta-avisos',
        q: 'Como recebo avisos sobre meus pedidos?',
        keys: 'notificacao notificacoes push alerta aviso instalar app tela de inicio iphone android',
        a: [
          {
            t: 'p',
            text: 'Os avisos de pedido, mensagens e avaliações ficam na tela de **Notificações**. Para receber **no celular, na hora**, instale a Vineon na tela inicial:',
          },
          {
            t: 'ul',
            items: [
              '**iPhone:** no Safari, toque em Compartilhar › **Adicionar à Tela de Início**.',
              '**Android:** no Chrome, toque no menu e em **Instalar app** (ou Adicionar à tela inicial).',
            ],
          },
          { t: 'p', text: 'Depois, abra a Vineon pelo ícone novo e ative os avisos quando a Vineon convidar.' },
        ],
        links: [{ label: 'Abrir notificações', route: '/tabs/notifications' }],
      },
      {
        id: 'conta-meus-dados',
        q: 'O que a Vineon guarda sobre mim? Posso baixar meus dados?',
        keys: 'lgpd privacidade dados pessoais baixar exportar',
        a: [
          {
            t: 'p',
            text: 'Pode. Em **Privacidade e dados** você vê o que a Vineon guarda sobre você e baixa uma cópia em **Baixar meus dados**. Lá também está a Política de Privacidade completa, com o contato do encarregado de dados.',
          },
        ],
        links: [{ label: 'Privacidade e dados', route: '/privacy' }],
      },
      {
        id: 'conta-excluir',
        q: 'Como excluo minha conta?',
        keys: 'encerrar conta apagar conta deletar cancelar cadastro',
        a: [
          {
            t: 'p',
            text: 'Em **Minha conta › Dados pessoais**, no fim da tela, toque em **Excluir conta**. O app mostra o que será apagado e o que fica guardado por lei, e pede sua senha (ou o Google) para confirmar. Compras e vendas em andamento precisam ser concluídas antes.',
          },
          {
            t: 'p',
            text: 'Depois do encerramento, os dados são apagados ou anonimizados — exceto o que a lei manda guardar, como explica a Política de Privacidade.',
          },
        ],
        links: [{ label: 'Excluir conta', route: '/account/delete' }, { label: 'Política de Privacidade', route: '/privacy' }],
      },
    ],
  },

  // ========================================================= SEGURANÇA
  {
    id: 'seguranca',
    profile: 'both',
    title: 'Segurança e denúncias',
    hint: 'Golpes, denúncias e proteção da conta',
    icon: 'shield',
    articles: [
      {
        id: 'seg-golpes',
        q: 'Como evito golpes?',
        keys: 'golpe fraude seguranca fraudador estelionato cuidado phishing',
        a: [
          {
            t: 'ul',
            items: [
              'Pague **sempre dentro da Vineon**. É isso que mantém o dinheiro protegido.',
              'Desconfie de quem pede Pix direto, depósito, ou chama para conversar e pagar em outro aplicativo.',
              'Preço muito abaixo do mercado, fotos genéricas e pressa para fechar são sinais de alerta.',
              'Nunca compartilhe sua senha nem o código de segurança que chega por WhatsApp ou e-mail.',
              'Em dúvida, não pague: denuncie.',
            ],
          },
        ],
        links: [{ label: 'Como denunciar', article: 'seg-denunciar' }],
      },
      {
        id: 'seg-denunciar',
        q: 'Como denuncio um anúncio, uma loja ou uma conversa?',
        keys: 'denuncia reportar abuso anuncio falso perfil falso ofensa',
        a: [
          {
            t: 'ul',
            items: [
              '**Anúncio ou vendedor:** na página do produto, toque em **Denunciar anúncio** ou **Denunciar vendedor**.',
              '**Loja:** na página da loja, toque em **Denunciar loja**.',
              '**Conversa:** no menu da conversa, escolha **Denunciar**.',
            ],
          },
          {
            t: 'p',
            text: 'É preciso estar com a conta aberta: a denúncia tem autor. A equipe da Vineon analisa cada uma e, conforme a gravidade, tira o anúncio do ar, bloqueia o chat ou suspende a conta.',
          },
        ],
      },
      {
        id: 'seg-conta-invadida',
        q: 'Acho que alguém entrou na minha conta',
        keys: 'invadiram hackearam acesso indevido conta roubada senha vazada',
        a: [
          {
            t: 'ol',
            items: [
              'Troque a senha agora, em **Minha conta › Senha e segurança**.',
              'Confira seus pedidos e mensagens por algo que você não reconheça.',
              'Escreva para a Vineon contando o que viu.',
            ],
          },
        ],
        links: [{ label: 'Abrir Minha conta', route: '/tabs/my-account' }],
      },
      {
        id: 'seg-dados-loja',
        q: 'Que dados meus a loja recebe?',
        keys: 'cpf endereco telefone vendedor ve meus dados privacidade da compra',
        a: [
          {
            t: 'p',
            text: 'A loja recebe o necessário para entregar o pedido e emitir a nota: nome, CPF, telefone, e-mail e endereço. Pela LGPD, ela só pode usar esses dados para isso — nunca para propaganda nem para repassar a terceiros.',
          },
          { t: 'p', text: 'Recebeu mensagem ou propaganda de uma loja que usou seus dados fora do pedido? Denuncie.' },
        ],
        links: [{ label: 'Política de Privacidade', route: '/privacy' }],
      },
    ],
  },

  // ============================================================ VENDER
  {
    id: 'comecar',
    profile: 'sell',
    title: 'Começar a vender',
    hint: 'Quem pode, catálogo e primeiro anúncio',
    icon: 'store',
    articles: [
      {
        id: 'v-quem',
        q: 'Quem pode vender na Vineon?',
        keys: 'cnpj cpf requisitos como vender abrir loja cadastro de vendedor mei',
        a: [
          {
            t: 'p',
            text: 'Qualquer conta da Vineon pode anunciar, desde que o titular seja **maior de 18 anos** e tenha os dados de cadastro completos e verdadeiros (nome, CPF, telefone e endereço).',
          },
          {
            t: 'p',
            text: 'Quem vende com frequência ou como empresa é responsável pelas próprias obrigações fiscais, inclusive emitir **nota fiscal** das vendas.',
          },
        ],
      },
      {
        id: 'v-primeiro',
        q: 'Como anuncio meu primeiro produto?',
        keys: 'anunciar cadastrar produto publicar anuncio vender criar anuncio',
        popular: true,
        a: [
          {
            t: 'ol',
            items: [
              'Toque em **Anunciar produto** (em Minha conta ou no menu).',
              'Procure o produto no **Catálogo Vineon**. Achou a ficha? Use-a: título, categoria e ficha técnica já vêm prontos. Não achou, ou vende um item usado? Escolha **Criar do zero**.',
              'Em **Conferir ficha**, veja se ela corresponde exatamente ao que você vende.',
              'Em **Preço e estoque**, informe o valor, a quantidade e as fotos — com galeria por cor, se houver variações.',
              'Publique. O anúncio entra na vitrine.',
            ],
          },
        ],
        links: [{ label: 'Anunciar produto', route: '/upload-product' }],
      },
      {
        id: 'v-catalogo',
        q: 'O que é o Catálogo Vineon?',
        keys: 'ficha tecnica ficha pronta catalogo gtin ean',
        a: [
          {
            t: 'p',
            text: 'É uma biblioteca de **fichas prontas** de produtos. Em vez de escrever tudo do zero, você escolhe a ficha, confere e informa só o que é seu: preço, estoque e fotos.',
          },
          {
            t: 'p',
            text: 'O anúncio guarda uma **cópia** da ficha. Se a Vineon atualizar a ficha depois, o seu anúncio já publicado não muda. Título e categoria ficam travados para o produto continuar igual à ficha.',
          },
        ],
      },
      {
        id: 'v-loja',
        q: 'Como personalizo a página da minha loja?',
        keys: 'vitrine perfil de vendedor nome da loja logo descricao foto',
        a: [
          {
            t: 'p',
            text: 'Em **Minha conta › Perfil de vendedor** você define o nome da loja, a foto e a descrição. A vitrine com todos os seus anúncios é a página que o cliente vê ao abrir a sua loja.',
          },
        ],
        links: [
          { label: 'Perfil de vendedor', route: '/seller-profile' },
          { label: 'Minha vitrine', route: '/my-showcase' },
        ],
      },
    ],
  },
  {
    id: 'anuncios',
    profile: 'sell',
    title: 'Meus anúncios',
    hint: 'Editar, fotos, preço e variações',
    icon: 'tag',
    articles: [
      {
        id: 'a-editar',
        q: 'Como edito ou excluo um anúncio?',
        keys: 'editar produto alterar preco estoque excluir apagar remover anuncio',
        a: [
          {
            t: 'p',
            text: 'Vá em **Minha conta › Meus anúncios**. O **lápis** abre a edição de preço, estoque, fotos e variações; a **lixeira** exclui o anúncio.',
          },
          {
            t: 'p',
            text: 'Em anúncios criados a partir do Catálogo Vineon, o título e a categoria ficam travados.',
          },
        ],
        links: [{ label: 'Meus anúncios', route: '/my-products' }],
      },
      {
        id: 'a-fotos',
        q: 'Como mostro fotos diferentes para cada cor?',
        keys: 'galeria variacoes cor tamanho fotos varias fotos',
        a: [
          {
            t: 'p',
            text: 'Se o produto tem variações — a cor, por exemplo —, cada opção pode ter a **própria galeria, com até 10 fotos**. Na página do produto, o cliente vê as fotos da cor que escolher.',
          },
          { t: 'p', text: 'Use fotos do próprio produto ou que você tenha direito de usar.' },
        ],
      },
      {
        id: 'a-preco',
        q: 'Como funcionam preço e desconto?',
        keys: 'preco promocao preco riscado oferta valor de',
        a: [
          {
            t: 'ul',
            items: [
              'O preço anunciado é o preço **final do produto**.',
              'O preço riscado só vale se o preço anterior era real. Desconto de mentira pode tirar o anúncio do ar.',
              'Erro de preço evidente pode levar ao cancelamento do pedido, com devolução integral ao comprador.',
              'Não coloque telefone, links ou contatos no anúncio para levar a venda para fora da Vineon.',
            ],
          },
        ],
      },
      {
        id: 'a-descricao',
        q: 'O que preciso informar no anúncio?',
        keys: 'descricao como descrever titulo categoria estoque novo usado',
        a: [
          {
            t: 'ul',
            items: [
              'Só anuncie o que você tem e pode enviar, e mantenha o estoque atualizado.',
              'Descreva o produto como ele é: novo ou usado, marca, modelo, tamanho, defeitos e o que vem na caixa.',
              'Escolha a categoria certa.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'vendas',
    profile: 'sell',
    title: 'Vendas e envio',
    hint: 'Pedidos, etiqueta, rastreio e nota',
    icon: 'box',
    articles: [
      {
        id: 's-nova-venda',
        q: 'Como sei que fiz uma venda?',
        keys: 'aviso venda nova pedido novo notificacao vendi',
        a: [
          {
            t: 'p',
            text: 'Você recebe um aviso de venda nova na tela de Notificações — e no celular, se a Vineon estiver instalada na tela inicial. Os detalhes ficam em **Minhas vendas**.',
          },
          {
            t: 'note',
            text: 'Só envie depois que o pedido aparecer como **pago**.',
            alert: true,
          },
        ],
        links: [{ label: 'Abrir minhas vendas', route: '/my-sales' }],
      },
      {
        id: 's-enviar',
        q: 'Como envio um pedido?',
        keys: 'etiqueta gerar etiqueta imprimir postar correios transportadora rastreio enviar',
        popular: true,
        a: [
          {
            t: 'ol',
            items: [
              'Abra a venda em **Minhas vendas** e confira os itens e o endereço.',
              'Toque em **Gerar etiqueta** e depois em **Imprimir etiqueta**.',
              'Embale bem e poste usando o serviço de frete escolhido no pedido, em até **2 dias úteis** depois do pagamento.',
              'Se o código de rastreio não aparecer sozinho, informe-o em **Adicionar rastreio**.',
              'Quando o rastreio mostrar a entrega, toque em **Marcar como entregue**.',
            ],
          },
        ],
        links: [{ label: 'Abrir minhas vendas', route: '/my-sales' }],
      },
      {
        id: 's-prazo',
        q: 'Qual é o prazo para postar? E se eu atrasar?',
        keys: 'prazo de postagem 2 dias uteis atraso nao enviei punicao advertencia',
        a: [
          {
            t: 'p',
            text: 'Você tem até **2 dias úteis** depois da confirmação do pagamento. É o prazo que o comprador vê na previsão de entrega.',
          },
          {
            t: 'p',
            text: 'Atrasos frequentes, pedidos não enviados e anúncios enganosos podem levar a advertência, retirada de anúncios, bloqueio do chat ou suspensão da conta. Pedido que a loja não envia faz o comprador receber todo o dinheiro de volta.',
          },
        ],
      },
      {
        id: 's-nota',
        q: 'Preciso emitir nota fiscal das vendas?',
        keys: 'nota fiscal nfe declaracao de conteudo anexar nf obrigacao fiscal',
        a: [
          {
            t: 'p',
            text: 'Anexe a **nota fiscal** na tela da venda. Se você não emite nota, anexe a **declaração de conteúdo** dos Correios.',
          },
          {
            t: 'p',
            text: 'Quem vende com frequência ou como empresa é responsável pelas próprias obrigações fiscais.',
          },
        ],
      },
      {
        id: 's-devolucao',
        q: 'O comprador pediu devolução. O que acontece?',
        keys: 'devolucao do comprador reembolso cliente reclamou troca',
        a: [
          {
            t: 'p',
            text: 'Com a devolução aprovada, o valor da venda é **estornado ao comprador e não é repassado**; o produto volta para você. As reclamações são mediadas pela Vineon, que pode pedir informações e provas às duas partes.',
          },
          {
            t: 'p',
            text: 'A loja deve aceitar devoluções e trocas nos termos do Código de Defesa do Consumidor.',
          },
        ],
        links: [{ label: 'Regras para vender', route: '/terms', query: { aba: 'vendedores' } }],
      },
      {
        id: 's-chat',
        q: 'Como falo com o comprador?',
        keys: 'chat mensagem conversa cliente responder',
        a: [
          {
            t: 'p',
            text: 'Pelo chat do pedido, em **Mensagens**. Responda sempre que o comprador precisar. Não passe telefone nem peça pagamento ou contato por fora: isso é motivo de suspensão.',
          },
        ],
        links: [{ label: 'Abrir mensagens', route: '/tabs/chats' }],
      },
    ],
  },
  {
    id: 'repasse',
    profile: 'sell',
    title: 'Taxa e repasse',
    hint: 'Quanto fica, quando libera e nota mensal',
    icon: 'chart',
    articles: [
      {
        id: 'r-taxa',
        q: 'Qual é a taxa da Vineon?',
        keys: 'comissao tarifa percentual quanto cobra quanto custa vender porcentagem',
        popular: true,
        a: [
          {
            t: 'p',
            text: 'A Vineon cobra uma **taxa percentual sobre o valor dos produtos vendidos**. O frete não entra na conta.',
          },
          {
            t: 'ul',
            items: [
              'Vale a taxa em vigor na **data do pagamento** de cada venda.',
              'Mudanças são avisadas antes de valerem e nunca alteram vendas já pagas.',
              'Quer saber o percentual em vigor? Escreva para a Vineon.',
            ],
          },
        ],
      },
      {
        id: 'r-quando',
        q: 'Quando recebo o dinheiro das vendas?',
        keys: 'repasse liberacao pagamento do vendedor receber saque dinheiro retido quando cai',
        popular: true,
        a: [
          {
            t: 'p',
            text: 'O valor fica retido até **7 dias depois da entrega** — o prazo de desistência do comprador, pelo Código de Defesa do Consumidor.',
          },
          {
            t: 'p',
            text: 'Passado esse prazo e sem devolução pendente, a Vineon libera o valor dos produtos **menos a taxa**.',
          },
          {
            t: 'note',
            text: 'Marque a venda como **entregue** assim que o pedido chegar. É o que começa a contar o prazo.',
          },
        ],
      },
      {
        id: 'r-quanto',
        q: 'Como vejo quanto vendi?',
        keys: 'faturamento total vendido relatorio vendas do mes resumo',
        a: [
          {
            t: 'p',
            text: 'Em **Minha conta › Sua loja**, o cartão mostra o total vendido no mês (só pedidos pagos, sem o frete) e quantos pedidos estão em cada etapa: **A enviar, Enviadas e Entregues**. O detalhe de cada pedido fica em **Minhas vendas**.',
          },
        ],
        links: [{ label: 'Abrir minhas vendas', route: '/my-sales' }],
      },
      {
        id: 'r-nota-mensal',
        q: 'Que nota fiscal é essa que a Vineon emite?',
        keys: 'nf mensal nota da vineon nota da taxa notas fiscais email',
        a: [
          {
            t: 'p',
            text: 'Todo mês a Vineon emite a **nota fiscal da taxa** cobrada pelas suas vendas e envia por e-mail. Ela também fica em **Minha conta › Notas fiscais**, com o resumo do mês.',
          },
        ],
        links: [{ label: 'Notas fiscais', route: '/my-invoices' }],
      },
    ],
  },
  {
    id: 'regras',
    profile: 'sell',
    title: 'Regras e moderação',
    hint: 'Itens proibidos, denúncias e suspensão',
    icon: 'doc',
    articles: [
      {
        id: 'm-proibidos',
        q: 'Quais produtos não posso anunciar?',
        keys: 'proibido proibidos produtos proibidos falsificado replica arma medicamento remedio',
        a: [
          { t: 'p', text: 'Não podem ser anunciados na Vineon:' },
          {
            t: 'ul',
            items: [
              'Armas, munições e acessórios.',
              'Drogas e substâncias ilícitas.',
              'Medicamentos e produtos controlados.',
              'Animais silvestres.',
              'Falsificados, réplicas e piratas.',
              'Produtos roubados ou de origem ilegal.',
              'Documentos, contas e dados pessoais.',
              'Conteúdo ofensivo ou impróprio.',
              'Itens que exigem licença sem que você a tenha — e qualquer produto proibido por lei.',
            ],
          },
        ],
        links: [{ label: 'Regras para vender', route: '/terms', query: { aba: 'vendedores' } }],
      },
      {
        id: 'm-fora-do-ar',
        q: 'Meu anúncio aparece como "Fora do ar"',
        keys: 'anuncio bloqueado removido barrado moderacao filtro termo proibido revisao',
        a: [
          {
            t: 'p',
            text: 'Um anúncio sai do ar quando viola as regras: o título tem um termo proibido (a Vineon tem um filtro automático), houve denúncia procedente ou a equipe identificou irregularidade. Em **Meus anúncios**, a etiqueta mostra o motivo.',
          },
          {
            t: 'p',
            text: 'Acha que foi engano? Peça revisão pelo e-mail da Vineon, com o nome do anúncio. Uma pessoa da equipe analisa.',
          },
        ],
        links: [{ label: 'Meus anúncios', route: '/my-products' }],
      },
      {
        id: 'm-denunciado',
        q: 'Fui denunciado. O que acontece?',
        keys: 'conta suspensa suspensao bloqueio de conta denuncia contra mim banido',
        a: [
          {
            t: 'p',
            text: 'A equipe analisa cada denúncia. Conforme a gravidade, a Vineon pode tirar um anúncio do ar, bloquear o uso do chat ou **suspender a conta** — o acesso é bloqueado e todos os anúncios saem do ar.',
          },
          {
            t: 'p',
            text: 'Pedidos já pagos continuam sendo acompanhados para que nenhum comprador fique sem o produto ou sem o dinheiro. Discorda de uma medida? Peça revisão pelo e-mail da Vineon.',
          },
        ],
      },
      {
        id: 'm-dados-comprador',
        q: 'Posso usar os dados do comprador para outra coisa?',
        keys: 'lgpd dados do cliente propaganda marketing contato do comprador',
        a: [
          {
            t: 'p',
            text: 'Não. Você recebe nome, CPF, telefone, e-mail e endereço **só para enviar, emitir a nota e atender aquele pedido**. É proibido usá-los para propaganda, repassá-los a terceiros ou guardá-los além do necessário.',
          },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export interface HelpHit {
  topic: HelpTopic;
  article: HelpArticle;
}

const ARTICLE_INDEX = new Map<string, HelpHit>();
for (const topic of HELP_TOPICS) {
  for (const article of topic.articles) ARTICLE_INDEX.set(article.id, { topic, article });
}

export function findArticle(id: string): HelpHit | undefined {
  return ARTICLE_INDEX.get(id);
}

export function findTopic(id: string | null): HelpTopic | undefined {
  return id ? HELP_TOPICS.find(t => t.id === id) : undefined;
}

/** Assuntos de uma visão: os dela e os que valem para as duas. */
export function topicsFor(profile: HelpProfile): HelpTopic[] {
  return [
    ...HELP_TOPICS.filter(t => t.profile === profile),
    ...HELP_TOPICS.filter(t => t.profile === 'both'),
  ];
}

export function popularFor(profile: HelpProfile): HelpHit[] {
  return topicsFor(profile)
    .filter(t => t.profile === profile)
    .flatMap(topic => topic.articles.filter(a => a.popular).map(article => ({ topic, article })));
}

/** Minúsculas e sem acento: "devolução" casa com "devolucao". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function blockText(b: HelpBlock): string {
  return b.t === 'ul' || b.t === 'ol' ? b.items.join(' ') : b.text;
}

const SEARCH_INDEX = [...ARTICLE_INDEX.values()].map(hit => ({
  hit,
  question: normalize(hit.article.q),
  keys: normalize(`${hit.article.keys ?? ''} ${hit.topic.title}`),
  body: normalize(hit.article.a.map(blockText).join(' ')),
}));

/**
 * Busca: cada palavra digitada precisa aparecer na pergunta, nas palavras-chave
 * ou na resposta. Palavras longas valem pelo começo ("devolver" acha
 * "devolução"). Pergunta pesa mais que palavra-chave, que pesa mais que resposta.
 */
export function searchHelp(query: string, limit = 12): HelpHit[] {
  const words = normalize(query)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2);
  if (!words.length) return [];

  const scored: { hit: HelpHit; score: number }[] = [];
  for (const entry of SEARCH_INDEX) {
    let score = 0;
    let all = true;
    for (const word of words) {
      const stem = word.length > 5 ? word.slice(0, 5) : word;
      const inQ = entry.question.includes(stem);
      const inK = entry.keys.includes(stem);
      const inB = entry.body.includes(stem);
      if (!inQ && !inK && !inB) { all = false; break; }
      score += (inQ ? 6 : 0) + (inK ? 3 : 0) + (inB ? 1 : 0);
      // A palavra inteira, e não só o começo dela, desempata.
      if (word !== stem && (entry.question.includes(word) || entry.keys.includes(word))) score += 2;
    }
    if (all) scored.push({ hit: entry.hit, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.hit);
}

/** Quebra o `**negrito**` de um texto em trechos, para o template montar sem innerHTML. */
export interface HelpSegment {
  text: string;
  bold: boolean;
}

export function segments(text: string): HelpSegment[] {
  return text
    .split('**')
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter(s => s.text);
}
