import "dotenv/config";

import { execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { promisify } from "node:util";

/**
 * Cópia de segurança do banco.
 *
 * Existia um buraco simples e grave: **não havia backup nenhum**. Disco falhar
 * significava perder 2.788 documentos catalogados, 187 dossiês e todo o
 * histórico de geração. Os PDFs sobreviveriam, porque moram no Drive; o
 * trabalho de catalogar, montar dossiê e ler os portais, não.
 *
 * Roda pelo `docker exec` de propósito, e não com um `pg_dump` da máquina: é
 * assim que funciona igual aqui no Windows e lá na VM Ubuntu, sem depender de
 * ter o cliente do Postgres instalado nem de a porta estar publicada.
 *
 *   npm run backup
 *   npm run backup -- --manter 30
 */

const executar = promisify(execFile);

const PASTA = "backups";
const CONTAINER = process.env.PG_CONTAINER ?? "bb-pg";
const BANCO = process.env.PG_DATABASE ?? "bbsolucoes";
const USUARIO = process.env.PG_USER ?? "postgres";

/** Quantos dias de cópia ficam guardados. */
const MANTER_PADRAO = 14;

/**
 * Abaixo disto o arquivo não é backup, é erro que passou batido.
 *
 * `pg_dump` falhando devolve um arquivo pequeno e um código de saída que nem
 * sempre chega até aqui. Um dump real deste banco passa de 100 KB comprimido.
 * Backup vazio é pior que backup nenhum: dá a sensação de estar protegido.
 */
const TAMANHO_MINIMO = 20 * 1024;

function agora(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Existe cópia de hoje? É o que deixa a rodada de hora em hora barata. */
export function temBackupDeHoje(): boolean {
  if (!existsSync(PASTA)) return false;
  const hoje = agora().slice(0, 10);
  return readdirSync(PASTA).some((n) => n.startsWith(`selebi-${hoje}`));
}

async function main() {
  const i = process.argv.indexOf("--manter");
  const manter = i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || MANTER_PADRAO) : MANTER_PADRAO;

  if (process.argv.includes("--se-preciso") && temBackupDeHoje()) {
    console.log("Já existe cópia de hoje. Nada a fazer.");
    process.exit(0);
  }

  mkdirSync(PASTA, { recursive: true });
  const destino = join(PASTA, `selebi-${agora()}.sql.gz`);

  console.log(`Copiando ${BANCO} de ${CONTAINER}...`);

  let sql: string;
  try {
    /**
     * `--no-owner` e `--no-privileges`: o dump precisa restaurar numa máquina
     * onde os papéis do Postgres têm outros nomes. Sem isso, restaurar na VM
     * falha em cada `ALTER TABLE ... OWNER TO`.
     *
     * `maxBuffer` alto porque a saída vem inteira pela memória — com 13 MB de
     * banco sobra folga, e o padrão de 1 MB do Node estouraria.
     */
    const { stdout } = await executar(
      "docker",
      ["exec", CONTAINER, "pg_dump", "-U", USUARIO, "-d", BANCO, "--no-owner", "--no-privileges"],
      { maxBuffer: 512 * 1024 * 1024, encoding: "utf8" },
    );
    sql = stdout;
  } catch (erro) {
    console.error(
      "Falhou ao chamar o pg_dump.\n\n" +
        `Confira se o container "${CONTAINER}" está de pé: docker start ${CONTAINER}\n` +
        (erro instanceof Error ? erro.message : String(erro)),
    );
    process.exit(1);
  }

  // Confere o conteúdo antes de gravar: dump bom termina com a marca do Postgres.
  if (!sql.includes("PostgreSQL database dump complete")) {
    console.error(
      "O pg_dump devolveu algo que não parece um dump completo. Nada foi gravado.",
    );
    process.exit(1);
  }

  await new Promise<void>((resolve, reject) => {
    const saida = createWriteStream(destino);
    const gzip = createGzip({ level: 9 });
    gzip.pipe(saida);
    saida.on("finish", resolve);
    saida.on("error", reject);
    gzip.on("error", reject);
    gzip.end(sql);
  });

  const tamanho = statSync(destino).size;
  if (tamanho < TAMANHO_MINIMO) {
    unlinkSync(destino);
    console.error(
      `O arquivo saiu com ${tamanho} bytes, pequeno demais para ser um backup ` +
        "deste banco. Apagado, para não dar falsa sensação de segurança.",
    );
    process.exit(1);
  }

  console.log(`  ${destino}  ${(tamanho / 1024 / 1024).toFixed(2)} MB`);

  // Limpa o que passou da janela.
  let apagados = 0;
  const limite = Date.now() - manter * 86_400_000;
  for (const nome of readdirSync(PASTA)) {
    if (!nome.startsWith("selebi-") || !nome.endsWith(".sql.gz")) continue;
    const caminho = join(PASTA, nome);
    if (statSync(caminho).mtimeMs < limite) {
      unlinkSync(caminho);
      apagados++;
    }
  }

  const guardados = readdirSync(PASTA).filter((n) => n.endsWith(".sql.gz")).length;
  console.log(
    `Guardadas ${guardados} cópias${apagados ? `, ${apagados} apagadas por passar de ${manter} dias` : ""}.`,
  );

  console.log(
    "\nPara restaurar:\n" +
      `  gunzip -c ${destino} | docker exec -i ${CONTAINER} psql -U ${USUARIO} -d ${BANCO}`,
  );
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
