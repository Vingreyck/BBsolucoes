/**
 * Busca a tarifa homologada na API de dados abertos da ANEEL e guarda em
 * `tarifa_distribuidora` (cache). É o "Buscar tarifas?" do Solarz.
 *
 * - TE e TUSD: conjunto "Tarifas de aplicação das distribuidoras de energia
 *   elétrica" (um recurso só, com todas as resoluções).
 * - Fio B: conjunto "Componentes Tarifárias", um recurso por ano
 *   (`componentes-tarifarias-2026.csv`), componente `TUSD_FioB`.
 *
 * A API às vezes demora ou cai. Por isso: o que foi buscado há menos de 7 dias
 * e ainda está em vigor não é buscado de novo; se a ANEEL não responder, vale
 * o último guardado; sem nada guardado, a proposta usa a tarifa manual das
 * premissas. Só são enviados à ANEEL o CNPJ da distribuidora e o subgrupo.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";

import { CLASSE_NA_ANEEL, valorDaAneel, vigenteEm, type Subgrupo, type TarifaSemImpostos } from "./tarifas";

const API = "https://dadosabertos.aneel.gov.br/api/3/action";
const RECURSO_TARIFAS = "fcf2906c-7c32-4b9b-a637-054e7a5234f4";
/** Cada chamada espera no máximo isto: a ANEEL lenta não pode segurar a tela (vale o guardado). */
const ESPERA_MS = 12_000;
const VALIDADE_DO_CACHE_MS = 7 * 86_400_000;

async function chamar<T>(acao: string, parametros: Record<string, string>): Promise<T> {
  const url = `${API}/${acao}?${new URLSearchParams(parametros)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(ESPERA_MS), headers: { Accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`ANEEL respondeu ${r.status}`);
  const corpo = (await r.json()) as { success?: boolean; result?: T };
  if (!corpo.success || !corpo.result) throw new Error("ANEEL respondeu sem resultado");
  return corpo.result;
}

type Registro = Record<string, string>;

/** TE e TUSD da resolução em vigor. */
async function buscarTeTusd(cnpj: string, subgrupo: Subgrupo, hoje: string) {
  const c = CLASSE_NA_ANEEL[subgrupo];
  const r = await chamar<{ records: Registro[] }>("datastore_search", {
    resource_id: RECURSO_TARIFAS,
    filters: JSON.stringify({
      NumCNPJDistribuidora: cnpj,
      DscSubGrupo: subgrupo,
      DscModalidadeTarifaria: "Convencional",
      DscBaseTarifaria: "Tarifa de Aplicação",
      DscDetalhe: "Não se aplica",
      DscClasse: c.classe,
      DscSubClasse: c.subclasse,
    }),
    sort: "DatInicioVigencia desc",
    limit: "30",
  });
  const v = vigenteEm(r.records, hoje);
  if (!v) return null;
  const te = valorDaAneel(v.VlrTE);
  const tusd = valorDaAneel(v.VlrTUSD);
  if (te === null || tusd === null || te + tusd <= 0) return null;
  return { te, tusd, inicio: v.DatInicioVigencia, fim: v.DatFimVigencia || null, resolucao: v.DscREH || null };
}

/** A lista de arquivos de componentes muda uma vez por ano: guardada por um dia. */
let pacoteGuardado: { em: number; recursos: { id: string; name: string; format: string }[] } | null = null;

/** O recurso de componentes tarifárias do ano (ou do anterior, no começo do ano). */
async function recursoDeComponentes(ano: number): Promise<string[]> {
  if (!pacoteGuardado || Date.now() - pacoteGuardado.em > 86_400_000) {
    const r = await chamar<{ resources: { id: string; name: string; format: string }[] }>("package_show", { id: "componentes-tarifarias" });
    pacoteGuardado = { em: Date.now(), recursos: r.resources };
  }
  const pacote = { resources: pacoteGuardado.recursos };
  const doAno = (a: number) => pacote.resources.find((x) => x.format?.toUpperCase() === "CSV" && x.name.includes(String(a)))?.id;
  return [doAno(ano), doAno(ano - 1)].filter((x): x is string => Boolean(x));
}

/** O Fio B (TUSD_FioB) da mesma resolução. */
async function buscarFioB(cnpj: string, subgrupo: Subgrupo, inicio: string): Promise<number | null> {
  const c = CLASSE_NA_ANEEL[subgrupo];
  for (const recurso of await recursoDeComponentes(Number(inicio.slice(0, 4)))) {
    const r = await chamar<{ records: Registro[] }>("datastore_search", {
      resource_id: recurso,
      filters: JSON.stringify({
        NumCPFCNPJ: cnpj,
        DscSubGrupoTarifario: subgrupo,
        DscModalidadeTarifaria: "Convencional",
        DscBaseTarifaria: "Tarifa de Aplicação",
        DscClasseConsumidor: c.classe,
        DscSubClasseConsumidor: c.subclasse,
        DscDetalheConsumidor: "Não se aplica",
        DscComponenteTarifario: "TUSD_FioB",
        DatInicioVigencia: inicio,
      }),
      limit: "5",
    });
    const v = r.records[0] ? valorDaAneel(r.records[0].VlrComponenteTarifario) : null;
    if (v !== null && v > 0) return v;
  }
  return null;
}

/**
 * Só a busca na ANEEL, sem o cache: TE e TUSD da resolução em vigor e o Fio B
 * dela. Nulo se a distribuidora não tem tarifa para o subgrupo. Erro de rede
 * sobe (quem chama decide se usa o guardado).
 */
export async function buscarNaAneel(cnpj: string, subgrupo: Subgrupo, hoje = hojeEmSergipe()): Promise<TarifaSemImpostos | null> {
  const t = await buscarTeTusd(cnpj, subgrupo, hoje);
  if (!t) return null;
  let fioB: number | null = null;
  try {
    fioB = await buscarFioB(cnpj, subgrupo, t.inicio);
  } catch {
    fioB = null;
  }
  return { te: t.te, tusd: t.tusd, fioB, vigenciaInicio: t.inicio, vigenciaFim: t.fim, resolucao: t.resolucao };
}

function hojeEmSergipe(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export interface TarifaBuscada extends TarifaSemImpostos {
  /** Não veio da ANEEL agora: é a guardada no banco ou a da tabela do sistema. */
  guardada: boolean;
  /** Veio da tabela que vai junto com o sistema (`tarifas-aneel.json`). */
  daTabela?: boolean;
  buscadaEm: string;
}

/** A tabela de reserva, gerada por `npm run dados:tarifas` (ver `gerar-tarifas.ts`). */
export interface TabelaDeTarifas {
  fonte: string;
  geradoEm: string;
  tarifas: {
    cnpj: string;
    subgrupo: Subgrupo;
    te: number;
    tusd: number;
    fioB: number | null;
    inicio: string;
    fim: string | null;
    resolucao: string | null;
  }[];
}

let tabela: TabelaDeTarifas | null = null;

function tabelaDeTarifas(): TabelaDeTarifas {
  if (!tabela) {
    try {
      tabela = JSON.parse(readFileSync(path.join(process.cwd(), "src", "proposta", "tarifas-aneel.json"), "utf8")) as TabelaDeTarifas;
    } catch {
      tabela = { fonte: "", geradoEm: "", tarifas: [] };
    }
  }
  return tabela;
}

/** A tarifa da tabela do sistema: a resolução em vigor hoje (ou a última que já começou). */
export function tarifaDaTabela(cnpjBruto: string, subgrupo: Subgrupo, hoje = hojeEmSergipe()): TarifaBuscada | null {
  const cnpj = cnpjBruto.replace(/\D/g, "");
  const t = tabelaDeTarifas();
  const lista = t.tarifas
    .filter((x) => x.cnpj === cnpj && x.subgrupo === subgrupo)
    .map((x) => ({ ...x, DatInicioVigencia: x.inicio, DatFimVigencia: x.fim }));
  const v = vigenteEm(lista, hoje);
  if (!v) return null;
  return {
    te: v.te,
    tusd: v.tusd,
    fioB: v.fioB,
    vigenciaInicio: v.inicio,
    vigenciaFim: v.fim,
    resolucao: v.resolucao,
    guardada: true,
    daTabela: true,
    buscadaEm: `${t.geradoEm}T12:00:00.000Z`,
  };
}

/** Entre a guardada no banco e a da tabela, a que vale hoje e é mais nova. */
function melhorReserva(guardada: TarifaBuscada | null, daTabela: TarifaBuscada | null, hoje: string): TarifaBuscada | null {
  const vale = (t: TarifaBuscada | null) => Boolean(t && t.vigenciaInicio <= hoje && (!t.vigenciaFim || t.vigenciaFim >= hoje));
  const candidatas = [guardada, daTabela].filter((t): t is TarifaBuscada => t !== null);
  if (!candidatas.length) return null;
  const emVigor = candidatas.filter((t) => vale(t));
  const lista = emVigor.length ? emVigor : candidatas;
  return lista.sort((a, b) => (a.vigenciaInicio < b.vigenciaInicio ? 1 : -1))[0];
}

function daLinha(l: typeof schema.tarifaDistribuidora.$inferSelect, guardada: boolean): TarifaBuscada {
  return {
    te: Number(l.te),
    tusd: Number(l.tusd),
    fioB: l.fioB === null ? null : Number(l.fioB),
    vigenciaInicio: l.vigenciaInicio,
    vigenciaFim: l.vigenciaFim,
    resolucao: l.resolucao,
    guardada,
    buscadaEm: l.buscadoEm.toISOString(),
  };
}

/**
 * A tarifa da distribuidora (pelo CNPJ) no subgrupo, sem impostos. Nulo quando
 * nunca se conseguiu buscar. `forcar` ignora o cache (botão "Buscar de novo").
 */
export async function tarifaDaDistribuidora(cnpjBruto: string, subgrupo: Subgrupo, forcar = false): Promise<TarifaBuscada | null> {
  const cnpj = cnpjBruto.replace(/\D/g, "");
  if (cnpj.length !== 14) return null;
  const hoje = hojeEmSergipe();
  const [ultima] = await db
    .select()
    .from(schema.tarifaDistribuidora)
    .where(and(eq(schema.tarifaDistribuidora.cnpj, cnpj), eq(schema.tarifaDistribuidora.subgrupo, subgrupo)))
    .orderBy(desc(schema.tarifaDistribuidora.vigenciaInicio))
    .limit(1);
  const emVigor = ultima && ultima.vigenciaInicio <= hoje && (!ultima.vigenciaFim || ultima.vigenciaFim >= hoje);
  if (!forcar && ultima && emVigor && Date.now() - ultima.buscadoEm.getTime() < VALIDADE_DO_CACHE_MS) {
    return daLinha(ultima, false);
  }
  const reserva = () => melhorReserva(ultima ? daLinha(ultima, true) : null, tarifaDaTabela(cnpj, subgrupo, hoje), hoje);
  try {
    const t = await buscarNaAneel(cnpj, subgrupo, hoje);
    if (!t) return reserva();
    // O Fio B pode falhar sozinho: vale o guardado da mesma resolução.
    const fioB = t.fioB ?? (ultima?.vigenciaInicio === t.vigenciaInicio && ultima.fioB !== null ? Number(ultima.fioB) : null);
    const valores = {
      te: String(t.te),
      tusd: String(t.tusd),
      fioB: fioB === null ? null : String(fioB),
      vigenciaFim: t.vigenciaFim,
      resolucao: t.resolucao,
    };
    const [linha] = await db
      .insert(schema.tarifaDistribuidora)
      .values({ cnpj, subgrupo, vigenciaInicio: t.vigenciaInicio, ...valores })
      .onConflictDoUpdate({
        target: [schema.tarifaDistribuidora.cnpj, schema.tarifaDistribuidora.subgrupo, schema.tarifaDistribuidora.vigenciaInicio],
        set: { ...valores, buscadoEm: new Date() },
      })
      .returning();
    return daLinha(linha, false);
  } catch {
    return reserva();
  }
}

/** Sem ir à ANEEL: a guardada no banco ou a da tabela do sistema, a que valer hoje. */
export async function tarifaSemBuscar(cnpjBruto: string, subgrupo: Subgrupo): Promise<TarifaBuscada | null> {
  const cnpj = cnpjBruto.replace(/\D/g, "");
  const hoje = hojeEmSergipe();
  const [ultima] = await db
    .select()
    .from(schema.tarifaDistribuidora)
    .where(and(eq(schema.tarifaDistribuidora.cnpj, cnpj), eq(schema.tarifaDistribuidora.subgrupo, subgrupo)))
    .orderBy(desc(schema.tarifaDistribuidora.vigenciaInicio))
    .limit(1);
  const guardada = ultima ? daLinha(ultima, Date.now() - ultima.buscadoEm.getTime() >= VALIDADE_DO_CACHE_MS) : null;
  return melhorReserva(guardada, tarifaDaTabela(cnpj, subgrupo, hoje), hoje);
}
