/**
 * CPF e CNPJ: confere os dígitos verificadores, não só a quantidade de
 * números. A mesma conta existe no servidor (`functions/src/orders.ts`), que é
 * quem decide de verdade; aqui é para avisar a pessoa antes de enviar.
 */

const digitsOf = (value: string) => String(value ?? '').replace(/\D/g, '');

export function isValidCpf(value: string): boolean {
  const d = digitsOf(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

export function isValidCnpj(value: string): boolean {
  const d = digitsOf(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

export function isValidCpfOrCnpj(value: string): boolean {
  return isValidCpf(value) || isValidCnpj(value);
}

/**
 * Máscaras para usar enquanto a pessoa digita: formatam o que já existe, sem
 * esperar o número completo. 1234567 → 123.456.7
 */
export function maskCpf(value: string): string {
  const d = digitsOf(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** 33984500707 → (33) 98450-0707; fixo de 10 dígitos → (33) 3331-1234. */
export function maskPhone(value: string): string {
  const d = digitsOf(value).replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const rest = d.slice(2);
  const split = d.length === 11 ? 5 : 4;
  if (rest.length <= split) return `(${d.slice(0, 2)}) ${rest}`;
  return `(${d.slice(0, 2)}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** 36900000 → 36900-000 */
export function maskCep(value: string): string {
  const d = digitsOf(value).slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** 12345678901 → 123.456.789-01; 14 dígitos → 12.345.678/0001-90. */
export function formatCpfCnpj(value: string): string {
  const d = digitsOf(value);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return value;
}
