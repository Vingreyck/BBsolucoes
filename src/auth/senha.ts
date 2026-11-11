import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Hash de senha com scrypt.
 *
 * scrypt vem no próprio Node e é uma função de derivação de chave de verdade —
 * lenta e custosa em memória de propósito, que é o que trava ataque de força
 * bruta. Evita trazer bcrypt ou argon2, que compilam código nativo e viram dor
 * de cabeça no Windows e no deploy.
 *
 * O formato guardado é `scrypt$N$r$p$salt$chave` (salt e chave em base64). O
 * custo vai escrito junto para poder subir de novo no futuro sem invalidar a
 * senha de ninguém: cada hash diz com que custo foi feito, e o login regrava os
 * que ficaram para trás ([verificarSenha]).
 *
 * O formato antigo, `scrypt$salt$chave`, usava o custo padrão do Node
 * (N=2^14, r=8, p=1) — cinco vezes abaixo do mínimo que a OWASP recomenda. Ele
 * continua sendo aceito, e some sozinho: no primeiro login depois desta
 * mudança, a senha é conferida com o custo antigo e regravada com o novo.
 */

const TAMANHO_SALT = 16;
const TAMANHO_CHAVE = 64;

interface Custo {
  N: number;
  r: number;
  p: number;
}

/**
 * N=2^15, r=8, p=3: uma das configurações que a OWASP (Password Storage Cheat
 * Sheet) lista como equivalentes ao mínimo de N=2^17, trocando memória por
 * processador. São 32 MiB e uns 0,4 s por conferência — o Node faz no máximo
 * quatro ao mesmo tempo, então o pico é de 128 MiB mesmo sob ataque. O mínimo
 * "cheio" (N=2^17) pediria 128 MiB por login, demais para a VM.
 */
const CUSTO_ATUAL: Custo = { N: 2 ** 15, r: 8, p: 3 };

/** O que o formato antigo usava sem dizer: o padrão do Node. */
const CUSTO_ANTIGO: Custo = { N: 2 ** 14, r: 8, p: 1 };

/** Teto de memória de uma derivação. O padrão do Node (32 MiB) não comporta o custo atual. */
const MEMORIA_MAXIMA = 96 * 1024 * 1024;

/**
 * Acima disto nem se tenta: a regra de senha para em 128 caracteres, e
 * normalizar e resumir um texto de megabytes só serviria para ocupar o servidor.
 */
const SENHA_MAXIMA_ACEITA = 1024;

function derivar(senha: string, salt: Buffer, custo: Custo): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    scrypt(
      // NFKC para que a mesma senha digitada com acento composto ou pré-composto
      // gere o mesmo hash, o que varia entre teclados e sistemas.
      senha.normalize("NFKC"),
      salt,
      TAMANHO_CHAVE,
      { N: custo.N, r: custo.r, p: custo.p, maxmem: MEMORIA_MAXIMA },
      (erro, chave) => (erro ? rejeitar(erro) : resolver(chave)),
    );
  });
}

function escrever(custo: Custo, salt: Buffer, chave: Buffer): string {
  return `scrypt$${custo.N}$${custo.r}$${custo.p}$${salt.toString("base64")}$${chave.toString("base64")}`;
}

interface HashLido {
  custo: Custo;
  salt: Buffer;
  chave: Buffer;
}

/** Lê os dois formatos. Qualquer coisa fora do esperado vira `null`, nunca erro. */
function ler(hash: string): HashLido | null {
  const partes = hash.split("$");
  if (partes[0] !== "scrypt") return null;

  let custo: Custo;
  let salt64: string;
  let chave64: string;
  if (partes.length === 3) {
    custo = CUSTO_ANTIGO;
    [, salt64, chave64] = partes;
  } else if (partes.length === 6) {
    custo = { N: Number(partes[1]), r: Number(partes[2]), p: Number(partes[3]) };
    [, , , , salt64, chave64] = partes;
    // O custo vem do banco. Se alguém adulterar a linha, um N absurdo não pode
    // virar um jeito de travar o servidor a cada tentativa de login.
    const potenciaDeDois = Number.isInteger(custo.N) && custo.N >= 2 ** 14 && custo.N <= 2 ** 17 && (custo.N & (custo.N - 1)) === 0;
    if (!potenciaDeDois || custo.r !== 8 || !Number.isInteger(custo.p) || custo.p < 1 || custo.p > 10) return null;
  } else {
    return null;
  }

  const salt = Buffer.from(salt64, "base64");
  const chave = Buffer.from(chave64, "base64");
  if (salt.length !== TAMANHO_SALT || chave.length !== TAMANHO_CHAVE) return null;
  return { custo, salt, chave };
}

/** O hash foi feito com menos custo que o de hoje? */
function fraco(custo: Custo): boolean {
  return custo.N * custo.p < CUSTO_ATUAL.N * CUSTO_ATUAL.p || custo.N < CUSTO_ATUAL.N;
}

/**
 * Hash descartável usado quando o login não existe.
 *
 * Sem isto, login inexistente responderia na hora e senha errada demoraria o
 * tempo do scrypt — e essa diferença de tempo permitiria descobrir quais
 * e-mails e CPFs estão cadastrados. Conferir contra um hash falso iguala os
 * dois casos.
 *
 * Montado pelo mesmo `escrever` dos hashes de verdade, e não digitado à mão: a
 * versão anterior era um texto fixo cuja chave decodificava em 66 bytes em vez
 * de 64, a conferência a rejeitava antes de calcular qualquer coisa, e o login
 * inexistente respondia em 0 ms contra 66 ms do existente. O `testar:regras`
 * agora confere que este hash é lido e custa o mesmo que um real.
 */
export const HASH_FANTASMA = escrever(CUSTO_ATUAL, Buffer.alloc(TAMANHO_SALT), Buffer.alloc(TAMANHO_CHAVE));

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
  // `randomInt` sorteia sem viés; o resto da divisão de um byte favorecia as
  // primeiras letras do alfabeto.
  return Array.from({ length: 10 }, () => alfabeto[randomInt(alfabeto.length)]).join("");
}

export async function gerarHash(senha: string): Promise<string> {
  const salt = randomBytes(TAMANHO_SALT);
  return escrever(CUSTO_ATUAL, salt, await derivar(senha, salt, CUSTO_ATUAL));
}

export interface Verificacao {
  confere: boolean;
  /**
   * Preenchido quando a senha confere e o hash guardado é de custo antigo:
   * quem chamou grava este no lugar, e a conta passa a ter o custo de hoje.
   */
  novoHash: string | null;
}

/**
 * Confere a senha e, se o hash guardado ficou para trás, já devolve o novo.
 *
 * Toda conferência custa pelo menos o custo de hoje, exista a conta ou não,
 * seja o hash novo ou antigo: no hash antigo, o novo é calculado sempre (serve
 * para regravar quando a senha confere, e para não responder mais rápido quando
 * não confere). Assim o tempo de resposta não separa conta antiga de conta
 * inexistente.
 */
export async function verificarSenha(senha: string, hash: string): Promise<Verificacao> {
  const longaDemais = senha.length > SENHA_MAXIMA_ACEITA;
  const candidata = longaDemais ? senha.slice(0, SENHA_MAXIMA_ACEITA) : senha;

  // Hash ilegível (linha corrompida) gasta o mesmo tempo e não confere.
  const proprio = ler(hash);
  const legivel = proprio !== null;
  const lido = proprio ?? ler(HASH_FANTASMA)!;

  const obtido = await derivar(candidata, lido.salt, lido.custo);
  // Comparação em tempo constante: comparar com === vazaria, pelo tempo de
  // resposta, quantos bytes iniciais estavam certos.
  const confere = timingSafeEqual(obtido, lido.chave) && legivel && !longaDemais;

  if (!fraco(lido.custo)) return { confere, novoHash: null };

  const salt = randomBytes(TAMANHO_SALT);
  const novo = escrever(CUSTO_ATUAL, salt, await derivar(candidata, salt, CUSTO_ATUAL));
  return { confere, novoHash: confere ? novo : null };
}

export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  return (await verificarSenha(senha, hash)).confere;
}

/** Para os testes: o custo com que um hash foi feito, ou `null` se ele não é legível. */
export function custoDoHash(hash: string): Custo | null {
  return ler(hash)?.custo ?? null;
}
