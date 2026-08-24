import "dotenv/config";

import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";

import { db, schema } from "../../db";

/**
 * Importa o Fault Log exportado do Growatt OSS.
 *
 * Origem: Plant Management List → Export → "Export Fault Log".
 * Aba `deviceEvent`, colunas: DeviceAlias, Serial Number, DeviceType, Date,
 * EventID, Description.
 *
 * Este é o arquivo que supre a lacuna da lista de usinas, que não exporta a
 * coluna "State" — sem ele não há como saber quais usinas deram problema.
 *
 * Atenção: o log é por **número de série de equipamento**, não por usina. Para
 * ligar uma falha à usina do cliente é preciso ter importado a Device List
 * antes. Falha de equipamento desconhecido é contada e reportada, não descartada
 * em silêncio.
 *
 *   python scripts/xls-para-csv.py "arquivo.xls"
 *   npm run import:falhas -- "arquivo.csv"
 */

const COLUNAS = {
  apelido: ["devicealias", "device alias"],
  serie: ["serial number", "serialnumber", "sn"],
  tipoDispositivo: ["devicetype", "device type"],
  data: ["date", "data"],
  evento: ["eventid", "event id"],
  descricao: ["description", "descricao", "descrição"],
} as const;

type Campo = keyof typeof COLUNAS;

const normalizar = (v: unknown) =>
  String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function comoData(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  // O OSS escreve "2026-08-24 14:32:10"; o T deixa o parse determinístico.
  const d = new Date(s.includes(" ") ? s.replace(" ", "T") : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function texto(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s === "" || s === "--" ? undefined : s;
}

import { classificarEvento } from "./codigos";

async function main() {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error(
      'Uso: npm run import:falhas -- "arquivo.csv"\n\n' +
        "Sai do OSS em Export → Export Fault Log, com Export All Data.\n" +
        "Escolha um intervalo de datas largo: um dia só costuma vir vazio.",
    );
    process.exit(1);
  }
  if (caminho.toLowerCase().endsWith(".xls")) {
    console.error(
      `Arquivo .xls não é lido direto. Converta:\n  python scripts/xls-para-csv.py "${caminho}"`,
    );
    process.exit(1);
  }

  const empresa = await db.query.empresa.findFirst();
  if (!empresa) {
    console.error("Nenhuma empresa no banco. Rode `npm run db:seed` primeiro.");
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  if (caminho.toLowerCase().endsWith(".csv")) await wb.csv.readFile(caminho);
  else await wb.xlsx.readFile(caminho);

  const planilha = wb.worksheets[0];
  if (!planilha) {
    console.error("Planilha vazia.");
    process.exit(1);
  }

  let linhaCabecalho = 0;
  const mapa = new Map<Campo, number>();
  for (let i = 1; i <= Math.min(6, planilha.rowCount); i++) {
    const celulas = planilha.getRow(i).values as unknown[];
    const parcial = new Map<Campo, number>();
    celulas.forEach((valor, indice) => {
      const c = normalizar(valor);
      for (const [campo, nomes] of Object.entries(COLUNAS) as [Campo, readonly string[]][]) {
        if (!parcial.has(campo) && nomes.includes(c)) parcial.set(campo, indice);
      }
    });
    if (parcial.has("serie") && parcial.has("data")) {
      linhaCabecalho = i;
      for (const [k, v] of parcial) mapa.set(k, v);
      break;
    }
  }

  if (!linhaCabecalho) {
    console.error(
      "Não reconheci o cabeçalho do Fault Log. Linhas vistas:\n  " +
        (planilha.getRow(2).values as unknown[]).filter(Boolean).map(String).join(" | "),
    );
    process.exit(1);
  }

  const linhasDados = planilha.rowCount - linhaCabecalho;
  console.log(`Cabeçalho na linha ${linhaCabecalho}. ${linhasDados} linhas de evento.\n`);

  if (linhasDados <= 0) {
    console.log(
      "O arquivo não tem nenhum evento. Reexporte o Fault Log com um intervalo\n" +
        "de datas mais largo — um único dia quase sempre vem vazio.",
    );
    process.exit(0);
  }

  // Número de série → usina, via equipamentos já cadastrados.
  const equipamentos = await db.query.equipamento.findMany();
  const porSerie = new Map(
    equipamentos.filter((e) => e.numeroSerie).map((e) => [e.numeroSerie!, e]),
  );

  const ler = (linha: ExcelJS.Row, campo: Campo) => {
    const i = mapa.get(campo);
    return i === undefined ? undefined : linha.getCell(i).value;
  };

  let gravados = 0;
  let semData = 0;
  let exigemVisita = 0;
  const seriesDesconhecidas = new Set<string>();
  const porDescricao = new Map<string, number>();
  const porClassificacao = new Map<string, number>();

  for (let n = linhaCabecalho + 1; n <= planilha.rowCount; n++) {
    const linha = planilha.getRow(n);
    const serie = texto(ler(linha, "serie"));
    const quando = comoData(ler(linha, "data"));
    if (!serie) continue;
    if (!quando) {
      semData++;
      continue;
    }

    const descricao = texto(ler(linha, "descricao")) ?? "Evento sem descrição";
    const codigo = texto(ler(linha, "evento")) ?? null;
    porDescricao.set(descricao, (porDescricao.get(descricao) ?? 0) + 1);

    const classe = classificarEvento(codigo, descricao);
    const chave = `${classe.severidade}${classe.exigeVisita ? " · visita" : ""} — ${classe.rotulo}`;
    porClassificacao.set(chave, (porClassificacao.get(chave) ?? 0) + 1);
    if (classe.exigeVisita) exigemVisita++;

    const equipamento = porSerie.get(serie);
    if (!equipamento) {
      seriesDesconhecidas.add(serie);
      continue;
    }

    await db
      .insert(schema.alerta)
      .values({
        empresaId: empresa.id,
        usinaId: equipamento.usinaId,
        tipo: "alarme_inversor",
        severidade: classe.severidade,
        // Guarda o rótulo traduzido e o texto original — a Growatt muda a
        // redação, e o texto cru é o que permite reclassificar depois.
        mensagem: `${classe.rotulo} — ${descricao}`,
        codigoFabricante: codigo,
        abertoEm: quando,
      })
      .onConflictDoNothing();
    gravados++;
  }

  console.log(`Alertas gravados:   ${gravados}`);
  if (semData) console.log(`Linhas sem data:    ${semData}`);

  console.log("\nClassificação dos eventos:");
  for (const [chave, n] of [...porClassificacao].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(n).padStart(4)}  ${chave}`);
  }

  if (exigemVisita) {
    console.log(
      `\n${exigemVisita} eventos são falha de hardware do inversor — pelo manual da` +
        "\nGrowatt, reiniciar e, persistindo, trocar placa de controle ou inversor." +
        "\nEsses não se resolvem sozinhos: exigem visita.",
    );
  }

  const naoClassificados = [...porClassificacao]
    .filter(([k]) => k.startsWith("info"))
    .reduce((s, [, n]) => s + n, 0);
  if (naoClassificados) {
    console.log(
      `\n${naoClassificados} eventos não bateram com nenhum código conhecido.` +
        "\nMe mande a lista abaixo que eu amplio a tabela de classificação:",
    );
    for (const [descricao, n] of [...porDescricao].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${String(n).padStart(4)}  ${descricao}`);
    }
  }

  if (seriesDesconhecidas.size) {
    console.log(
      `\n${seriesDesconhecidas.size} números de série não estão no cadastro, então` +
        "\nessas falhas ficaram sem usina. Exporte a Device List do OSS e importe" +
        "\nantes: é ela que liga equipamento a usina.",
    );
  }

  const [resumo] = await db
    .select({
      alertas: sql<number>`count(*)`,
      usinas: sql<number>`count(distinct ${schema.alerta.usinaId})`,
    })
    .from(schema.alerta);
  console.log(`\nNo banco: ${resumo.alertas} alertas em ${resumo.usinas} usinas.`);

  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
