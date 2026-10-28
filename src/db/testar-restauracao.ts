import "dotenv/config";

import { spawn } from "node:child_process";
import { createReadStream, existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";

import { marcaDaRestauracao, mesAtual } from "./backup-remoto";
import { decifrar, senhaDoBackup } from "./cofre-backup";

/**
 * Teste de restauração: a prova de que a cópia de segurança serve.
 *
 * Backup que nunca foi restaurado é uma esperança, não uma cópia. Este script
 * pega a cópia mais nova (ou a que for passada), restaura num banco
 * descartável no mesmo Postgres, confere que as tabelas principais voltaram com
 * dados, compara com o banco de verdade e apaga o descartável. O coletor roda
 * isto uma vez por mês, de madrugada; à mão:
 *
 *   npm run backup:testar
 *   npm run backup:testar -- backups/selebi-2026-10-28-0700.sql.gz
 *   npm run backup:testar -- selebi-2026-10-28-0700.sql.gz.cifrado   (a do Drive)
 *
 * O banco de produção só é **lido** (as contagens). O único banco criado e
 * apagado é o de nome fixo abaixo, conferido antes de qualquer `DROP`.
 */

const PASTA = "backups";
const CONTAINER = process.env.PG_CONTAINER === undefined ? "bb-pg" : process.env.PG_CONTAINER;
const BANCO = process.env.PG_DATABASE ?? "bbsolucoes";
const USUARIO = process.env.PG_USER ?? "postgres";

/** O banco descartável. Nome fixo, nunca vindo de fora: é nele que se dá `DROP`. */
const BANCO_TESTE = "selebi_teste_restauracao";

/** O que precisa voltar de uma restauração, e o que vale comparar. */
const TABELAS = ["empresa", "usuario", "cliente", "usina", "projeto", "documento", "ordem_servico", "os_checklist_item"];
const ESSENCIAIS = new Set(["empresa", "usuario"]);

function urlDo(banco: string): string {
  const base =
    process.env.DATABASE_URL ?? `postgres://${USUARIO}@${process.env.PG_HOST ?? "db"}:5432/${BANCO}`;
  const url = new URL(base);
  url.pathname = `/${banco}`;
  return url.toString();
}

/**
 * Chama o `psql` — em desenvolvimento pelo `docker exec`, como o backup; em
 * produção pela rede do compose. `-w` nunca pergunta senha (travar é pior que
 * falhar) e `ON_ERROR_STOP` faz qualquer erro da restauração ser erro de verdade.
 */
function psql(banco: string, argumentos: string[], entrada?: NodeJS.ReadableStream): Promise<string> {
  const comuns = ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-w", ...argumentos];
  const [programa, args] = CONTAINER
    ? ["docker", ["exec", "-i", CONTAINER, "psql", "-U", USUARIO, "-d", banco, ...comuns]]
    : ["psql", [urlDo(banco), ...comuns]];
  return new Promise((resolve, reject) => {
    const processo = spawn(programa, args, { stdio: [entrada ? "pipe" : "ignore", "pipe", "pipe"] });
    let saida = "";
    let erro = "";
    // Saída e erro sempre existem: o `stdio` acima pede "pipe" para os dois.
    processo.stdout!.on("data", (d) => (saida += d));
    processo.stderr!.on("data", (d) => (erro += d));
    if (entrada && processo.stdin) {
      entrada.on("error", reject);
      entrada.pipe(processo.stdin);
    }
    processo.on("error", reject);
    processo.on("close", (codigo) =>
      codigo === 0
        ? resolve(saida)
        : reject(new Error(erro.trim().split("\n").slice(-5).join("\n") || `psql saiu com código ${codigo}`)),
    );
  });
}

async function contar(banco: string, tabela: string): Promise<number | null> {
  try {
    return Number((await psql(banco, ["-At", "-c", `SELECT count(*) FROM public.${tabela}`])).trim());
  } catch {
    return null; // a tabela não existe nesse banco
  }
}

function copiaMaisNova(): string {
  const nomes = existsSync(PASTA)
    ? readdirSync(PASTA).filter((n) => n.startsWith("selebi-") && n.endsWith(".sql.gz")).sort()
    : [];
  const nome = nomes.at(-1);
  if (!nome) throw new Error(`Nenhuma cópia em ${PASTA}/ para testar. Rode npm run backup antes.`);
  return join(PASTA, nome);
}

async function main() {
  if (BANCO_TESTE === BANCO) throw new Error("O banco de teste não pode ter o nome do banco de produção.");

  const arquivo = process.argv[2] ?? copiaMaisNova();
  if (!existsSync(arquivo)) throw new Error(`Arquivo não encontrado: ${arquivo}`);

  let paraLer = arquivo;
  let temporario: string | null = null;
  if (arquivo.endsWith(".cifrado")) {
    const senha = senhaDoBackup();
    if (!senha) throw new Error("A cópia é cifrada e falta a BACKUP_SENHA.");
    temporario = `${arquivo.replace(/\.cifrado$/, "")}.teste`;
    await decifrar(arquivo, temporario, senha);
    paraLer = temporario;
  }

  console.log(`Restaurando ${arquivo} (${(statSync(arquivo).size / 1024 / 1024).toFixed(2)} MB) em ${BANCO_TESTE}...`);
  const inicio = Date.now();
  try {
    await psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${BANCO_TESTE}`]);
    await psql("postgres", ["-c", `CREATE DATABASE ${BANCO_TESTE}`]);
    await psql(BANCO_TESTE, ["-f", "-"], createReadStream(paraLer).pipe(createGunzip()));
    const segundos = Math.round((Date.now() - inicio) / 1000);

    const linhas: { tabela: string; copia: number | null; agora: number | null }[] = [];
    for (const tabela of TABELAS) {
      linhas.push({ tabela, copia: await contar(BANCO_TESTE, tabela), agora: await contar(BANCO, tabela) });
    }
    console.log(`\nRestaurou em ${segundos}s. Linhas na cópia × no banco de agora:`);
    for (const l of linhas) {
      console.log(`  ${l.tabela.padEnd(20)} ${String(l.copia ?? "—").padStart(8)} ${String(l.agora ?? "—").padStart(8)}`);
    }

    const faltando = linhas.filter((l) => ESSENCIAIS.has(l.tabela) && !(l.copia && l.copia > 0));
    if (faltando.length) {
      throw new Error(
        `A cópia restaurou, mas sem ${faltando.map((l) => l.tabela).join(" e ")} — ela não serviria numa emergência.`,
      );
    }

    writeFileSync(
      marcaDaRestauracao(mesAtual()),
      JSON.stringify({ quando: new Date().toISOString(), arquivo, segundos, linhas }, null, 2),
    );
    console.log("\nCópia restaurável. Teste do mês registrado.");
  } finally {
    await psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${BANCO_TESTE}`]).catch((e) =>
      console.error(`Não consegui apagar ${BANCO_TESTE}: ${e instanceof Error ? e.message : e}`),
    );
    if (temporario && existsSync(temporario)) unlinkSync(temporario);
  }
}

main().then(
  () => process.exit(0),
  (erro) => {
    console.error("\nO teste de restauração FALHOU:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
  },
);
