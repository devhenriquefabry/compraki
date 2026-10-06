/**
 * Respostas prontas da equipe (aba Atendimento do painel).
 *
 * Marcadores trocados na hora de inserir: `{nome}` (primeiro nome), `{protocolo}`,
 * `{pedido}` ("#A1B2C3D4" ou "seu pedido") e `{assunto}`. São textos neutros: não
 * prometem prazo nem política que o app não tenha — se o caso pede uma decisão,
 * o atendente escreve a decisão.
 */
export interface SupportMacro {
  id: string;
  label: string;
  text: string;
  /** Ao enviar, já marca o atendimento como resolvido. */
  resolves?: boolean;
}

export const SUPPORT_MACROS: SupportMacro[] = [
  {
    id: 'recebido',
    label: 'Recebemos, estamos vendo',
    text: 'Olá, {nome}! Recebemos o seu atendimento {protocolo} e já estamos olhando. Assim que tivermos uma posição, voltamos por aqui.',
  },
  {
    id: 'mais-info',
    label: 'Pedir mais informações',
    text: 'Olá, {nome}! Para avançar com o atendimento {protocolo}, pode nos contar mais detalhes? Se for sobre um produto, uma foto ajuda muito (do item, da embalagem e da etiqueta).',
  },
  {
    id: 'conferindo-pedido',
    label: 'Conferindo o pedido',
    text: 'Olá, {nome}! Estamos conferindo {pedido} com a loja e com a transportadora. Voltamos por aqui com uma posição.',
  },
  {
    id: 'falar-com-loja',
    label: 'Falamos com a loja',
    text: 'Olá, {nome}! Entramos em contato com a loja sobre {pedido}. Assim que ela responder, avisamos você por aqui.',
  },
  {
    id: 'devolucao',
    label: 'Como pedir devolução',
    text: 'Olá, {nome}! Para pedir a devolução, abra o pedido em Minha conta › Seus pedidos e toque em "Solicitar devolução". Se encontrar qualquer dificuldade no caminho, responda aqui que ajudamos.',
  },
  {
    id: 'central',
    label: 'Indicar a Central de ajuda',
    text: 'Olá, {nome}! Esse assunto tem um passo a passo na Central de ajuda (Minha conta › Central de ajuda). Se ainda ficar alguma dúvida, é só responder por aqui.',
  },
  {
    id: 'sem-retorno',
    label: 'Sem retorno do cliente',
    text: 'Olá, {nome}! Não recebemos retorno sobre o atendimento {protocolo}. Se ainda precisar de ajuda, é só responder por aqui.',
  },
  {
    id: 'resolvido',
    label: 'Resolvido (fecha o atendimento)',
    text: 'Que bom que conseguimos ajudar, {nome}! Vamos marcar o atendimento {protocolo} como resolvido. Se precisar de mais alguma coisa, é só responder por aqui em até 7 dias.',
    resolves: true,
  },
];

export interface MacroContext {
  name: string;
  protocol: string;
  orderShortId?: string | null;
  subject?: string;
}

export function fillMacro(text: string, ctx: MacroContext): string {
  const first = ctx.name.trim().split(/\s+/)[0] || 'tudo bem';
  return text
    .replace(/\{nome\}/g, first)
    .replace(/\{protocolo\}/g, ctx.protocol)
    .replace(/\{pedido\}/g, ctx.orderShortId ? `o pedido #${ctx.orderShortId}` : 'o seu pedido')
    .replace(/\{assunto\}/g, ctx.subject || 'o seu atendimento');
}
