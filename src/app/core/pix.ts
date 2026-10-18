import { isValidCnpj, isValidCpf } from './br-documents';

/**
 * Chave Pix onde a loja recebe os repasses (`sellerPayouts/{uid}`, tela
 * Recebimentos). As mesmas regras de formato estão em firestore.rules.
 */

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export interface SellerPayout {
  method: 'pix';
  pixKeyType: PixKeyType;
  /** Normalizada: só números (CPF/CNPJ), +55DDDNUMERO (celular), minúsculo (e-mail/aleatória). */
  pixKey: string;
  holderName: string;
  /** CPF ou CNPJ do titular da conta, só números. */
  holderDocument: string;
  updatedAt?: any;
}

export const PIX_KEY_TYPES: { id: PixKeyType; label: string; placeholder: string }[] = [
  { id: 'cpf', label: 'CPF', placeholder: '000.000.000-00' },
  { id: 'cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00' },
  { id: 'phone', label: 'Celular', placeholder: '(00) 90000-0000' },
  { id: 'email', label: 'E-mail', placeholder: 'voce@email.com' },
  { id: 'random', label: 'Aleatória', placeholder: '123e4567-e89b-12d3-a456-426614174000' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RANDOM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Deixa a chave no formato que o Pix usa. */
export function normalizePixKey(type: PixKeyType, raw: string): string {
  const value = String(raw ?? '').trim();
  const digits = value.replace(/\D/g, '');
  switch (type) {
    case 'cpf':
    case 'cnpj':
      return digits;
    case 'phone': {
      const local = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
      return local ? `+55${local}` : '';
    }
    case 'email':
    case 'random':
      return value.toLowerCase();
  }
}

/** Mensagem do que está errado na chave, ou vazio quando está certa. */
export function pixKeyProblem(type: PixKeyType, key: string): string {
  switch (type) {
    case 'cpf':
      return isValidCpf(key) ? '' : 'CPF inválido.';
    case 'cnpj':
      return isValidCnpj(key) ? '' : 'CNPJ inválido.';
    case 'phone':
      return /^\+55\d{10,11}$/.test(key) ? '' : 'Celular com DDD, só números.';
    case 'email':
      return EMAIL_RE.test(key) && key.length <= 77 ? '' : 'E-mail inválido.';
    case 'random':
      return RANDOM_RE.test(key) ? '' : 'A chave aleatória tem 32 letras e números, com hífens.';
  }
}

/** Mostra a chave sem expor tudo (tela da loja e do admin). */
export function maskPixKey(type: PixKeyType, key: string): string {
  if (!key) return '';
  switch (type) {
    case 'cpf':
      return key.length === 11 ? `***.${key.slice(3, 6)}.${key.slice(6, 9)}-**` : key;
    case 'cnpj':
      return key.length === 14 ? `${key.slice(0, 2)}.${key.slice(2, 5)}.***/****-${key.slice(12)}` : key;
    case 'phone':
      return key.length >= 12 ? `(${key.slice(3, 5)}) *****-${key.slice(-4)}` : key;
    case 'email': {
      const [user, domain] = key.split('@');
      return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
    }
    case 'random':
      return `${key.slice(0, 8)}-****-****-****-${key.slice(-4)}`;
  }
}

export function pixKeyLabel(type: PixKeyType): string {
  return PIX_KEY_TYPES.find(t => t.id === type)?.label ?? 'Chave';
}
