import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/db";

import { diasDesde, type CandidatoDeProjeto } from "./sugestao-dono";

/**
 * O que está esperando a usina aparecer ou ser ligada: o banco por trás da tela
 * "Sem dono" e do número ao lado dela no menu.
 */

/** Depois de quantos dias de instalação concluída sem usina no portal vale o aviso. */
export const DIAS_PARA_AVISAR = 3;

/** Etapas em que a venda já foi instalada (ou está sendo): a usina deveria existir. */
const ETAPAS_DEPOIS_DA_INSTALACAO = ["execucao", "pedido_vistoria", "monitoramento", "pos-venda"];

export interface ProjetoSemUsina extends CandidatoDeProjeto {
  titulo: string;
  etapaSlug: string;
}

/**
 * As vendas instaladas (OS de instalação concluída, ou já nas etapas depois da
 * instalação) que ainda não têm usina. Em andamento ou concluídas: cancelada e
 * pausada não esperam nada.
 */
export async function projetosSemUsina(empresaId: string): Promise<ProjetoSemUsina[]> {
  const linhas = await db
    .select({
      projetoId: schema.projeto.id,
      titulo: schema.projeto.titulo,
      clienteId: schema.cliente.id,
      clienteNome: schema.cliente.nome,
      cidade: schema.cliente.cidade,
      etapaSlug: schema.etapa.slug,
      concluida: sql<string | null>`max(${schema.ordemServico.concluidaEm})`,
    })
    .from(schema.projeto)
    .innerJoin(schema.cliente, eq(schema.cliente.id, schema.projeto.clienteId))
    .innerJoin(schema.etapa, eq(schema.etapa.id, schema.projeto.etapaId))
    .leftJoin(
      schema.ordemServico,
      and(
        eq(schema.ordemServico.projetoId, schema.projeto.id),
        eq(schema.ordemServico.tipo, "instalacao"),
        eq(schema.ordemServico.status, "concluida"),
      ),
    )
    .where(
      and(
        eq(schema.projeto.empresaId, empresaId),
        isNull(schema.projeto.usinaId),
        inArray(schema.projeto.situacao, ["em_andamento", "concluido"]),
      ),
    )
    .groupBy(schema.projeto.id, schema.projeto.titulo, schema.cliente.id, schema.cliente.nome, schema.cliente.cidade, schema.etapa.slug);

  return linhas
    .map((l) => ({
      projetoId: l.projetoId,
      titulo: l.titulo,
      clienteId: l.clienteId,
      clienteNome: l.clienteNome,
      cidade: l.cidade,
      etapaSlug: l.etapaSlug,
      instalacaoConcluidaEm: l.concluida ? new Date(l.concluida) : null,
    }))
    .filter((p) => p.instalacaoConcluidaEm || ETAPAS_DEPOIS_DA_INSTALACAO.includes(p.etapaSlug));
}

export interface InstalacaoSemUsina extends ProjetoSemUsina {
  /** Dias desde que a OS de instalação foi concluída. */
  dias: number;
  /** Quantos seriais de inversor já foram anotados no projeto. */
  seriais: number;
}

/**
 * Instalação concluída há [DIAS_PARA_AVISAR] dias ou mais e nenhuma usina do
 * cliente apareceu: o técnico pode ter esquecido de criá-la no portal, ou ela é
 * de um fabricante que o Selebi ainda não coleta. Cliente que já tem alguma usina
 * em operação não entra (é aumento de sistema, ou a usina foi ligada à mão).
 */
export async function instalacoesSemUsina(empresaId: string, agora: Date = new Date()): Promise<InstalacaoSemUsina[]> {
  const atrasadas = (await projetosSemUsina(empresaId)).filter(
    (p) => p.instalacaoConcluidaEm && diasDesde(p.instalacaoConcluidaEm, agora) >= DIAS_PARA_AVISAR,
  );
  if (!atrasadas.length) return [];

  const comUsina = await db
    .selectDistinct({ clienteId: schema.usina.clienteId })
    .from(schema.usina)
    .where(
      and(
        eq(schema.usina.empresaId, empresaId),
        isNull(schema.usina.arquivadaEm),
        inArray(schema.usina.clienteId, atrasadas.map((p) => p.clienteId)),
      ),
    );
  const jaTem = new Set(comUsina.map((u) => u.clienteId));

  const seriais = await db
    .select({ projetoId: schema.serialInstalado.projetoId, n: count() })
    .from(schema.serialInstalado)
    .where(inArray(schema.serialInstalado.projetoId, atrasadas.map((p) => p.projetoId)))
    .groupBy(schema.serialInstalado.projetoId);
  const serialDe = new Map(seriais.map((s) => [s.projetoId, Number(s.n)]));

  return atrasadas
    .filter((p) => !jaTem.has(p.clienteId))
    .map((p) => ({ ...p, dias: diasDesde(p.instalacaoConcluidaEm!, agora), seriais: serialDe.get(p.projetoId) ?? 0 }))
    .sort((a, b) => b.dias - a.dias);
}

/** Usinas ativas sem cliente: o que a tela "Sem dono" lista. */
export async function contarOrfas(empresaId: string): Promise<number> {
  const [linha] = await db
    .select({ n: count() })
    .from(schema.usina)
    .where(and(eq(schema.usina.empresaId, empresaId), isNull(schema.usina.clienteId), isNull(schema.usina.arquivadaEm)));
  return Number(linha?.n ?? 0);
}

/** O número ao lado de "Sem dono" no menu: usinas sem dono mais instalações sem usina. */
export async function contarPendenciasDeUsina(empresaId: string): Promise<number> {
  const [orfas, instalacoes] = await Promise.all([contarOrfas(empresaId), instalacoesSemUsina(empresaId)]);
  return orfas + instalacoes.length;
}
