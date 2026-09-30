import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { db, schema } from "@/db";

import { ErroOs, podeVer, type Ator } from "./acesso";
import { PRIORIDADE_PESO, type StatusOs, type TipoOs } from "./tipos";

/**
 * O que as telas leem da OS. Tudo por empresa, e o técnico só enxerga as dele.
 */

export const ABAS = {
  abertas: {
    rotulo: "Em aberto",
    status: ["aberta", "agendada", "em_deslocamento", "em_andamento", "aguardando_peca"],
  },
  a_agendar: { rotulo: "A agendar", status: ["aberta"] },
  agendadas: { rotulo: "Agendadas", status: ["agendada"] },
  em_campo: { rotulo: "Em campo", status: ["em_deslocamento", "em_andamento"] },
  pausadas: { rotulo: "Aguardando peça", status: ["aguardando_peca"] },
  concluidas: { rotulo: "Concluídas", status: ["concluida"] },
  canceladas: { rotulo: "Canceladas", status: ["cancelada"] },
  todas: { rotulo: "Todas", status: null },
} as const satisfies Record<string, { rotulo: string; status: readonly StatusOs[] | null }>;

export type Aba = keyof typeof ABAS;

export function ehAba(valor: string | undefined): valor is Aba {
  return !!valor && valor in ABAS;
}

function escopo(ator: Ator): SQL | undefined {
  return ator.gestao ? undefined : eq(schema.ordemServico.responsavelId, ator.id);
}

/**
 * Busca sem depender de acento nem de maiúscula, e sem extensão no Postgres:
 * "sao cristovao" acha "São Cristóvão".
 */
function semAcento(coluna: SQLWrapper): SQL {
  return sql`translate(lower(${coluna}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Quantas OS em cada situação — os números das abas. */
export async function contarPorStatus(ator: Ator): Promise<Record<string, number>> {
  const linhas = await db
    .select({ status: schema.ordemServico.status, n: count() })
    .from(schema.ordemServico)
    .where(and(eq(schema.ordemServico.empresaId, ator.empresaId), escopo(ator)))
    .groupBy(schema.ordemServico.status);
  return Object.fromEntries(linhas.map((l) => [l.status, Number(l.n)]));
}

export interface FiltrosOs {
  aba?: Aba;
  tipo?: TipoOs;
  responsavelId?: string;
  busca?: string;
  projetoId?: string;
  clienteId?: string;
}

export async function listarOs(ator: Ator, filtros: FiltrosOs = {}) {
  const condicoes: (SQL | undefined)[] = [eq(schema.ordemServico.empresaId, ator.empresaId), escopo(ator)];

  const aba = ABAS[filtros.aba ?? "abertas"];
  if (aba.status) condicoes.push(inArray(schema.ordemServico.status, [...aba.status]));
  if (filtros.tipo) condicoes.push(eq(schema.ordemServico.tipo, filtros.tipo));
  if (filtros.responsavelId === "ninguem") {
    condicoes.push(sql`${schema.ordemServico.responsavelId} IS NULL`);
  } else if (filtros.responsavelId) {
    condicoes.push(eq(schema.ordemServico.responsavelId, filtros.responsavelId));
  }
  if (filtros.projetoId) condicoes.push(eq(schema.ordemServico.projetoId, filtros.projetoId));
  if (filtros.clienteId) condicoes.push(eq(schema.ordemServico.clienteId, filtros.clienteId));

  const busca = filtros.busca ? normalizar(filtros.busca) : "";
  if (busca) {
    const numero = busca.replace(/^#/, "").replace(/^0+/, "");
    const padrao = `%${busca}%`;
    const clientes = db
      .select({ id: schema.cliente.id })
      .from(schema.cliente)
      .where(
        and(
          eq(schema.cliente.empresaId, ator.empresaId),
          or(
            sql`${semAcento(schema.cliente.nome)} like ${padrao}`,
            sql`${semAcento(sql`coalesce(${schema.cliente.cidade}, '')`)} like ${padrao}`,
            sql`regexp_replace(coalesce(${schema.cliente.cpfCnpj}, ''), '\\D', '', 'g') like ${`%${busca.replace(/\D/g, "") || "x"}%`}`,
          ),
        ),
      );
    condicoes.push(
      or(
        /^\d+$/.test(numero) ? eq(schema.ordemServico.numero, Number(numero)) : undefined,
        inArray(schema.ordemServico.clienteId, clientes),
        sql`${semAcento(schema.ordemServico.descricao)} like ${padrao}`,
      ),
    );
  }

  const encerradas =
    filtros.aba === "concluidas" || filtros.aba === "canceladas" || filtros.aba === "todas";
  const ordens = await db.query.ordemServico.findMany({
    where: and(...condicoes),
    with: {
      cliente: { columns: { id: true, nome: true, cidade: true, uf: true, telefone: true } },
      usina: { columns: { id: true, nome: true } },
      responsavel: { columns: { id: true, nome: true } },
      projeto: { columns: { id: true, titulo: true } },
      checklist: { columns: { obrigatorio: true, concluido: true } },
    },
    orderBy: desc(schema.ordemServico.numero),
    limit: encerradas ? 300 : undefined,
  });

  // Em aberto, a fila é por urgência: prioridade, depois o que vence ou está
  // marcado primeiro. Encerradas, pelo número mais recente.
  if (!encerradas) {
    ordens.sort((a, b) => {
      const p = (PRIORIDADE_PESO[a.prioridade] ?? 9) - (PRIORIDADE_PESO[b.prioridade] ?? 9);
      if (p) return p;
      const qa = (a.agendadaPara ?? a.prazoSla)?.getTime() ?? Infinity;
      const qb = (b.agendadaPara ?? b.prazoSla)?.getTime() ?? Infinity;
      return qa - qb || b.numero - a.numero;
    });
  }
  return ordens;
}

export type OsDaLista = Awaited<ReturnType<typeof listarOs>>[number];

/** A OS inteira, para a tela de detalhe e o relatório. */
export async function carregarOs(ator: Ator, id: string) {
  const os = await buscarCompleta(and(eq(schema.ordemServico.id, id), eq(schema.ordemServico.empresaId, ator.empresaId)));
  if (!os || !podeVer(ator, os)) throw new ErroOs("nao_encontrada", "Ordem de serviço não encontrada.", 404);
  return os;
}

/** Pelo link do relatório — sem sessão, só com a chave. */
export async function carregarPeloToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return (await buscarCompleta(eq(schema.ordemServico.relatorioToken, token))) ?? null;
}

function buscarCompleta(filtro: SQL | undefined) {
  return db.query.ordemServico.findFirst({
    where: filtro,
    with: {
      empresa: { columns: { id: true, nome: true } },
      cliente: true,
      usina: true,
      projeto: {
        columns: { id: true, titulo: true },
        with: { etapa: { columns: { nome: true, slug: true } } },
      },
      responsavel: { columns: { id: true, nome: true } },
      abertaPor: { columns: { id: true, nome: true } },
      osOrigem: { columns: { id: true, numero: true } },
      retornos: { columns: { id: true, numero: true, status: true } },
      checklist: {
        orderBy: asc(schema.osChecklistItem.ordem),
        with: {
          respondidoPor: { columns: { nome: true } },
          anexos: { orderBy: asc(schema.osAnexo.capturadoEm) },
        },
      },
      anexos: {
        orderBy: asc(schema.osAnexo.capturadoEm),
        with: { enviadoPor: { columns: { nome: true } } },
      },
      eventos: {
        orderBy: asc(schema.osEvento.ocorridoEm),
        with: { usuario: { columns: { nome: true } } },
      },
      alertas: true,
    },
  });
}

export type OsCompleta = NonNullable<Awaited<ReturnType<typeof buscarCompleta>>>;

export async function comentariosDaOs(empresaId: string, osId: string) {
  return db.query.comentario.findMany({
    where: and(
      eq(schema.comentario.empresaId, empresaId),
      eq(schema.comentario.entidade, "ordem_servico"),
      eq(schema.comentario.entidadeId, osId),
    ),
    with: { autor: { columns: { nome: true } } },
    orderBy: asc(schema.comentario.criadoEm),
  });
}

/**
 * Tempo em campo, somado pelos intervalos do histórico: de "iniciada" ou
 * "retomada" até "pausada", "concluída" ou "não atendida". Instalação de dois
 * dias soma os dois dias sem contar a noite no meio.
 */
export function tempoEmCampo(eventos: { tipo: string; ocorridoEm: Date }[]): {
  ms: number;
  inicio: Date | null;
  fim: Date | null;
} {
  let ms = 0;
  let aberto: Date | null = null;
  let inicio: Date | null = null;
  let fim: Date | null = null;
  for (const e of [...eventos].sort((a, b) => a.ocorridoEm.getTime() - b.ocorridoEm.getTime())) {
    if (e.tipo === "iniciada" || e.tipo === "retomada") {
      aberto ??= e.ocorridoEm;
      inicio ??= e.ocorridoEm;
    } else if (["pausada", "concluida", "nao_atendida"].includes(e.tipo) && aberto) {
      ms += e.ocorridoEm.getTime() - aberto.getTime();
      aberto = null;
      fim = e.ocorridoEm;
    }
  }
  return { ms, inicio, fim };
}

/**
 * A vistoria mais recente de uma venda, com as respostas — o que o engenheiro
 * lê antes de fazer o projeto. Concluída vem antes de em andamento: a
 * concluída é a que vale.
 */
export async function vistoriaDoProjeto(empresaId: string, projetoId: string) {
  const vistorias = await db.query.ordemServico.findMany({
    where: and(
      eq(schema.ordemServico.empresaId, empresaId),
      eq(schema.ordemServico.projetoId, projetoId),
      eq(schema.ordemServico.tipo, "vistoria"),
      sql`${schema.ordemServico.status} <> 'cancelada'`,
    ),
    with: {
      responsavel: { columns: { nome: true } },
      checklist: {
        orderBy: asc(schema.osChecklistItem.ordem),
        with: { anexos: { columns: { id: true } } },
      },
    },
    orderBy: desc(schema.ordemServico.numero),
  });
  return vistorias.find((v) => v.status === "concluida") ?? vistorias[0] ?? null;
}

/** Quem pode ser responsável por uma OS: técnicos primeiro. */
export async function responsaveisPossiveis(empresaId: string) {
  const usuarios = await db.query.usuario.findMany({
    where: and(
      eq(schema.usuario.empresaId, empresaId),
      eq(schema.usuario.ativo, true),
      inArray(schema.usuario.papel, ["tecnico", "engenheiro", "vendedor", "adm"]),
    ),
    columns: { id: true, nome: true, papel: true },
    orderBy: asc(schema.usuario.nome),
  });
  const peso: Record<string, number> = { tecnico: 0, vendedor: 1, engenheiro: 2, adm: 3 };
  return usuarios.sort((a, b) => (peso[a.papel] ?? 9) - (peso[b.papel] ?? 9) || a.nome.localeCompare(b.nome));
}

/**
 * A semana da agenda: as OS marcadas entre segunda e domingo, e a fila do que
 * ainda não tem data — o painel esquerdo do agendamento do IXC.
 */
export async function agendaDaSemana(ator: Ator, segunda: Date) {
  const domingoFim = new Date(segunda.getTime() + 7 * 86_400_000);
  const base = and(eq(schema.ordemServico.empresaId, ator.empresaId), escopo(ator));

  const colunas = {
    cliente: { columns: { id: true, nome: true, cidade: true } },
    responsavel: { columns: { id: true, nome: true } },
  } as const;

  const [marcadas, aAgendar, pessoas] = await Promise.all([
    db.query.ordemServico.findMany({
      where: and(
        base,
        gte(schema.ordemServico.agendadaPara, segunda),
        lt(schema.ordemServico.agendadaPara, domingoFim),
        sql`${schema.ordemServico.status} <> 'cancelada'`,
      ),
      with: colunas,
      orderBy: asc(schema.ordemServico.agendadaPara),
    }),
    db.query.ordemServico.findMany({
      where: and(base, eq(schema.ordemServico.status, "aberta")),
      with: colunas,
      orderBy: desc(schema.ordemServico.numero),
    }),
    ator.gestao ? responsaveisPossiveis(ator.empresaId) : Promise.resolve([]),
  ]);

  aAgendar.sort(
    (a, b) =>
      (PRIORIDADE_PESO[a.prioridade] ?? 9) - (PRIORIDADE_PESO[b.prioridade] ?? 9) ||
      (a.prazoSla?.getTime() ?? Infinity) - (b.prazoSla?.getTime() ?? Infinity),
  );

  return { marcadas, aAgendar, pessoas };
}
