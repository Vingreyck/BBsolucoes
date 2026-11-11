import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * O código de 6 dígitos do Google Authenticator (TOTP, RFC 6238), sem biblioteca.
 *
 * É a mesma conta em qualquer aplicativo de autenticação (Google Authenticator,
 * Microsoft Authenticator, Authy, 1Password): o servidor e o celular dividem um
 * segredo, e a cada 30 segundos os dois calculam o mesmo número a partir dele e
 * da hora. Quem rouba a senha mas não tem o celular não sabe o número.
 *
 * Só a biblioteca do próprio Node — nada instalado, e portanto nada novo para
 * ser infectado por um verme de npm. Sem banco, para o `testar:regras` conferir
 * com os vetores de teste da própria RFC.
 */

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 20 bytes = 160 bits, o tamanho que a RFC 4226 recomenda para HMAC-SHA1. */
const TAMANHO_SEGREDO = 20;

export const PASSO_SEGUNDOS = 30;
export const DIGITOS = 6;

/** Quantos passos de 30 s para cada lado se aceita: o relógio do celular nunca é igual ao do servidor. */
const JANELA = 1;

export function base32Codificar(bytes: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

/** Aceita minúsculas, espaços e hífens (é como a pessoa digita à mão). Devolve `null` se tiver letra de fora. */
export function base32Decodificar(texto: string): Buffer | null {
  const limpo = texto.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!limpo) return null;
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) return null;
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Um segredo novo, em Base32 — é o que o aplicativo mostra e o que se digita à mão. */
export function novoSegredo(): string {
  return base32Codificar(randomBytes(TAMANHO_SEGREDO));
}

/** O passo de tempo (contador) de um instante: quantos períodos de 30 s desde 1970. */
export function passoDe(agoraMs: number): number {
  return Math.floor(agoraMs / 1000 / PASSO_SEGUNDOS);
}

/** O código de `DIGITOS` dígitos para um contador (RFC 4226, "dynamic truncation"). */
export function codigoDoPasso(segredo: Buffer, passo: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = createHmac("sha1", segredo).update(contador).digest();
  const desvio = h[h.length - 1] & 0x0f;
  const numero =
    ((h[desvio] & 0x7f) << 24) | (h[desvio + 1] << 16) | (h[desvio + 2] << 8) | h[desvio + 3];
  return String(numero % 10 ** DIGITOS).padStart(DIGITOS, "0");
}

/** O que a pessoa digitou, só se for 6 dígitos (aceita o espaço que o aplicativo põe no meio: "123 456"). */
export function normalizarCodigo(texto: string): string | null {
  const limpo = texto.replace(/\s+/g, "");
  return new RegExp(`^\\d{${DIGITOS}}$`).test(limpo) ? limpo : null;
}

/**
 * Confere o código e devolve o passo em que ele vale, ou `null`.
 *
 * Quem chama grava o passo e passa de novo como `ultimoPasso`: um código só
 * vale **uma vez**. Sem isso, quem espiasse o código por cima do ombro (ou num
 * proxy) poderia usá-lo de novo durante os 30 a 90 segundos em que ele ainda
 * confere.
 *
 * Compara os três candidatos (agora, antes e depois) sempre, em tempo constante,
 * para o tempo de resposta não dizer qual deles acertou.
 */
export function verificarCodigo(
  segredoBase32: string,
  codigo: string,
  ultimoPasso: number | null,
  agoraMs = Date.now(),
): number | null {
  const segredo = base32Decodificar(segredoBase32);
  const informado = normalizarCodigo(codigo);
  if (!segredo || !informado) return null;

  const atual = passoDe(agoraMs);
  let achado: number | null = null;
  for (let delta = -JANELA; delta <= JANELA; delta++) {
    const passo = atual + delta;
    const esperado = codigoDoPasso(segredo, passo);
    const igual = timingSafeEqual(Buffer.from(esperado), Buffer.from(informado));
    if (igual && achado === null) achado = passo;
  }
  if (achado === null) return null;
  if (ultimoPasso !== null && achado <= ultimoPasso) return null;
  return achado;
}

/** O endereço `otpauth://` que o QR carrega e o aplicativo entende. */
export function enderecoOtpauth(segredoBase32: string, conta: string, emissor = "Selebi"): string {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  const params = new URLSearchParams({
    secret: segredoBase32,
    issuer: emissor,
    algorithm: "SHA1",
    digits: String(DIGITOS),
    period: String(PASSO_SEGUNDOS),
  });
  return `otpauth://totp/${rotulo}?${params.toString()}`;
}

// ---- o segredo guardado no banco ------------------------------------------------------------

/**
 * O segredo vai para o banco **cifrado** (AES-256-GCM).
 *
 * Um banco vazado (um backup esquecido, uma injeção de SQL) com os segredos em
 * claro deixaria o atacante gerar o código de todo mundo, e o segundo fator
 * valeria zero. Cifrado com uma chave que mora só no `.env` da VM, o banco sozinho
 * não basta.
 *
 * A chave sai de `APP_ENCRYPTION_KEY` por HKDF, com uma "etiqueta" própria — o
 * mesmo `.env` pode servir a outras cifras sem que uma exponha a outra. E o
 * texto cifrado é amarrado ao dono (`dono` entra como dado associado): trocar o
 * segredo de uma linha pela de outra, direto no banco, faz a abertura falhar.
 */
let guardada: { bruta: string; chave: Buffer } | null = null;

function chaveDeCifra(): Buffer | null {
  const bruta = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!bruta || bruta.length < 16) return null;
  // Toda página passa por aqui (o menu pergunta se o 2FA está ligado): deriva uma vez só.
  if (guardada?.bruta !== bruta) {
    guardada = { bruta, chave: Buffer.from(hkdfSync("sha256", Buffer.from(bruta, "utf8"), Buffer.alloc(0), "selebi-mfa-v1", 32)) };
  }
  return guardada.chave;
}

/** O segundo fator só funciona se existe com o que cifrar o segredo. */
export function podeCifrarSegredo(): boolean {
  return chaveDeCifra() !== null;
}

export function cifrarSegredo(segredoBase32: string, dono: string): string {
  const chave = chaveDeCifra();
  if (!chave) throw new Error("APP_ENCRYPTION_KEY não está definida: não há com o que cifrar o segredo do 2FA.");
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave, iv);
  cifra.setAAD(Buffer.from(`mfa:${dono}`));
  const dados = Buffer.concat([cifra.update(segredoBase32, "utf8"), cifra.final()]);
  return ["v1", iv.toString("base64url"), cifra.getAuthTag().toString("base64url"), dados.toString("base64url")].join(".");
}

/** O segredo em claro, ou `null` se o texto está adulterado, é de outro dono ou a chave mudou. */
export function abrirSegredo(guardado: string, dono: string): string | null {
  const chave = chaveDeCifra();
  const partes = guardado.split(".");
  if (!chave || partes.length !== 4 || partes[0] !== "v1") return null;
  try {
    const decifra = createDecipheriv("aes-256-gcm", chave, Buffer.from(partes[1], "base64url"));
    decifra.setAAD(Buffer.from(`mfa:${dono}`));
    decifra.setAuthTag(Buffer.from(partes[2], "base64url"));
    return Buffer.concat([decifra.update(Buffer.from(partes[3], "base64url")), decifra.final()]).toString("utf8");
  } catch {
    return null;
  }
}
