/**
 * Dados da empresa e versões dos textos legais (telas `/privacy` e `/terms`,
 * rodapé do site).
 *
 * A LGPD exige que a política diga quem é o controlador e como falar com o
 * encarregado (art. 9º, III; art. 41, §1º), e o Decreto 7.962/2013 (comércio
 * eletrônico) exige razão social, CNPJ, endereço e contato em local visível.
 * O que ficar vazio simplesmente não aparece na tela, nunca é trocado por um
 * valor de exemplo.
 */
export const COMPANY = {
  /** Nome comercial. */
  brand: 'Vineon',
  /** Razão social, como está no CNPJ. */
  legalName: 'VINEON MARKETPLACE LTDA',
  cnpj: '68.408.451/0001-04',
  /** Endereço da sede: rua, número, bairro, cidade/UF, CEP. */
  address: 'Rua Silas Pacheco, 616, Garagem/Sala, Bairro Colina, Manhuaçu/MG, CEP 36.900-380',
  /** Cidade do foro para o que não for relação de consumo. */
  forum: 'Manhuaçu/MG',
  /** Encarregado pelo tratamento de dados (DPO). Pode ser pessoa ou equipe. */
  dpoName: 'Equipe de Privacidade Vineon — Josué de Oliveira Souza e Henrique Fabry Teixeira Santos',
  /**
   * Canal do encarregado. Sem ele a tela não mostra o botão de e-mail.
   * Provisório: trocar quando o e-mail próprio de privacidade for criado.
   */
  dpoEmail: 'vineon60@gmail.com',
  /**
   * Atendimento (devoluções, reclamações, encerrar conta) enquanto o app não
   * tem a tela "Fale com a Vineon". Provisório, igual ao do encarregado.
   */
  supportEmail: 'vineon60@gmail.com',
};

/**
 * Datas das versões (AAAA-MM-DD). Trocar sempre que o texto mudar de forma
 * relevante — e avisar quem tem conta.
 */
export const PRIVACY_POLICY_UPDATED = '2026-10-05';
export const TERMS_UPDATED = '2026-10-05';

/** "2026-10-05" → "5 de outubro de 2026". */
export function formatLegalDate(iso: string): string {
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${months[m - 1]} de ${y}`;
}

/** `mailto:` com assunto pronto, ou `null` sem e-mail configurado. */
export function mailtoLink(email: string, subject: string): string | null {
  return email ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : null;
}
