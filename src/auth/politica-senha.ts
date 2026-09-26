/**
 * Regra de senha, a mesma no navegador e no app.
 *
 * Oito caracteres é o piso das recomendações e é o que dá para pedir a uma
 * equipe que vai digitar isso no celular, em cima de um telhado. Comprimento
 * importa mais que exigir símbolo: regra de complexidade produz `Senha@123` em
 * todo mundo. O que se barra é o que qualquer um tentaria primeiro.
 */

export const SENHA_MINIMO = 8;
export const SENHA_MAXIMO = 128;

/**
 * As primeiras que alguém tenta, e as que já estiveram num repositório público.
 * Vale a raiz: sem acento, em minúsculas e sem o número ou símbolo do fim —
 * "Senha@2026" é "senha", "Selebi123" é "selebi". Assim a lista não precisa
 * escrever cada variação, e nenhuma variação fica escrita aqui.
 */
const RAIZES_PROIBIDAS = new Set(["bbsolucoes", "senha", "password", "qwerty", "abc", "selebi"]);

/** Só números: as sequências. Repetição (11111111) a regra abaixo já pega. */
const NUMEROS_PROIBIDOS = new Set(["12345678", "123456789", "1234567890", "87654321"]);

function raizDa(senha: string): string {
  return senha
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+$/, "");
}

/** Devolve o que está errado com a senha, ou null se ela serve. */
export function problemaNaSenha(
  senha: string,
  contexto: { cpf?: string | null } = {},
): string | null {
  if (senha.length < SENHA_MINIMO) {
    return `A senha precisa de pelo menos ${SENHA_MINIMO} caracteres.`;
  }
  if (senha.length > SENHA_MAXIMO) {
    return `A senha pode ter no máximo ${SENHA_MAXIMO} caracteres.`;
  }
  if (
    NUMEROS_PROIBIDOS.has(senha) ||
    RAIZES_PROIBIDAS.has(raizDa(senha)) ||
    /^(.)\1+$/.test(senha)
  ) {
    return "Essa senha é das primeiras que alguém tentaria. Escolha outra.";
  }
  // O CPF está em todo documento da pessoa — nos projetos, nos contratos, nos
  // grupos de WhatsApp. Senha que contém o CPF é senha pública.
  if (contexto.cpf && senha.replace(/\D/g, "").includes(contexto.cpf)) {
    return "A senha não pode conter o seu CPF.";
  }
  return null;
}
