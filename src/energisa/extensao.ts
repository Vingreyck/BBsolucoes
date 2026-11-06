import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";

const PASTA = path.join(process.cwd(), "extensao");
const RAIZ_NO_ZIP = "selebi-energisa";

/** A pasta `extensao/` num .zip, dentro de `selebi-energisa/`, para "Carregar sem compactação" no Chrome. */
export async function zipDaExtensao(): Promise<Buffer> {
  const nomes = await listar("");
  const arquivos = await Promise.all(
    nomes.map(async (rel) => ({ nome: `${RAIZ_NO_ZIP}/${rel}`, dados: await readFile(path.join(PASTA, rel)) })),
  );
  return montarZip(arquivos);
}

async function listar(sub: string): Promise<string[]> {
  const itens = await readdir(path.join(PASTA, sub), { withFileTypes: true });
  const saida: string[] = [];
  for (const i of itens) {
    const rel = sub ? `${sub}/${i.name}` : i.name;
    if (i.isDirectory()) saida.push(...(await listar(rel)));
    else saida.push(rel);
  }
  return saida.sort();
}

/** Zip sem compressão (são poucos KB): cabeçalho de cada arquivo, diretório central e o fim. */
export function montarZip(arquivos: { nome: string; dados: Buffer }[]): Buffer {
  const partes: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  const UTF8 = 0x0800;
  const DATA_1980 = 0x21;

  for (const { nome, dados } of arquivos) {
    const n = Buffer.from(nome, "utf8");
    const crc = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(DATA_1980, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(n.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(DATA_1980, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(deslocamento, 42);

    partes.push(local, n, dados);
    centrais.push(central, n);
    deslocamento += local.length + n.length + dados.length;
  }

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, diretorio, fim]);
}
