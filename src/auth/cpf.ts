/**
 * CPF: o login do app.
 *
 * Guardado só com dígitos. A validação confere os dois dígitos verificadores —
 * não para provar que a pessoa existe (isso nenhum cálculo prova), mas para
 * pegar o erro de digitação na hora, em vez de ele virar uma conta que ninguém
 * consegue achar depois.
 */

export function normalizarCpf(bruto: string): string {
  return bruto.replace(/\D/g, "");
}

function digitoVerificador(base: string, pesoInicial: number): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false;
  // 111.111.111-11 passa no cálculo e não é CPF de ninguém.
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  return (
    digitoVerificador(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    digitoVerificador(cpf.slice(0, 10), 11) === Number(cpf[10])
  );
}

/** 12345678909 → 123.456.789-09 */
export function formatarCpf(cpf: string): string {
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

/**
 * 12345678909 → 123.***.***-09
 *
 * Para listas. Basta para o administrador reconhecer a pessoa; o número inteiro
 * só aparece quando ele abre a ficha dela.
 */
export function ocultarCpf(cpf: string): string {
  if (cpf.length !== 11) return cpf;
  return `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`;
}
