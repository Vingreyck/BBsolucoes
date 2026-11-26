import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { ErroOs, podeExecutar, type Ator } from "@/os/acesso";
import { numeroOs } from "@/os/tipos";

import { arredondar, diferencaDaBaixa, quantidadeValida } from "./regras";

/**
 * A baixa do estoque pela OS.
 *
 * O técnico registra o material usado (no site ou no app) e o estoque desconta
 * na hora. A fonte da verdade é a lista `os_material`; o livro de movimentos
 * acompanha por diferença (`diferencaDaBaixa`): registrou, sai; corrigiu para
 * menos ou tirou, estorna; cancelou a OS, tudo volta; reabriu, sai de novo.
 * Nada se apaga do livro — o histórico mostra a saída e o estorno.
 *
 * Material registrado numa OS que já fechou só a gestão corrige (o técnico
 * esqueceu de anotar e avisou o escritório). OS cancelada não aceita material.
 */

type Transacao = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const OBSERVACAO_MAXIMO = 500;

function violouUnico(erro: unknown, indice: string): boolean {
  let atual: unknown = erro;
  for (let i = 0; i < 4 && atual; i++) {
    const e = atual as { code?: string; constraint_name?: string; message?: string; cause?: unknown };
    if (e.code === "23505" && (e.constraint_name === indice || e.message?.includes(indice))) return true;
    atual = e.cause;
  }
  return false;
}

interface OsParaBaixa {
  id: string;
  empresaId: string;
  numero: number;
  status: string;
}

/**
 * Lança no livro o que falta para o estoque bater com o material da OS.
 * Chamada dentro da transação de quem mudou o material ou a situação da OS —
 * `status` é a situação que a OS fica depois da mudança.
 */
export async function sincronizarBaixa(tx: Transacao, os: OsParaBaixa, ator: Ator): Promise<number> {
  const usado = new Map<string, number>();
  if (os.status !== "cancelada") {
    const linhas = await tx
      .select({ itemId: schema.osMaterial.itemId, total: sql<string>`sum(${schema.osMaterial.quantidade})` })
      .from(schema.osMaterial)
      .where(eq(schema.osMaterial.ordemServicoId, os.id))
      .groupBy(schema.osMaterial.itemId);
    for (const l of linhas) usado.set(l.itemId, arredondar(Number(l.total)));
  }

  const lancado = new Map<string, number>();
  const livro = await tx
    .select({ itemId: schema.movimentoEstoque.itemId, total: sql<string>`sum(${schema.movimentoEstoque.quantidade})` })
    .from(schema.movimentoEstoque)
    .where(
      and(
        eq(schema.movimentoEstoque.ordemServicoId, os.id),
        inArray(schema.movimentoEstoque.motivo, ["os", "estorno"]),
      ),
    )
    .groupBy(schema.movimentoEstoque.itemId);
  // O livro guarda a saída como negativo; o que já saiu é o oposto da soma.
  for (const l of livro) lancado.set(l.itemId, arredondar(-Number(l.total)));

  const lancamentos = diferencaDaBaixa(usado, lancado);
  if (!lancamentos.length) return 0;
  await tx.insert(schema.movimentoEstoque).values(
    lancamentos.map((l) => ({
      empresaId: os.empresaId,
      itemId: l.itemId,
      quantidade: String(l.quantidade),
      motivo: l.motivo,
      ordemServicoId: os.id,
      observacao:
        l.motivo === "os"
          ? `Usado na OS ${numeroOs(os.numero)}`
          : os.status === "cancelada"
            ? `OS ${numeroOs(os.numero)} cancelada`
            : `Correção na OS ${numeroOs(os.numero)}`,
      usuarioId: ator.origem === "sistema" ? null : ator.id,
      origem: ator.origem,
    })),
  );
  return lancamentos.length;
}

/** Abre a OS para mexer no material, travada até o fim da transação. */
async function osParaMaterial(tx: Transacao, ator: Ator, osId: string) {
  const [os] = await tx
    .select({
      id: schema.ordemServico.id,
      empresaId: schema.ordemServico.empresaId,
      numero: schema.ordemServico.numero,
      status: schema.ordemServico.status,
      responsavelId: schema.ordemServico.responsavelId,
    })
    .from(schema.ordemServico)
    .where(and(eq(schema.ordemServico.id, osId), eq(schema.ordemServico.empresaId, ator.empresaId)))
    .for("update");
  if (!os || !podeExecutar(ator, os)) throw new ErroOs("nao_encontrada", "Ordem de serviço não encontrada.", 404);
  if (os.status === "cancelada") {
    throw new ErroOs("transicao_invalida", "A OS está cancelada: o material dela já voltou para o estoque.", 409);
  }
  if (os.status === "concluida" && !ator.gestao) {
    throw new ErroOs("transicao_invalida", "A OS já foi concluída. Peça ao escritório para corrigir o material.", 409);
  }
  return os;
}

async function tocarOs(tx: Transacao, osId: string): Promise<void> {
  // A OS mudou: é por este carimbo que o app sabe qual cópia é a mais nova.
  await tx.update(schema.ordemServico).set({ atualizadoEm: new Date() }).where(eq(schema.ordemServico.id, osId));
}

export interface NovoMaterial {
  itemId: string;
  quantidade: unknown;
  observacao?: string | null;
  /** Id gerado no celular: o reenvio não duplica. */
  idCliente?: string | null;
}

export async function registrarMaterial(
  ator: Ator,
  osId: string,
  novo: NovoMaterial,
): Promise<{ id: string; repetida: boolean }> {
  const quantidade = quantidadeValida(novo.quantidade);
  if (quantidade === null) throw new ErroOs("validacao", "Diga a quantidade usada (maior que zero).");

  if (novo.idCliente) {
    const ja = await porIdCliente(ator.empresaId, novo.idCliente);
    if (ja) return { id: ja.id, repetida: true };
  }

  try {
    return await db.transaction(async (tx) => {
      const os = await osParaMaterial(tx, ator, osId);
      const item = await tx.query.itemEstoque.findFirst({
        where: and(eq(schema.itemEstoque.id, novo.itemId), eq(schema.itemEstoque.empresaId, ator.empresaId)),
        columns: { id: true, ativo: true },
      });
      if (!item || !item.ativo) throw new ErroOs("validacao", "Esse item não está no estoque.");

      const [linha] = await tx
        .insert(schema.osMaterial)
        .values({
          empresaId: ator.empresaId,
          ordemServicoId: os.id,
          itemId: item.id,
          quantidade: String(quantidade),
          observacao: novo.observacao?.trim().slice(0, OBSERVACAO_MAXIMO) || null,
          registradoPor: ator.origem === "sistema" ? null : ator.id,
          idCliente: novo.idCliente ?? null,
        })
        .returning({ id: schema.osMaterial.id });
      await sincronizarBaixa(tx, os, ator);
      await tocarOs(tx, os.id);
      return { id: linha.id, repetida: false };
    });
  } catch (e) {
    if (novo.idCliente && violouUnico(e, "os_material_id_cliente_uq")) {
      const ja = await porIdCliente(ator.empresaId, novo.idCliente);
      if (ja) return { id: ja.id, repetida: true };
    }
    throw e;
  }
}

async function porIdCliente(empresaId: string, idCliente: string) {
  return db.query.osMaterial.findFirst({
    where: and(eq(schema.osMaterial.empresaId, empresaId), eq(schema.osMaterial.idCliente, idCliente)),
    columns: { id: true },
  });
}

/** Corrige a quantidade (ou a observação) de um material já registrado. */
export async function corrigirMaterial(
  ator: Ator,
  osId: string,
  materialId: string,
  mudanca: { quantidade?: unknown; observacao?: string | null },
): Promise<void> {
  const quantidade = mudanca.quantidade === undefined ? undefined : quantidadeValida(mudanca.quantidade);
  if (quantidade === null) throw new ErroOs("validacao", "Diga a quantidade usada (maior que zero). Para tirar o item, remova.");

  await db.transaction(async (tx) => {
    const os = await osParaMaterial(tx, ator, osId);
    const campos: Partial<typeof schema.osMaterial.$inferInsert> = {};
    if (quantidade !== undefined) campos.quantidade = String(quantidade);
    if (mudanca.observacao !== undefined) campos.observacao = mudanca.observacao?.trim().slice(0, OBSERVACAO_MAXIMO) || null;
    if (!Object.keys(campos).length) return;
    const feito = await tx
      .update(schema.osMaterial)
      .set(campos)
      .where(and(eq(schema.osMaterial.id, materialId), eq(schema.osMaterial.ordemServicoId, os.id)))
      .returning({ id: schema.osMaterial.id });
    if (!feito.length) throw new ErroOs("nao_encontrado", "Esse material não está nesta OS.", 404);
    await sincronizarBaixa(tx, os, ator);
    await tocarOs(tx, os.id);
  });
}

/** Tira o material da OS: o que tinha saído volta para o estoque. */
export async function removerMaterial(ator: Ator, osId: string, materialId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const os = await osParaMaterial(tx, ator, osId);
    const feito = await tx
      .delete(schema.osMaterial)
      .where(and(eq(schema.osMaterial.id, materialId), eq(schema.osMaterial.ordemServicoId, os.id)))
      .returning({ id: schema.osMaterial.id });
    if (!feito.length) throw new ErroOs("nao_encontrado", "Esse material não está nesta OS.", 404);
    await sincronizarBaixa(tx, os, ator);
    await tocarOs(tx, os.id);
  });
}

/** O material de várias OS de uma vez, em ordem de registro — para a tela e para o app. */
export async function materiaisDasOs(empresaId: string, osIds: string[]) {
  if (!osIds.length) return [];
  return db.query.osMaterial.findMany({
    where: and(eq(schema.osMaterial.empresaId, empresaId), inArray(schema.osMaterial.ordemServicoId, osIds)),
    with: {
      item: { columns: { id: true, nome: true, unidade: true } },
      registrador: { columns: { id: true, nome: true } },
    },
    orderBy: asc(schema.osMaterial.registradoEm),
  });
}

export type MaterialDaOs = Awaited<ReturnType<typeof materiaisDasOs>>[number];

/** Como o app recebe cada material. */
export function serializarMaterial(m: MaterialDaOs) {
  return {
    id: m.id,
    itemId: m.itemId,
    nome: m.item.nome,
    unidade: m.item.unidade,
    quantidade: Number(m.quantidade),
    observacao: m.observacao,
    registradoPorId: m.registradoPor,
    registradoPor: m.registrador?.nome ?? null,
    registradoEm: m.registradoEm.toISOString(),
  };
}
