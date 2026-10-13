import { toDate } from './order-stage';

/**
 * Regras das "Perguntas aos vendedores" que o app e a Cloud Function aplicam
 * do mesmo jeito. A cópia do servidor está em functions/src/questions.ts —
 * mudou aqui, mude lá. O servidor é quem decide; aqui só se avisa antes de
 * enviar, para a pessoa não perder o texto digitado.
 */
export const QUESTION_LIMITS = {
  questionMin: 5,
  questionMax: 500,
  answerMin: 2,
  answerMax: 1000,
  openPerProduct: 3,
  quickRepliesMax: 10,
  quickReplyMax: 400,
} as const;

/** Quanto tempo uma pergunta pode esperar antes de aparecer como atrasada para a loja. */
export const LATE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Meta de resposta que a Vineon recomenda às lojas (mostrada no painel da loja). */
export const GOAL_RESPONSE_MS = 60 * 60 * 1000;

const DOMAIN_LOWER = /\b[a-zA-Z0-9-]{2,}\.(?:com|com\.br|net|org|me|io|link|app|shop|store|site|xyz|ly|gg)\b/;
const DOMAIN_UPPER = /\b[A-Z0-9-]{2,}\.(?:COM|COM\.BR|NET|ORG|ME|IO|LINK|APP|SHOP|STORE|SITE|XYZ|LY|GG)\b/;

export type ContactKind= 'email' | 'link' | 'phone' | 'social' | 'offsite';

export const CONTACT_MESSAGE: Record<ContactKind, string> = {
  email: 'Não é possível enviar e-mail por aqui. Use o Vineon para conversar e comprar com proteção.',
  link: 'Links e endereços de sites não são permitidos nas perguntas e respostas.',
  phone: 'Não é possível enviar telefone ou números de contato por aqui.',
  social: 'Não é possível divulgar WhatsApp, redes sociais ou perfis por aqui.',
  offsite: 'Compra e pagamento acontecem só pelo Vineon, com proteção ao comprador. Tire a combinação por fora do texto.',
};

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Procura contato por fora da Vineon: e-mail, link, telefone, rede social ou
 * "vamos combinar por fora". Devolve o tipo achado ou `null`.
 */
export function findContactInfo(text: string): ContactKind | null {
  const t = normalize(text);

  if (/[a-z0-9._%+-]+\s?(@|\(at\)|\[at\]| arroba )\s?[a-z0-9-]+(\.[a-z]{2,})/.test(t)) return 'email';
  if (/(https?:\/\/|www\.)\S+/.test(t)) return 'link';
  // Endereço sem http ("loja.com.br"). "Funciona.Com cabo?" — frase sem espaço depois do ponto — não é
  // site: o final precisa ser todo minúsculo ou todo maiúsculo.
  const raw = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (DOMAIN_LOWER.test(raw) || DOMAIN_UPPER.test(raw)) return 'link';
  if (/(^|\s)@[a-z0-9_.]{3,}/.test(t)) return 'social';
  if (/\b(whats\s?app|whatsapp|zap\s?zap|zapzap|wpp|zap|telegram|instagram|insta|facebook|tiktok|direct)\b/.test(t)) return 'social';

  if (/(^|\D)\d{10,11}(\D|$)/.test(t)) return 'phone';
  if (/(\+?55[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]\d{4}\b/.test(t)) return 'phone';

  if (/\b(por fora|fora do site|fora da plataforma|fora do vineon|fora do app|pix direto|pagamento direto|depositar na conta|me passa seu (numero|contato)|passa seu (numero|contato)|chama no privado|chama no pv)\b/.test(t)) return 'offsite';
  return null;
}

/** Dúvidas que quase todo comprador tem: toque para começar a pergunta. */
export const QUESTION_PROMPTS = [
  'Ainda tem disponível?',
  'Qual o prazo de entrega para o meu CEP?',
  'Aceita troca ou devolução?',
  'Tem garantia?',
  'Vem com todos os acessórios?',
  'Tem algum defeito ou marca de uso?',
] as const;

/** Respostas que toda loja dá toda hora. A pessoa edita antes de publicar. */
export const DEFAULT_QUICK_REPLIES = [
  'Olá! Sim, o produto está disponível. Pode comprar tranquilo(a).',
  'Olá! O prazo e o valor do frete aparecem no carrinho, assim que você informa o CEP.',
  'Olá! Você tem 7 dias depois de receber para desistir da compra, como manda o Código de Defesa do Consumidor.',
  'Olá! Obrigado pelo interesse. Se tiver mais alguma dúvida, é só perguntar.',
] as const;

const STOP_WORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'e', 'ou', 'que',
  'com', 'sem', 'para', 'pra', 'por', 'se', 'eu', 'voce', 'tem', 'ter', 'esse', 'essa', 'este', 'esta', 'isso',
  'ele', 'ela', 'como', 'qual', 'quais', 'ai', 'ola', 'oi', 'bom', 'boa', 'dia', 'tarde', 'noite', 'mais', 'muito',
  'sao', 'sou', 'foi', 'vai', 'ja', 'ainda', 'so', 'meu', 'minha', 'seu', 'sua', 'ao', 'aos',
]);

function tokens(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Perguntas já respondidas parecidas com o que a pessoa está digitando. Evita
 * pergunta repetida (a loja responde uma vez só) e dá a resposta na hora.
 * Semelhança = palavras em comum sobre as palavras da pergunta digitada.
 */
export function similarQuestions<T extends { text: string }>(typed: string, answered: readonly T[], max = 3): T[] {
  const wanted = new Set(tokens(typed));
  if (wanted.size < 2) return [];

  return answered
    .map(q => {
      const words = new Set(tokens(q.text));
      let shared = 0;
      wanted.forEach(w => { if (words.has(w)) shared++; });
      return { q, score: shared / Math.min(wanted.size, Math.max(words.size, 1)), shared };
    })
    .filter(r => r.shared >= 2 && r.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(r => r.q);
}

// ---------------------------------------------------------------- tempo

/** "42 min", "3 h", "2 dias" — duração curta para "responde em…". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias" — há quanto tempo a pergunta espera. */
export function agoLabel(value: unknown, now = Date.now()): string {
  const date = toDate(value);
  if (!date) return 'agora';
  const diff = now - date.getTime();
  if (diff < 60_000) return 'agora';
  return `há ${formatDuration(diff)}`;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
