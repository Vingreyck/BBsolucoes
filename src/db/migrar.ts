import "dotenv/config";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

/**
 * Aplica as migrações de `drizzle/` que ainda não foram, em ordem, e anota cada
 * uma numa tabela (`migracao_aplicada`).
 *
 * Até aqui as migrações 0001 a 0014 eram coladas à mão no `psql`, e o registro do
 * drizzle só conhece a 0000: olhando o banco não dava para saber o que já rodou.
 * Agora cada arquivo `NNNN-nome.sql` roda uma vez, dentro de uma transação — se
 * der erro, nada daquele arquivo fica pela metade — e fica registrado.
 *
 *   npm run migrar                       aplica as pendentes
 *   npm run migrar -- --listar           só mostra o que está aplicado e o que falta
 *   npm run migrar -- --marcar-aplicadas anota todas como já aplicadas, sem rodar
 *
 * A primeira vez num banco que já recebeu as migrações à mão: `--marcar-aplicadas`.
 * A `0000_…` (gerada pelo drizzle-kit) não entra aqui, é do `db:migrate`.
 */

const PASTA = "drizzle";
const PADRAO = /^(\d{4})-.+\.sql$/;

function pendentes(todas: string[], aplicadas: Set<string>): string[] {
  return todas.filter((n) => !aplicadas.has(n));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta a DATABASE_URL.");
  const sql = postgres(url, { max: 1, onnotice: () => undefined });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS migracao_aplicada (
        arquivo text PRIMARY KEY,
        aplicada_em timestamptz NOT NULL DEFAULT now()
      )`;
    const aplicadas = new Set((await sql<{ arquivo: string }[]>`SELECT arquivo FROM migracao_aplicada`).map((l) => l.arquivo));
    const todas = readdirSync(PASTA).filter((n) => PADRAO.test(n)).sort();
    const faltam = pendentes(todas, aplicadas);

    if (process.argv.includes("--listar")) {
      for (const n of todas) console.log(`${aplicadas.has(n) ? "✓" : "·"} ${n}`);
      console.log(`\n${faltam.length} pendente(s).`);
      return;
    }

    if (process.argv.includes("--marcar-aplicadas")) {
      for (const n of faltam) await sql`INSERT INTO migracao_aplicada (arquivo) VALUES (${n}) ON CONFLICT DO NOTHING`;
      console.log(`${faltam.length} migração(ões) anotada(s) como já aplicadas. Nada foi executado.`);
      return;
    }

    if (!faltam.length) {
      console.log("Nenhuma migração pendente.");
      return;
    }
    for (const nome of faltam) {
      console.log(`Aplicando ${nome}...`);
      const conteudo = readFileSync(join(PASTA, nome), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(conteudo);
        await tx`INSERT INTO migracao_aplicada (arquivo) VALUES (${nome})`;
      });
    }
    console.log(`${faltam.length} migração(ões) aplicada(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((erro) => {
  console.error("\nA migração FALHOU (nada daquele arquivo foi gravado):", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
