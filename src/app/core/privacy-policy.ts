/**
 * Dados da Política de Privacidade (tela `/privacy`).
 *
 * A LGPD exige que a política diga quem é o controlador e como falar com o
 * encarregado (art. 9º, III; art. 41, §1º). Preencha os campos abaixo com os
 * dados reais da empresa — o que ficar vazio simplesmente não aparece na tela,
 * nunca é trocado por um valor de exemplo.
 */
export const PRIVACY_CONTROLLER = {
  /** Nome comercial. */
  brand: 'Vineon',
  /** Razão social, como está no CNPJ. */
  legalName: 'VINEON MARKETPLACE LTDA',
  cnpj: '68.408.451/0001-04',
  /** Endereço da sede: rua, número, bairro, cidade/UF, CEP. */
  address: 'Rua Silas Pacheco, 616, Garagem/Sala, Bairro Colina, Manhuaçu/MG, CEP 36.900-380',
  /** Encarregado pelo tratamento de dados (DPO). Pode ser pessoa ou equipe. */
  dpoName: 'Equipe de Privacidade Vineon — Josué de Oliveira Souza e Henrique Fabry Teixeira Santos',
  /**
   * Canal do encarregado. Sem ele a tela não mostra o botão de e-mail.
   * Provisório: trocar quando o e-mail próprio de privacidade for criado.
   */
  dpoEmail: 'vineon60@gmail.com',
};

/**
 * Data desta versão da política (AAAA-MM-DD). Trocar sempre que o texto mudar
 * de forma relevante — e avisar quem tem conta.
 */
export const PRIVACY_POLICY_UPDATED = '2026-10-05';
