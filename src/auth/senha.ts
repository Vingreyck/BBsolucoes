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
