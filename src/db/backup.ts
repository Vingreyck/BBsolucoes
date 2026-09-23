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
/**
 * Container do Postgres, ou vazio para falar pela rede.
 *
 * Vazio não é o mesmo que ausente: em produção o `docker-compose.yml` define
 * `PG_CONTAINER=""` de propósito, para o script cair no caminho de rede. Por
 * isso `??` não serve aqui — só o `undefined` vira "bb-pg".
 */
const CONTAINER = process.env.PG_CONTAINER === undefined ? "bb-pg" : process.env.PG_CONTAINER;
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

  /**
   * Dois jeitos de chamar o `pg_dump`, escolhidos pelo ambiente.
   *
   * Em desenvolvimento o Postgres está num container e o script roda no
   * Windows: `docker exec` evita precisar do cliente do Postgres instalado.
   *
   * Em produção é o contrário — o script roda **dentro** de um container, onde
   * não há Docker nenhum, e fala com o banco pela rede do compose. Por isso o
   * `docker-compose.yml` passa `PG_CONTAINER` vazio e `PG_HOST=db`.
   *
   * `--no-owner` e `--no-privileges` nos dois casos: o dump precisa restaurar
   * onde os papéis do Postgres têm outros nomes, e sem isso falha em cada
   * `ALTER TABLE ... OWNER TO`.
   */
  /**
   * `-w` nunca pergunta senha, e isso é o que separa "falhou" de "travou".
   *
   * Sem ele, o `pg_dump` sem credencial fica esperando no prompt **para
   * sempre** — e este script roda dentro de um laço de hora em hora, sem
   * ninguém olhando. Travado é pior que quebrado: quebrado aparece no log,
   * travado só some.
   */
  const comuns = ["--no-owner", "--no-privileges", "-w"];

  /**
   * Fora do `docker exec`, a conexão vem da **mesma** `DATABASE_URL` que a
   * aplicação usa. O `pg_dump` aceita a URI inteira, com usuário e senha
   * dentro, então não há uma segunda variável de senha para sair de sincronia
   * — foi exatamente o que travou a primeira versão: `PGPASSWORD` vinha vazio
   * porque `POSTGRES_PASSWORD` não chegava neste container.
   */
  const [programa, args] = CONTAINER
    ? ([
        "docker",
        ["exec", CONTAINER, "pg_dump", "-U", USUARIO, "-d", BANCO, ...comuns],
      ] as const)
    : ([
        "pg_dump",
        [
          process.env.DATABASE_URL ??
            `postgres://${USUARIO}@${process.env.PG_HOST ?? "db"}:5432/${BANCO}`,
          ...comuns,
        ],
      ] as const);

  let sql: string;
  try {
    // `maxBuffer` alto porque a saída vem inteira pela memória — com 13 MB de
    // banco sobra folga, e o padrão de 1 MB do Node estouraria.
    const { stdout } = await executar(programa, [...args], {
      maxBuffer: 512 * 1024 * 1024,
      encoding: "utf8",
      // Teto de tempo: um dump deste banco leva segundos. Passando disso é
      // sintoma, não lentidão.
      timeout: 5 * 60 * 1000,
    });
    sql = stdout;
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    /**
     * Diz o que fazer, em vez de repetir a mensagem do Postgres.
     *
     * "aborting because of server version mismatch" é críptico e tem uma causa
     * só: o `pg_dump` instalado é mais antigo que o servidor. Aconteceu aqui —
     * o Debian 12 traz o cliente 15 e o servidor é 16 —, e a falha some no log
     * de um laço que roda de hora em hora.
     */
    if (mensagem.includes("server version mismatch")) {
      console.error(
        "O pg_dump instalado é mais antigo que o servidor, e se recusa a copiar.\n\n" +
          "No container isso quer dizer que o postgresql-client-16 não entrou na\n" +
          "imagem — o Dockerfile o instala pelo repositório oficial do PostgreSQL\n" +
          "justamente porque o do Debian é o 15.\n\n" +
          mensagem,
      );
      process.exit(1);
    }

    console.error(
      `Falhou ao chamar o pg_dump (${programa}).\n\n` +
        (CONTAINER
          ? `Confira se o container "${CONTAINER}" está de pé: docker start ${CONTAINER}\n`
          : "Confira se o serviço `db` está de pé e se DATABASE_URL tem a senha.\n") +
        mensagem,
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

  // A instrução muda com o ambiente, como a própria cópia: em produção não há
  // Docker dentro do container, e imprimir `docker exec -i  psql` com o nome
  // vazio manda a pessoa colar um comando quebrado na pior hora possível.
  console.log(
    "\nPara restaurar:\n" +
      (CONTAINER
        ? `  gunzip -c ${destino} | docker exec -i ${CONTAINER} psql -U ${USUARIO} -d ${BANCO}`
        : `  gunzip -c ${destino} | docker compose exec -T db psql -U ${USUARIO} -d ${BANCO}`),
  );
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
