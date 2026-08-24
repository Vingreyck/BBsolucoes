import "dotenv/config";

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { eq, isNull, sql } from "drizzle-orm";

import { db, schema } from "../../db";

/**
 * Importa a série de geração exportada do Growatt OSS.
 *
 * Origem: Plant Management List → Export → "Export System Power Generation
 * Data", com tipo Daily, Month ou Year report.
 *
 * O formato é largo: colunas fixas de identificação da usina e, a partir daí,
 * **uma coluna por data**, cujo cabeçalho é a própria data e o valor é a geração
 * em kWh daquele dia. Um Month report vira 30 colunas. Aqui isso é transposto
 * para uma linha por usina por dia na tabela `leitura`.
 *
 *   python scripts/xls-para-csv.py "arquivo.xls"
 *   npm run import:geracao -- "arquivo.csv"
 */

const CABECALHOS_FIXOS = new Set([
  "plantname",
  "useraccountname",
  "city",
  "devicecount",
  "createdate",
  "nominalpower",
  "devicesn",
  "alias",
  "model",
  "datalogsn",
  "totalequivalentgeneratinghours",
  "totalequivalentgener",
]);

/**
 * Colunas que só existem no relatório mensal, que é por equipamento.
 *
 * O relatório diário é por usina; o mensal desce ao dispositivo e traz número
 * de série, modelo, datalogger e potência nominal. Ou seja, ele é também a
 * Device List — e por isso este importador cadastra os equipamentos quando as
 * encontra, em vez de exigir um segundo arquivo.
 */
const COLUNAS_DISPOSITIVO = {
  serie: ["devicesn"],
  modelo: ["model"],
  datalogger: ["datalogsn"],
  potenciaW: ["nominalpower"],
} as const;

type CampoDispositivo = keyof typeof COLUNAS_DISPOSITIVO;

/**
 * Deduz o tipo pelo modelo. A linha NEO da Growatt é de microinversor; o resto
 * do que aparece no parque da BB é inversor string.
 */
function tipoPeloModelo(modelo: string | undefined, potenciaW: number | undefined) {
  if (modelo && /\bneo\b|micro/i.test(modelo)) return "microinversor" as const;
  if (potenciaW !== undefined && potenciaW > 0 && potenciaW < 3000) {
    return "microinversor" as const;
  }
  return "inversor" as const;
}

function normalizar(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function numero(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const n = Number(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

type Granularidade = "dia" | "mes" | "ano";

/**
 * Reconhece uma coluna de data e, junto, o que ela representa.
 *
 * O formato do cabeçalho é o que distingue as agregações: "2026-08-24" é o dia,
 * "2026-08" é o mês inteiro e "2026" é o ano. Ignorar essa diferença faz o total
 * de agosto entrar no banco parecendo a geração do dia 1º — foi exatamente o que
 * aconteceu na primeira importação do relatório de maio a agosto.
 */
function comoData(v: unknown): { data: Date; granularidade: Granularidade } | undefined {
  if (v instanceof Date) return { data: v, granularidade: "dia" };
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { data: new Date(`${s}T12:00:00Z`), granularidade: "dia" };
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    return { data: new Date(`${s}-01T12:00:00Z`), granularidade: "mes" };
  }
  if (/^\d{4}$/.test(s)) {
    return { data: new Date(`${s}-01-01T12:00:00Z`), granularidade: "ano" };
  }
  return undefined;
}

const ROTULO_GRANULARIDADE: Record<Granularidade, string> = {
  dia: "diária",
  mes: "mensal",
  ano: "anual",
};

async function main() {
  const argumentos = process.argv.slice(2);
  if (argumentos.length === 0) {
    console.error(
      'Uso: npm run import:geracao -- "arquivo.csv" ["outro.csv" ...]\n\n' +
        "Aceita vários arquivos ou uma pasta. O export do OSS sai preso à página\n" +
        "da tabela, então uma exportação por página é o caminho — e importar as\n" +
        "dez de uma vez resolve:\n\n" +
        '  npm run import:geracao -- dados/\n\n' +
        'Se vier .xls, converta antes: python scripts/xls-para-csv.py "arquivo.xls"',
    );
    process.exit(1);
  }

  // Aceita pasta: pega todo CSV e XLSX de dentro dela.
  const caminhos: string[] = [];
  for (const argumento of argumentos) {
    if (statSync(argumento).isDirectory()) {
      for (const nome of readdirSync(argumento).sort()) {
        if (/\.(csv|xlsx)$/i.test(nome)) caminhos.push(join(argumento, nome));
      }
    } else {
      caminhos.push(argumento);
    }
  }

  const xls = caminhos.filter((c) => c.toLowerCase().endsWith(".xls"));
  if (xls.length) {
    console.error(
      "Arquivos .xls não são lidos direto. Converta antes:\n" +
        xls.map((c) => `  python scripts/xls-para-csv.py "${c}"`).join("\n"),
    );
    process.exit(1);
  }

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  for (const [indice, caminho] of caminhos.entries()) {
    console.log(
      `${caminhos.length > 1 ? `\n[${indice + 1}/${caminhos.length}] ` : ""}${caminho}`,
    );
    await importarArquivo(caminho, empresa.id);
  }

  await resumoFinal();
  process.exit(0);
}

async function importarArquivo(caminho: string, empresaId: string) {
  const empresa = { id: empresaId };

  const wb = new ExcelJS.Workbook();
  if (caminho.toLowerCase().endsWith(".csv")) await wb.csv.readFile(caminho);
  else await wb.xlsx.readFile(caminho);

  const planilha = wb.worksheets[0];
  if (!planilha) {
    console.log("  Planilha vazia, pulando.");
    return;
  }

  // Acha a linha de cabeçalho: a que tem "plantName".
  let linhaCabecalho = 0;
  for (let i = 1; i <= Math.min(6, planilha.rowCount); i++) {
    const valores = planilha.getRow(i).values as unknown[];
    if (valores.some((v) => normalizar(v) === "plantname")) {
      linhaCabecalho = i;
      break;
    }
  }
  if (!linhaCabecalho) {
    console.log(
      "  Não achei a coluna 'plantName' — este não é o arquivo de geração." +
        "\n  A lista de usinas usa outro importador: npm run import:growatt",
    );
    return;
  }

  const cabecalhos = planilha.getRow(linhaCabecalho).values as unknown[];
  let colunaNome = 0;
  const colunasData: { indice: number; data: Date; granularidade: Granularidade }[] = [];
  const colunasDispositivo = new Map<CampoDispositivo, number>();

  cabecalhos.forEach((valor, indice) => {
    const texto = normalizar(valor);
    if (texto === "plantname") colunaNome = indice;
    for (const [campo, nomes] of Object.entries(COLUNAS_DISPOSITIVO) as [
      CampoDispositivo,
      readonly string[],
    ][]) {
      if (!colunasDispositivo.has(campo) && nomes.includes(texto)) {
        colunasDispositivo.set(campo, indice);
      }
    }
    if (CABECALHOS_FIXOS.has(texto)) return;
    const achado = comoData(valor);
    if (achado) colunasData.push({ indice, ...achado });
  });

  const porEquipamento = colunasDispositivo.has("serie");

  if (!colunaNome || colunasData.length === 0) {
    console.log(
      "  Nenhuma coluna de data no cabeçalho. Colunas vistas:\n    " +
        cabecalhos.filter(Boolean).map(String).join("\n    "),
    );
    return;
  }

  const primeira = colunasData[0].data.toISOString().slice(0, 10);
  const ultima = colunasData[colunasData.length - 1].data.toISOString().slice(0, 10);
  const granularidades = new Set(colunasData.map((c) => c.granularidade));
  console.log(
    `Cabeçalho na linha ${linhaCabecalho}. ` +
      `${colunasData.length} ${colunasData.length === 1 ? "coluna" : "colunas"} ` +
      `de agregação ${[...granularidades].map((g) => ROTULO_GRANULARIDADE[g]).join(" e ")}: ` +
      `${primeira} a ${ultima}`,
  );
  console.log(
    porEquipamento
      ? "Relatório por equipamento — os dispositivos também serão cadastrados.\n"
      : "Relatório por usina — sem número de série, leitura fica no nível da usina.\n",
  );

  // Usinas já cadastradas, indexadas pelo id externo do vínculo com a Growatt.
  const vinculos = await db.query.vinculoPortal.findMany({
    with: { contaPortal: true },
  });
  const porIdExterno = new Map(
    vinculos
      .filter((v) => v.contaPortal.fabricante === "growatt")
      .map((v) => [v.idExterno, v.usinaId]),
  );

  let gravadas = 0;
  let ignoradas = 0;
  let equipamentosNovos = 0;
  let dataloggersNovos = 0;
  const semCadastro = new Set<string>();
  const porModelo = new Map<string, number>();

  const lerDisp = (linha: ExcelJS.Row, campo: CampoDispositivo) => {
    const i = colunasDispositivo.get(campo);
    return i === undefined ? undefined : linha.getCell(i).value;
  };

  for (let n = linhaCabecalho + 1; n <= planilha.rowCount; n++) {
    const linha = planilha.getRow(n);
    const nomeUsina = String(linha.getCell(colunaNome).value ?? "").trim();
    if (!nomeUsina) continue;

    const usinaId = porIdExterno.get(nomeUsina);
    if (!usinaId) {
      semCadastro.add(nomeUsina);
      continue;
    }

    // Cadastra o equipamento quando o relatório é por dispositivo.
    let equipamentoId: string | null = null;
    if (porEquipamento) {
      const serie = String(lerDisp(linha, "serie") ?? "").trim();
      if (serie) {
        const modelo = String(lerDisp(linha, "modelo") ?? "").trim() || undefined;
        const potenciaW = numero(lerDisp(linha, "potenciaW"));
        if (modelo) porModelo.set(modelo, (porModelo.get(modelo) ?? 0) + 1);

        const existente = await db.query.equipamento.findFirst({
          where: eq(schema.equipamento.numeroSerie, serie),
        });
        if (existente) {
          equipamentoId = existente.id;
        } else {
          const [novo] = await db
            .insert(schema.equipamento)
            .values({
              empresaId: empresa.id,
              usinaId,
              tipo: tipoPeloModelo(modelo, potenciaW),
              fabricante: "Growatt",
              modelo,
              numeroSerie: serie,
              potenciaW: potenciaW !== undefined ? String(potenciaW) : null,
            })
            .returning();
          equipamentoId = novo.id;
          equipamentosNovos++;
        }

        // O datalogger é o que mais falha em campo, então vale cadastrar à parte.
        const datalogger = String(lerDisp(linha, "datalogger") ?? "").trim();
        if (datalogger) {
          const jaTem = await db.query.equipamento.findFirst({
            where: eq(schema.equipamento.numeroSerie, datalogger),
          });
          if (!jaTem) {
            await db.insert(schema.equipamento).values({
              empresaId: empresa.id,
              usinaId,
              tipo: "datalogger",
              fabricante: "Growatt",
              numeroSerie: datalogger,
            });
            dataloggersNovos++;
          }
        }
      }
    }

    for (const { indice, data, granularidade } of colunasData) {
      const kwh = numero(linha.getCell(indice).value);
      if (kwh === undefined) {
        ignoradas++;
        continue;
      }

      // Reimportar o mesmo período atualiza em vez de duplicar. A Growatt
      // corrige número retroativamente quando um datalogger sincroniza atrasado.
      // Os dois alvos de conflito são diferentes porque nulos não colidem no
      // Postgres — leitura de usina tem índice parcial próprio.
      const valores = {
        empresaId: empresa.id,
        usinaId,
        equipamentoId,
        medidoEm: data,
        granularidade,
        energiaKwh: String(kwh),
      };
      const atualizar = { energiaKwh: String(kwh), coletadoEm: new Date() };

      if (equipamentoId) {
        await db.insert(schema.leitura).values(valores).onConflictDoUpdate({
          target: [
            schema.leitura.equipamentoId,
            schema.leitura.medidoEm,
            schema.leitura.granularidade,
          ],
          set: atualizar,
        });
      } else {
        await db
          .insert(schema.leitura)
          .values(valores)
          .onConflictDoUpdate({
            target: [
              schema.leitura.usinaId,
              schema.leitura.medidoEm,
              schema.leitura.granularidade,
            ],
            targetWhere: isNull(schema.leitura.equipamentoId),
            set: atualizar,
          });
      }
      gravadas++;
    }
  }

  const partes = [`${gravadas} leituras`];
  if (equipamentosNovos) partes.push(`${equipamentosNovos} equipamentos`);
  if (dataloggersNovos) partes.push(`${dataloggersNovos} dataloggers`);
  console.log(`  ${partes.join(", ")}`);

  if (porModelo.size) {
    console.log(
      `  modelos: ${[...porModelo]
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m} (${n})`)
        .join(", ")}`,
    );
  }

  if (semCadastro.size) {
    console.log(
      `  ${semCadastro.size} usinas fora do cadastro — rode npm run import:growatt antes`,
    );
  }
}

/**
 * Somar granularidades diferentes daria número sem sentido, então o resumo sai
 * separado por agregação.
 */
async function resumoFinal() {
  const resumo = await db
    .select({
      granularidade: schema.leitura.granularidade,
      usinas: sql<number>`count(distinct ${schema.leitura.usinaId})`,
      leituras: sql<number>`count(*)`,
      total: sql<string>`coalesce(sum(${schema.leitura.energiaKwh}), 0)`,
    })
    .from(schema.leitura)
    .groupBy(schema.leitura.granularidade);

  console.log("\nNo banco:");
  for (const r of resumo) {
    console.log(
      `  ${ROTULO_GRANULARIDADE[r.granularidade].padEnd(8)} ` +
        `${String(r.leituras).padStart(6)} leituras · ${String(r.usinas).padStart(3)} usinas · ` +
        `${Number(r.total).toFixed(1)} kWh`,
    );
  }
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
