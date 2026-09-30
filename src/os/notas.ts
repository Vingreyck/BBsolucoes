import { and, asc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";

import { ErroOs, podeVer, type Ator } from "./acesso";
import { violouUnico } from "./fluxo";

/**
 * As notas da OS: o recado entre o escritório e quem está em campo.
 *
 * "Cliente pediu para ligar antes de ir", "o portão é pelo lado da padaria",
 * "chegou só um inversor, o outro vem sexta". São os comentários da tela da OS
 * no site (tabela `comentario`), e o app lê e escreve os mesmos — o que antes
 * morria num áudio de WhatsApp fica junto da OS.
 *
 * Diferente do checklist, nota não trava com a OS encerrada: o "o cliente
 * ligou elogiando" chega depois.
 */

export const NOTA_MAXIMO = 4000;

export interface OpcoesNota {
  /** Id dado pelo celular: a nota escrita sem sinal e reenviada não duplica. */
  idCliente?: string | null;
  /** A hora do celular em que a nota foi escrita. */
  criadoEm?: Date | null;
}

export async function anotar(
  ator: Ator,
  osId: string,
  texto: string,
  opcoes: OpcoesNota = {},
): Promise<{ id: string; repetida: boolean }> {
  const corpo = texto.trim().slice(0, NOTA_MAXIMO);
  if (!corpo) throw new ErroOs("validacao", "Escreva a nota.");

  if (opcoes.idCliente) {
    const ja = await notaPeloIdCliente(ator.empresaId, opcoes.idCliente);
    if (ja) return { id: ja.id, repetida: true };
  }

  const os = await db.query.ordemServico.findFirst({
    where: and(eq(schema.ordemServico.id, osId), eq(schema.ordemServico.empresaId, ator.empresaId)),
    columns: { id: true, responsavelId: true },
  });
  if (!os || !podeVer(ator, os)) throw new ErroOs("nao_encontrada", "Ordem de serviço não encontrada.", 404);

  const agora = new Date();
  // Relógio de celular adiantado não grava nota no futuro.
  const criadoEm =
    opcoes.criadoEm && !Number.isNaN(opcoes.criadoEm.getTime()) && opcoes.criadoEm <= agora
      ? opcoes.criadoEm
      : agora;

  try {
    return await db.transaction(async (tx) => {
      const [nota] = await tx
        .insert(schema.comentario)
        .values({
          empresaId: ator.empresaId,
          entidade: "ordem_servico",
          entidadeId: os.id,
          autorId: ator.id,
          texto: corpo,
          criadoEm,
          idCliente: opcoes.idCliente ?? null,
        })
        .returning({ id: schema.comentario.id });
      // A OS mudou: é por este carimbo que o app sabe qual cópia é a mais nova.
      await tx.update(schema.ordemServico).set({ atualizadoEm: agora }).where(eq(schema.ordemServico.id, os.id));
      return { id: nota.id, repetida: false };
    });
  } catch (e) {
    if (opcoes.idCliente && violouUnico(e, "comentario_id_cliente_uq")) {
      const ja = await notaPeloIdCliente(ator.empresaId, opcoes.idCliente);
      if (ja) return { id: ja.id, repetida: true };
    }
    throw e;
  }
}

async function notaPeloIdCliente(empresaId: string, idCliente: string) {
  return db.query.comentario.findFirst({
    where: and(eq(schema.comentario.empresaId, empresaId), eq(schema.comentario.idCliente, idCliente)),
    columns: { id: true },
  });
}

/** As notas de várias OS de uma vez, em ordem de escrita — para a lista do app. */
export async function notasDasOs(empresaId: string, osIds: string[]) {
  if (!osIds.length) return [];
  return db.query.comentario.findMany({
    where: and(
      eq(schema.comentario.empresaId, empresaId),
      eq(schema.comentario.entidade, "ordem_servico"),
      inArray(schema.comentario.entidadeId, osIds),
    ),
    with: { autor: { columns: { id: true, nome: true } } },
    orderBy: asc(schema.comentario.criadoEm),
  });
}
