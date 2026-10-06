import type { SupportPriority } from '../interfaces/support';
import type { VnIconName } from './vn-icons';

/**
 * Assuntos do "Fale com a Vineon". A lista de ids e a prioridade espelham
 * `functions/src/support.ts` (TOPICS): mudou aqui, mude lá.
 *
 * `helpTopicId` liga o assunto a um assunto da Central de ajuda (`/help`): é o
 * "isso resolve?" antes de abrir o atendimento. A prioridade alta é a de quem
 * tem dinheiro, entrega, segurança ou direito em jogo.
 */
export interface SupportTopic {
  id: string;
  /** Em qual aba aparece; `both` nas duas. */
  profile: 'buy' | 'sell' | 'both';
  label: string;
  hint: string;
  icon: VnIconName;
  /** Pergunta qual pedido (a pessoa ainda pode dizer "não é sobre um pedido"). */
  needsOrder: boolean;
  priority: SupportPriority;
  helpTopicId?: string;
  /** O que ajuda a resolver mais rápido. */
  tips: string[];
}

export const SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: 'pedido-atraso', profile: 'buy', label: 'Meu pedido não chegou ou atrasou',
    hint: 'Rastreio parado, prazo vencido, entrega que não aconteceu',
    icon: 'truck', needsOrder: true, priority: 'high', helpTopicId: 'entrega',
    tips: ['Diga desde quando o rastreio não anda.', 'Se tiver o código de rastreio, cole aqui.'],
  },
  {
    id: 'pedido-problema', profile: 'buy', label: 'Veio errado, faltando ou danificado',
    hint: 'O produto não é o que você comprou',
    icon: 'box', needsOrder: true, priority: 'normal', helpTopicId: 'devolucao',
    tips: ['Anexe fotos do produto, da caixa e da etiqueta.', 'Diga o que esperava receber e o que veio.'],
  },
  {
    id: 'pagamento', profile: 'buy', label: 'Pagamento ou cobrança',
    hint: 'Pix pago e não aprovado, cobrança errada, estorno',
    icon: 'wallet', needsOrder: true, priority: 'high', helpTopicId: 'pagamento',
    tips: ['Anexe o comprovante do Pix.', 'Informe o valor e a hora do pagamento.'],
  },
  {
    id: 'devolucao', profile: 'buy', label: 'Devolução e arrependimento',
    hint: 'Quero devolver, devolução recusada, reembolso',
    icon: 'returns', needsOrder: true, priority: 'normal', helpTopicId: 'devolucao',
    tips: ['Conte o motivo da devolução.', 'Se o produto veio com defeito, anexe fotos.'],
  },
  {
    id: 'produto-vendedor', profile: 'buy', label: 'Dúvida sobre produto ou vendedor',
    hint: 'Anúncio enganoso, loja que não responde',
    icon: 'bag', needsOrder: false, priority: 'normal', helpTopicId: 'comprar',
    tips: ['Cole o nome do anúncio ou da loja.', 'Anexe capturas de tela, se ajudar.'],
  },

  {
    id: 'conta', profile: 'both', label: 'Minha conta e acesso',
    hint: 'Não consigo entrar, trocar e-mail ou telefone, dados da conta',
    icon: 'account', needsOrder: false, priority: 'normal', helpTopicId: 'conta',
    tips: ['Diga qual e-mail usa na conta.', 'Conte o que aparece na tela quando dá erro.'],
  },
  {
    id: 'seguranca', profile: 'both', label: 'Segurança: conta invadida ou denúncia',
    hint: 'Alguém usou sua conta, golpe, comportamento suspeito',
    icon: 'shield', needsOrder: false, priority: 'high', helpTopicId: 'seguranca',
    tips: ['Conte quando percebeu e o que mudou.', 'Em caso de golpe, anexe as conversas ou comprovantes.'],
  },
  {
    id: 'privacidade', profile: 'both', label: 'Meus dados pessoais (LGPD)',
    hint: 'Acessar, corrigir ou excluir seus dados',
    icon: 'privacy', needsOrder: false, priority: 'high', helpTopicId: 'conta',
    tips: ['Diga qual direito quer exercer (acesso, correção, exclusão…).'],
  },

  {
    id: 'anuncio', profile: 'sell', label: 'Anúncio reprovado ou fora do ar',
    hint: 'Anúncio removido, não aparece na busca, catálogo',
    icon: 'tag', needsOrder: false, priority: 'normal', helpTopicId: 'anuncios',
    tips: ['Cole o nome do anúncio.', 'Se foi removido, conte o aviso que apareceu.'],
  },
  {
    id: 'venda-envio', profile: 'sell', label: 'Vendas e envio',
    hint: 'Etiqueta, postagem, prazo, problema com um pedido',
    icon: 'truck', needsOrder: true, priority: 'normal', helpTopicId: 'vendas',
    tips: ['Diga em que etapa o envio travou.', 'Anexe a foto do comprovante de postagem, se houver.'],
  },
  {
    id: 'repasse', profile: 'sell', label: 'Repasse e taxa',
    hint: 'Valor recebido, prazo do repasse, taxa da Vineon',
    icon: 'wallet', needsOrder: false, priority: 'normal', helpTopicId: 'repasse',
    tips: ['Diga o pedido ou o mês a que se refere.'],
  },
  {
    id: 'nota-fiscal', profile: 'sell', label: 'Nota fiscal',
    hint: 'Nota mensal da Vineon, nota do pedido',
    icon: 'receipt', needsOrder: false, priority: 'normal', helpTopicId: 'repasse',
    tips: ['Diga o mês da nota ou o número do pedido.'],
  },
  {
    id: 'loja', profile: 'sell', label: 'Minha loja e vitrine',
    hint: 'Perfil da loja, banner, dados da loja',
    icon: 'store', needsOrder: false, priority: 'normal', helpTopicId: 'comecar',
    tips: ['Conte o que quer mudar ou o que não está funcionando.'],
  },
  {
    id: 'moderacao', profile: 'sell', label: 'Contestar suspensão ou moderação',
    hint: 'Conta suspensa, anúncio tirado do ar por denúncia',
    icon: 'lock', needsOrder: false, priority: 'high', helpTopicId: 'regras',
    tips: ['Explique por que a decisão não procede.', 'Anexe o que comprova (nota, foto, documento).'],
  },

  {
    id: 'outro', profile: 'both', label: 'Outro assunto',
    hint: 'Nada acima combina com o seu caso',
    icon: 'question', needsOrder: false, priority: 'normal',
    tips: ['Quanto mais detalhe, mais rápido a gente resolve.'],
  },
];

const BY_ID = new Map(SUPPORT_TOPICS.map(t => [t.id, t]));

export function supportTopic(id: string | null | undefined): SupportTopic | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function supportTopicsFor(profile: 'buy' | 'sell'): SupportTopic[] {
  return SUPPORT_TOPICS.filter(t => t.profile === profile || t.profile === 'both');
}
