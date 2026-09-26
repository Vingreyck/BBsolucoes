import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

/**
 * Hash de senha com scrypt.
 *
 * scrypt vem no próprio Node e é uma função de derivação de chave de verdade —
 * lenta e custosa em memória de propósito, que é o que trava ataque de força
 * bruta. Evita trazer bcrypt ou argon2, que compilam código nativo e viram dor
 * de cabeça no Windows e no deploy.
 *
 * O formato guardado é `scrypt$salt$chave`, ambos em base64, com o salt junto:
 * salt por senha impede que duas senhas iguais gerem o mesmo hash e mata
 * ataque por tabela pré-computada.
 */

const TAMANHO_SALT = 16;
const TAMANHO_CHAVE = 64;

/**
 * Hash descartável usado quando o login não existe.
 *
 * Sem isto, login inexistente responderia na hora e senha errada demoraria o
 * tempo do scrypt — e essa diferença de tempo permitiria descobrir quais
 * e-mails e CPFs estão cadastrados. Conferir contra um hash falso iguala os
 * dois casos.
 */
export const HASH_FANTASMA =
  "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Senha provisória legível, gerada por sorteio.
 *
 * Sem `0/O` e `1/l/I`, porque ela vai ser lida em voz alta ou mandada por
 * mensagem, e confundir zero com ó é o jeito mais rápido de gerar um chamado.
 * Ela vale uma vez: a pessoa é obrigada a trocar no primeiro acesso.
 */
export function gerarSenhaProvisoria(): string {
  const letras = "abcdefghjkmnpqrstuvwxyz";
  const numeros = "23456789";
  const alfabeto = letras + letras.toUpperCase() + numeros;
  const bytes = randomBytes(10);
  return [...bytes].map((b) => alfabeto[b % alfabeto.length]).join("");
}

export async function gerarHash(senha: string): Promise<string> {
  const salt = randomBytes(TAMANHO_SALT);
  // NFKC para que a mesma senha digitada com acento composto ou pré-composto
  // gere o mesmo hash, o que varia entre teclados e sistemas.
  const chave = (await scryptAsync(
    senha.normalize("NFKC"),
    salt,
    TAMANHO_CHAVE,
  )) as Buffer;
  return `scrypt$${salt.toString("base64")}$${chave.toString("base64")}`;
}

export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  const partes = hash.split("$");
  if (partes.length !== 3 || partes[0] !== "scrypt") return false;

  const salt = Buffer.from(partes[1], "base64");
  const esperado = Buffer.from(partes[2], "base64");
  if (esperado.length !== TAMANHO_CHAVE) return false;

  const obtido = (await scryptAsync(
    senha.normalize("NFKC"),
    salt,
    TAMANHO_CHAVE,
  )) as Buffer;

  // Comparação em tempo constante: comparar com === vazaria, pelo tempo de
  // resposta, quantos bytes iniciais estavam certos.
  return timingSafeEqual(obtido, esperado);
}
