import "dotenv/config";

import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";

import { db, schema } from "../../db";

/**
 * Importa a lista de dispositivos exportada do Growatt OSS.
 *
 * Sai em *Monitoring & Management → Device List → Export data → Export the
 * device data*, escolhendo o propósito **Operation and Maintenance** — que é
 * também o único uso que o contrato da API permite.
 *
 * Esta exportação entrega o que a OpenAPI entregaria e o token ainda não vê:
 * número de série do inversor, datalogger, modelo, potência nominal, estado de
 * comunicação e **quando cada aparelho falou pela última vez**. É desse último
 * campo que sai o alerta mais valioso do sistema — o de usina muda há meses sem
 * ninguém ter percebido.
 *
 * Idempotente: casa equipamento pelo número de série e alerta pelo instante em
 * que o aparelho parou, então reimportar não duplica nada.
 *
 *   npm run import:dispositivos -- "dados/dispositivos_2026-09-10.csv"
 */

const COLUNAS = {
  serie: ["device sn", "sn do dispositivo", "numero de serie"],
  modelo: ["model", "modelo"],
  tipo: ["type", "tipo"],
  usina: ["affiliated plant", "plant", "usina"],
  datalogger: ["datalogger", "collector", "coletor"],
  potenciaW: ["rated power", "potencia nominal"],
  estado: ["state", "estado", "status"],
  ultimaSubida: ["lastest upgrade time", "latest upgrade time", "ultima atualizacao"],
  versao: ["software version", "version", "versao"],
} as const;

type Campo = keyof typeof COLUNAS;

function normalizar(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function texto(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s === "" || s === "--" ? undefined : s;
}

function numero(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const n = Number(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function data(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  // "2026-09-10 09:26:07" — o T deixa o Date entender sem depender do locale.
  const d = new Date(s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Microinversor ou inversor de string.
 *
 * A coluna "Type" do OSS diz "MIN/MIC" e "MAX/MID", que são famílias comerciais
 * e não dizem o que o aparelho é. Quem diz é o modelo: a linha **NEO** da
 * Growatt é de microinversores, e são 72 dos 201 aqui. A diferença importa no
 * campo, porque microinversor fica no telhado, um por painel, e a visita é outra.
 */
function tipoEquipamento(modelo: string | undefined) {
  return /^\s*neo/i.test(modelo ?? "") ? ("microinversor" as const) : ("inversor" as const);
}

function mapearColunas(planilha: ExcelJS.Worksheet) {
  for (let linha = 1; linha <= Math.min(10, planilha.rowCount); linha++) {
    const celulas = planilha.getRow(linha).values as unknown[];
    const mapa = new Map<Campo, number>();
    const prioridade = new Map<Campo, number>();

    celulas.forEach((valor, indice) => {
      const cabecalho = normalizar(valor);
      if (!cabecalho) return;
      for (const [campo, nomes] of Object.entries(COLUNAS) as [Campo, readonly string[]][]) {
        const posicao = nomes.findIndex(
          (n) => cabecalho === n || cabecalho.startsWith(n),
        );
        if (posicao === -1) continue;
        const atual = prioridade.get(campo);
        if (atual === undefined || posicao < atual) {
          mapa.set(campo, indice);
          prioridade.set(campo, posicao);
        }
      }
    });

    if (mapa.has("serie") && mapa.has("usina")) return { linhaCabecalho: linha, mapa };
  }
  return null;
}

async function main() {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error(
      'Uso: npm run import:dispositivos -- "dados/dispositivos.csv"\n\n' +
        "O arquivo sai do oss.growatt.com, em Monitoring & Management →\n" +
        "Device List → Export data → Export the device data.\n" +
        "Vem em .xls: converta antes com\n" +
        "  python scripts/xls-para-csv.py \"dados/arquivo.xls\"",
    );
    process.exit(1);
  }

  if (caminho.toLowerCase().endsWith(".xls")) {
    console.error(
      "Este arquivo é .xls (Excel 97-2003), que o leitor não abre.\n" +
        `Converta antes: python scripts/xls-para-csv.py "${caminho}"`,
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
    console.error("A planilha está vazia.");
    process.exit(1);
  }

  const achado = mapearColunas(planilha);
  if (!achado) {
    console.error(
      "Não reconheci o cabeçalho. Primeiras linhas:\n  " +
        [1, 2, 3]
          .map((n) => (planilha.getRow(n).values as unknown[]).filter(Boolean).join(" | "))
          .join("\n  "),
    );
    process.exit(1);
  }

  const { linhaCabecalho, mapa } = achado;
  const ler = (linha: ExcelJS.Row, campo: Campo) => {
    const i = mapa.get(campo);
    if (i === undefined) return undefined;
    const c = linha.getCell(i).value;
    return c !== null && typeof c === "object" && "result" in c
      ? (c as { result: unknown }).result
      : c;
  };

  // Índice das usinas da Growatt pelo nome que o portal usa como id externo.
  const conta = await db.query.contaPortal.findFirst({
    where: and(
      eq(schema.contaPortal.empresaId, empresa.id),
      eq(schema.contaPortal.fabricante, "growatt"),
    ),
  });
  if (!conta) {
    console.error(
      "Nenhuma conta Growatt no banco. Rode `npm run import:growatt` com a\n" +
        "Plant List antes — os dispositivos precisam das usinas já cadastradas.",
    );
    process.exit(1);
  }

  const vinculos = await db.query.vinculoPortal.findMany({
    where: eq(schema.vinculoPortal.contaPortalId, conta.id),
  });
  const usinaPorNome = new Map(vinculos.map((v) => [v.idExterno, v.usinaId]));

  let inversores = 0;
  let dataloggers = 0;
  let jaExistiam = 0;
  let alertas = 0;
  const semUsina: string[] = [];
  const paradas: { nome: string; desde: Date; modelo: string; dias: number }[] = [];

  for (let n = linhaCabecalho + 1; n <= planilha.rowCount; n++) {
    const linha = planilha.getRow(n);
    const serie = texto(ler(linha, "serie"));
    const nomeUsina = texto(ler(linha, "usina"));
    if (!serie || !nomeUsina) continue;

    const usinaId = usinaPorNome.get(nomeUsina);
    if (!usinaId) {
      semUsina.push(nomeUsina);
      continue;
    }

    const modelo = texto(ler(linha, "modelo"));
    const potencia = numero(ler(linha, "potenciaW"));
    const versao = texto(ler(linha, "versao"));

    const existente = await db.query.equipamento.findFirst({
      where: and(
        eq(schema.equipamento.empresaId, empresa.id),
        eq(schema.equipamento.numeroSerie, serie),
      ),
    });

    if (existente) {
      await db
        .update(schema.equipamento)
        .set({
          modelo: modelo ?? existente.modelo,
          potenciaW: potencia !== undefined ? String(potencia) : existente.potenciaW,
        })
        .where(eq(schema.equipamento.id, existente.id));
      jaExistiam++;
    } else {
      await db.insert(schema.equipamento).values({
        empresaId: empresa.id,
        usinaId,
        tipo: tipoEquipamento(modelo),
        fabricante: "Growatt",
        modelo,
        numeroSerie: serie,
        potenciaW: potencia !== undefined ? String(potencia) : null,
      });
      inversores++;
    }

    // O datalogger é peça separada e é o que mais cai em campo — é ele que
    // explica a usina "sumir" com o inversor inteiro.
    const dlSn = texto(ler(linha, "datalogger"));
    if (dlSn && dlSn !== serie) {
      const temDl = await db.query.equipamento.findFirst({
        where: and(
          eq(schema.equipamento.empresaId, empresa.id),
          eq(schema.equipamento.numeroSerie, dlSn),
        ),
      });
      if (!temDl) {
        await db.insert(schema.equipamento).values({
          empresaId: empresa.id,
          usinaId,
          tipo: "datalogger",
          fabricante: "Growatt",
          modelo: versao ? `firmware ${versao}` : null,
          numeroSerie: dlSn,
        });
        dataloggers++;
      }
    }

    const estado = texto(ler(linha, "estado"));
    if (estado && !/online/i.test(estado)) {
      const desde = data(ler(linha, "ultimaSubida"));
      const dias = desde
        ? Math.floor((Date.now() - desde.getTime()) / 86_400_000)
        : 0;

      /**
       * `abertoEm` é o instante em que o aparelho falou pela última vez, não a
       * hora da importação. É o que faz o alerta dizer "parada há 384 dias" em
       * vez de "aberta agora", e é também o que impede duplicata: reimportar a
       * mesma exportação repete a mesma chave.
       */
      const resultado = await db
        .insert(schema.alerta)
        .values({
          empresaId: empresa.id,
          usinaId,
          tipo: "sem_comunicacao",
          severidade: dias >= 7 ? "critico" : "atencao",
          mensagem:
            `${modelo ?? "Inversor"} ${serie} sem comunicação` +
            (desde
              ? ` desde ${desde.toLocaleDateString("pt-BR")} (${dias} dias)`
              : "") +
            ", segundo o portal da Growatt",
          codigoFabricante: "growatt-offline",
          abertoEm: desde ?? new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: schema.alerta.id });

      if (resultado.length) alertas++;
      if (desde) {
        paradas.push({ nome: nomeUsina, desde, modelo: modelo ?? "—", dias });
      }
    }
  }

  /**
   * Não carimba `ultimaColetaEm`, e isso é correção de um bug real.
   *
   * O campo existe para uma coisa só: a trava de cadência que impede o coletor
   * de estourar o limite da API. Uma planilha não gasta chamada nenhuma, então
   * carimbar aqui mente para essa trava.
   *
   * E não foi teoria. Esta importação roda **antes** da coleta no
   * `npm run atualizar`, e o coletor da OpenAPI via "coletado há 0 minutos" em
   * toda rodada — a Growatt, 86% do parque, nunca seria coletada pela API, em
   * silêncio, com o resumo mostrando ✓ em tudo.
   *
   * Só o que fala com o portal carimba.
   */
  await db
    .update(schema.contaPortal)
    .set({ ultimoErro: null })
    .where(eq(schema.contaPortal.id, conta.id));

  console.log(`Inversores novos:      ${inversores}`);
  console.log(`Dataloggers novos:     ${dataloggers}`);
  console.log(`Já cadastrados:        ${jaExistiam} (atualizados)`);
  console.log(`Alertas abertos:       ${alertas}`);

  if (semUsina.length) {
    const unicos = [...new Set(semUsina)];
    console.log(
      `\n${semUsina.length} dispositivos de ${unicos.length} usinas que não estão` +
        " no banco.\nRode `npm run import:growatt` com a Plant List primeiro:",
    );
    for (const u of unicos.slice(0, 10)) console.log(`  ${u}`);
    if (unicos.length > 10) console.log(`  ... e mais ${unicos.length - 10}`);
  }

  if (paradas.length) {
    console.log(`\n${paradas.length} usinas sem comunicação, da mais antiga:`);
    for (const p of paradas.sort((a, b) => b.dias - a.dias)) {
      console.log(
        `  ${String(p.dias).padStart(4)} dias  ${p.nome.padEnd(24)} ${p.modelo}`,
      );
    }
  }

  process.exit(0);
}

main().catch((erro) => {
  console.error("Falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
