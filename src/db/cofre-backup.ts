import { createCipheriv, createDecipheriv, randomBytes, scrypt, type ScryptOptions } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, openSync, readSync, statSync, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";

/**
 * A cópia de segurança cifrada, para guardar fora da VM.
 *
 * O backup é o banco inteiro: CPF, endereço, telefone e conta de luz de cada
 * cliente. Fora da VM ele vai para o Drive da empresa — e um arquivo desses
 * aberto no Drive é um vazamento esperando um compartilhamento errado. Por isso
 * ele sai daqui cifrado com AES-256-GCM: sem a `BACKUP_SENHA` ninguém lê, e
 * qualquer alteração no arquivo (corrompido, adulterado) é detectada ao abrir.
 *
 * Senha e não par de chaves, de propósito: o risco mais provável aqui não é um
 * invasor, é perder a chave no dia em que a VM sumir. Uma senha longa guardada
 * no cofre de senhas é o que tem mais chance de existir nesse dia. A chave de
 * verdade sai da senha pelo scrypt, com um sal novo a cada arquivo.
 *
 * Formato: `SELEBIBK` · versão (1 byte) · sal (16) · IV (12) · dados · tag (16).
 * Só a biblioteca do próprio Node, nada instalado.
 */

const MAGICA = Buffer.from("SELEBIBK");
const VERSAO = 1;
const TAMANHO_SAL = 16;
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;
const CABECALHO = MAGICA.length + 1 + TAMANHO_SAL + TAMANHO_IV;

/** Custo do scrypt: 32 MiB e uns 100 ms por arquivo — uma vez por dia, de graça. */
const CUSTO: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Abaixo disto a senha é adivinhável; uma frase de cinco palavras passa folgado. */
export const SENHA_MINIMA = 20;

/** A senha do `.env`, ou nulo quando a cópia externa não está configurada. */
export function senhaDoBackup(): string | null {
  const senha = process.env.BACKUP_SENHA?.trim();
  return senha ? senha : null;
}

function derivar(senha: string, sal: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(senha.normalize("NFKC"), sal, 32, CUSTO, (erro, chave) => (erro ? reject(erro) : resolve(chave)));
  });
}

/** Cifra `origem` em `destino`, em fluxo: o arquivo nunca passa inteiro pela memória. */
export async function cifrar(origem: string, destino: string, senha: string): Promise<void> {
  if (senha.length < SENHA_MINIMA) {
    throw new Error(`BACKUP_SENHA curta demais: use pelo menos ${SENHA_MINIMA} caracteres.`);
  }
  const sal = randomBytes(TAMANHO_SAL);
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv("aes-256-gcm", await derivar(senha, sal), iv);
  const cabecalho = Buffer.concat([MAGICA, Buffer.from([VERSAO]), sal, iv]);

  try {
    await pipeline(
      createReadStream(origem),
      async function* (fonte: AsyncIterable<Buffer>) {
        yield cabecalho;
        for await (const pedaco of fonte) yield cifra.update(pedaco);
        yield cifra.final();
        // A tag no fim é o que denuncia qualquer byte trocado.
        yield cifra.getAuthTag();
      },
      createWriteStream(destino),
    );
  } catch (erro) {
    apagarSemErro(destino);
    throw erro;
  }
}

/**
 * Abre uma cópia cifrada. Senha errada e arquivo corrompido dão o mesmo erro —
 * o GCM não distingue, e é bom que não distinga. O `destino` só fica se tudo
 * conferiu: um arquivo pela metade, sem autenticação, não pode sobrar no disco
 * parecendo um backup bom.
 */
export async function decifrar(origem: string, destino: string, senha: string): Promise<void> {
  const tamanho = statSync(origem).size;
  if (tamanho < CABECALHO + TAMANHO_TAG) throw new Error("O arquivo é pequeno demais para ser uma cópia cifrada.");

  const cabecalho = Buffer.alloc(CABECALHO);
  const tag = Buffer.alloc(TAMANHO_TAG);
  const fd = openSync(origem, "r");
  try {
    readSync(fd, cabecalho, 0, CABECALHO, 0);
    readSync(fd, tag, 0, TAMANHO_TAG, tamanho - TAMANHO_TAG);
  } finally {
    closeSync(fd);
  }
  if (!cabecalho.subarray(0, MAGICA.length).equals(MAGICA)) {
    throw new Error("Este arquivo não é uma cópia cifrada do Selebi.");
  }
  if (cabecalho[MAGICA.length] !== VERSAO) {
    throw new Error(`Cópia cifrada na versão ${cabecalho[MAGICA.length]}, que este script não conhece.`);
  }
  const sal = cabecalho.subarray(MAGICA.length + 1, MAGICA.length + 1 + TAMANHO_SAL);
  const iv = cabecalho.subarray(MAGICA.length + 1 + TAMANHO_SAL, CABECALHO);
  const decifra = createDecipheriv("aes-256-gcm", await derivar(senha, sal), iv);
  decifra.setAuthTag(tag);

  try {
    await pipeline(
      createReadStream(origem, { start: CABECALHO, end: tamanho - TAMANHO_TAG - 1 }),
      decifra,
      createWriteStream(destino),
    );
  } catch (erro) {
    apagarSemErro(destino);
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    if (/authenticate|auth tag/i.test(mensagem)) {
      throw new Error("Senha errada, ou o arquivo foi alterado ou corrompido. Nada foi aberto.");
    }
    throw erro;
  }
}

function apagarSemErro(caminho: string): void {
  try {
    unlinkSync(caminho);
  } catch {
    // Não existia: nada a limpar.
  }
}
