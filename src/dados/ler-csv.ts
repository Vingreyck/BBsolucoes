/**
 * Leitura de CSV grande linha a linha, para os geradores de dados públicos
 * (`npm run dados:equipamentos`, `npm run dados:municipios`). Só roda na
 * máquina de quem atualiza os dados, nunca no site.
 *
 * Aceita o `.csv` ou o `.zip` que os portais oficiais publicam: o zip é aberto
 * pelo `unzip -p` do sistema, sem extrair gigabytes no disco.
 */

import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

/** Separa uma linha de CSV com aspas (`"a";"b;c";"d"`). */
export function separarLinha(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          atual += '"';
          i++;
        } else aspas = false;
      } else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      campos.push(atual);
      atual = "";
    } else atual += c;
  }
  campos.push(atual);
  return campos;
}

function abrir(caminho: string, dentroDoZip?: string): Readable {
  if (caminho.toLowerCase().endsWith(".zip")) {
    const args = ["-p", caminho];
    if (dentroDoZip) {
      // Sem curinga na linha de comando: no Windows o unzip do Git expande "*.csv"
      // contra a pasta atual. A lista do zip escolhe o arquivo pelo fim do nome.
      const lista = spawnSync("unzip", ["-Z1", caminho], { encoding: "utf8" }).stdout.split(/\r?\n/);
      const fim = dentroDoZip.replace(/^\*/, "").toLowerCase();
      const achado = lista.find((n) => n.toLowerCase().endsWith(fim));
      if (!achado) throw new Error(`Nada terminado em "${fim}" dentro de ${caminho}`);
      args.push(achado);
    }
    const p = spawn("unzip", args, { stdio: ["ignore", "pipe", "inherit"] });
    return p.stdout;
  }
  return createReadStream(caminho);
}

/**
 * Percorre o CSV e chama `cada` com o registro já como objeto (cabeçalho →
 * valor). `dentroDoZip` escolhe um arquivo quando o zip traz vários.
 */
export async function lerCsv(
  caminho: string,
  opcoes: { sep?: string; codificacao?: BufferEncoding; dentroDoZip?: string },
  cada: (registro: Record<string, string>, n: number) => void,
): Promise<number> {
  const sep = opcoes.sep ?? ";";
  const fluxo = abrir(caminho, opcoes.dentroDoZip);
  fluxo.setEncoding(opcoes.codificacao ?? "utf8");
  const linhas = createInterface({ input: fluxo, crlfDelay: Infinity });
  let cabecalho: string[] | null = null;
  let n = 0;
  for await (const linha of linhas) {
    if (!linha) continue;
    const campos = separarLinha(linha, sep);
    if (!cabecalho) {
      cabecalho = campos.map((c) => c.replace(/^﻿/, "").trim());
      continue;
    }
    const reg: Record<string, string> = {};
    for (let i = 0; i < cabecalho.length; i++) reg[cabecalho[i]] = campos[i] ?? "";
    cada(reg, n++);
  }
  return n;
}

/** "36,80" → 36.8; "1.234,5" → 1234.5; vazio → nulo. */
export function numeroBr(v: string | undefined): number | null {
  if (!v) return null;
  let t = v.trim();
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Só letras e números, em maiúsculas: a chave de comparação de nomes digitados à mão. */
export function chaveDeNome(t: string | null | undefined): string {
  return (t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
