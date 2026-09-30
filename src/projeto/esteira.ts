import { and, asc, desc, eq, gt, lt } from "drizzle-orm";

import { db, schema } from "@/db";

type Transacao = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Move um projeto para a etapa vizinha na esteira.
 *
 * Move por vizinhança de `ordem`, não por posição numa lista fixa: a esteira é
 * dado, e etapas podem ser criadas, desativadas ou reordenadas sem que isto aqui
 * precise mudar.
 *
 * Toda movimentação grava um evento com quanto tempo o projeto passou na etapa
 * anterior — é desse histórico que sai "onde os projetos travam?" — e quem
 * moveu. Quem move pode ser uma pessoa na tela da esteira ou a conclusão de uma
 * OS; a `observacao` diz qual.
 *
 * Devolve a etapa nova, ou null na ponta da esteira (não há para onde ir, e
 * não é erro).
 */
export async function moverNaEsteira(opcoes: {
  empresaId: string;
  projetoId: string;
  direcao: "avancar" | "voltar";
  usuarioId?: string | null;
  observacao?: string | null;
  tx?: Transacao;
}): Promise<{ id: string; nome: string; slug: string } | null> {
  const executor = opcoes.tx ?? db;

  const projeto = await executor.query.projeto.findFirst({
    where: and(
      eq(schema.projeto.id, opcoes.projetoId),
      eq(schema.projeto.empresaId, opcoes.empresaId),
    ),
    with: { etapa: true },
  });
  if (!projeto) return null;

  const avancando = opcoes.direcao === "avancar";
  const vizinha = await executor.query.etapa.findFirst({
    where: and(
      eq(schema.etapa.empresaId, projeto.empresaId),
      eq(schema.etapa.ativa, true),
      avancando
        ? gt(schema.etapa.ordem, projeto.etapa.ordem)
        : lt(schema.etapa.ordem, projeto.etapa.ordem),
    ),
    orderBy: avancando ? asc(schema.etapa.ordem) : desc(schema.etapa.ordem),
  });
  if (!vizinha) return null;

  const agora = new Date();
  const horas = Math.round((agora.getTime() - projeto.etapaDesde.getTime()) / 3_600_000);

  const gravar = async (t: Transacao) => {
    await t
      .update(schema.projeto)
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
      .where(eq(schema.projeto.id, projeto.id));

    await t.insert(schema.projetoEvento).values({
      empresaId: projeto.empresaId,
      projetoId: projeto.id,
      etapaDeId: projeto.etapaId,
      etapaParaId: vizinha.id,
      horasNaEtapaAnterior: horas,
      usuarioId: opcoes.usuarioId ?? null,
      observacao: opcoes.observacao ?? null,
      ocorridoEm: agora,
    });
  };

  if (opcoes.tx) await gravar(opcoes.tx);
  else await db.transaction(gravar);

  return { id: vizinha.id, nome: vizinha.nome, slug: vizinha.slug };
}
