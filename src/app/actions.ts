"use server";

import { and, asc, eq, gt, lt, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { etapa as etapaTable, projeto as projetoTable, projetoEvento } from "@/db/schema";

/**
 * Move um projeto para a etapa vizinha na esteira.
 *
 * Move por vizinhança de `ordem`, não por posição numa lista fixa: a esteira é
 * dado, e etapas podem ser criadas, desativadas ou reordenadas sem que isto aqui
 * precise mudar.
 *
 * Toda movimentação grava um evento com quanto tempo o projeto passou na etapa
 * anterior. É desse histórico que sai a resposta para "onde os projetos travam?",
 * que hoje ninguém na empresa consegue responder com número.
 */
export async function moverProjeto(
  projetoId: string,
  direcao: "avancar" | "voltar",
): Promise<void> {
  const projeto = await db.query.projeto.findFirst({
    where: eq(projetoTable.id, projetoId),
    with: { etapa: true },
  });

  if (!projeto) {
    console.warn(`moverProjeto: projeto ${projetoId} não encontrado`);
    return;
  }

  const avancando = direcao === "avancar";

  const vizinha = await db.query.etapa.findFirst({
    where: and(
      eq(etapaTable.empresaId, projeto.empresaId),
      eq(etapaTable.ativa, true),
      avancando
        ? gt(etapaTable.ordem, projeto.etapa.ordem)
        : lt(etapaTable.ordem, projeto.etapa.ordem),
    ),
    orderBy: avancando ? asc(etapaTable.ordem) : desc(etapaTable.ordem),
  });

  // Ponta da esteira: não há para onde ir, e não é erro — a seta simplesmente
  // não faz nada.
  if (!vizinha) return;

  const agora = new Date();
  const horas = Math.round(
    (agora.getTime() - projeto.etapaDesde.getTime()) / 3_600_000,
  );

  await db.transaction(async (tx) => {
    await tx
      .update(projetoTable)
      .set({
        etapaId: vizinha.id,
        etapaDesde: agora,
        atualizadoEm: agora,
        // Prazo da nova etapa, quando ela tem um.
        prazoEtapa: vizinha.prazoPadraoDias
          ? new Date(agora.getTime() + vizinha.prazoPadraoDias * 86_400_000)
          : null,
        situacao: vizinha.terminal ? "concluido" : "em_andamento",
      })
      .where(eq(projetoTable.id, projetoId));

    await tx.insert(projetoEvento).values({
      empresaId: projeto.empresaId,
      projetoId,
      etapaDeId: projeto.etapaId,
      etapaParaId: vizinha.id,
      horasNaEtapaAnterior: horas,
      ocorridoEm: agora,
    });
  });

  revalidatePath("/");
}
