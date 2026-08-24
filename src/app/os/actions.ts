"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import {
  alerta as alertaTable,
  ordemServico as osTable,
  osChecklistItem,
} from "@/db/schema";

/**
 * Itens que o técnico precisa cumprir numa visita corretiva.
 *
 * PROVISÓRIO. A lista definitiva sai da pergunta que está aberta com o cliente
 * — "o que precisa voltar do campo para você considerar o serviço concluído?".
 * Até lá, ficam três itens genéricos o bastante para qualquer atendimento
 * corretivo em usina solar, e nenhum inventado sobre o processo deles.
 */
const CHECKLIST_CORRETIVA = [
  { descricao: "Registrar o código de erro no display do inversor", obrigatorio: true },
  { descricao: "Foto do quadro e do inversor", obrigatorio: true },
  { descricao: "Confirmar geração após a intervenção", obrigatorio: true },
];

/** Alerta crítico vira OS urgente; o resto entra como normal. */
function prioridadeDe(severidade: string) {
  return severidade === "critico" ? ("urgente" as const) : ("normal" as const);
}

/**
 * Abre uma ordem de serviço a partir de um alerta.
 *
 * É o elo que faltava entre monitorar e operar: sem ele o sistema avisa que a
 * usina parou e a informação morre na tela. A OS carrega de onde veio, e o
 * alerta guarda para onde foi, então nenhum dos dois lados fica órfão.
 */
export async function abrirOsDoAlerta(alertaId: string): Promise<void> {
  const usuario = await exigirUsuario();

  const alerta = await db.query.alerta.findFirst({
    where: eq(alertaTable.id, alertaId),
    with: { usina: { with: { cliente: true } } },
  });

  if (!alerta) {
    console.warn(`abrirOsDoAlerta: alerta ${alertaId} não encontrado`);
    return;
  }

  // Já tem OS: leva para lá em vez de abrir outra para o mesmo problema.
  if (alerta.ordemServicoId) {
    redirect(`/os/${alerta.ordemServicoId}`);
  }

  const osId = await db.transaction(async (tx) => {
    const [{ proximo }] = await tx
      .select({
        proximo: sql<number>`coalesce(max(${osTable.numero}), 0) + 1`,
      })
      .from(osTable)
      .where(eq(osTable.empresaId, alerta.empresaId));

    const [os] = await tx
      .insert(osTable)
      .values({
        empresaId: alerta.empresaId,
        numero: proximo,
        clienteId: alerta.usina.clienteId,
        usinaId: alerta.usinaId,
        tipo: "corretiva",
        status: "aberta",
        prioridade: prioridadeDe(alerta.severidade),
        origem: "alerta",
        descricao: alerta.mensagem,
        abertaPorId: usuario.id,
      })
      .returning();

    await tx.insert(osChecklistItem).values(
      CHECKLIST_CORRETIVA.map((item, ordem) => ({
        empresaId: alerta.empresaId,
        ordemServicoId: os.id,
        ordem,
        descricao: item.descricao,
        obrigatorio: item.obrigatorio,
      })),
    );

    // O alerta sai de "aberto": alguém já está cuidando.
    await tx
      .update(alertaTable)
      .set({ ordemServicoId: os.id, status: "reconhecido" })
      .where(eq(alertaTable.id, alertaId));

    return os.id;
  });

  revalidatePath("/alertas");
  revalidatePath("/os");
  redirect(`/os/${osId}`);
}

export async function marcarItem(itemId: string, concluido: boolean): Promise<void> {
  await exigirUsuario();
  await db
    .update(osChecklistItem)
    .set({ concluido, concluidoEm: concluido ? new Date() : null })
    .where(eq(osChecklistItem.id, itemId));
  revalidatePath("/os");
}

/**
 * Conclui a OS e resolve o alerta que a originou.
 *
 * Trava enquanto houver item obrigatório pendente — é isso que garante que foto
 * e código de erro voltem do campo. Sem a trava, o checklist vira decoração.
 */
export async function concluirOs(osId: string): Promise<{ erro?: string }> {
  await exigirUsuario();

  const os = await db.query.ordemServico.findFirst({
    where: eq(osTable.id, osId),
    with: { checklist: true, alertas: true },
  });
  if (!os) return { erro: "Ordem de serviço não encontrada." };

  const pendentes = os.checklist.filter((i) => i.obrigatorio && !i.concluido);
  if (pendentes.length) {
    return {
      erro: `Faltam ${pendentes.length} ${
        pendentes.length === 1 ? "item obrigatório" : "itens obrigatórios"
      } do checklist.`,
    };
  }

  const agora = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(osTable)
      .set({ status: "concluida", concluidaEm: agora })
      .where(eq(osTable.id, osId));

    for (const a of os.alertas) {
      await tx
        .update(alertaTable)
        .set({ status: "resolvido", resolvidoEm: agora })
        .where(eq(alertaTable.id, a.id));
    }
  });

  revalidatePath("/os");
  revalidatePath("/alertas");
  return {};
}

export async function iniciarOs(osId: string): Promise<void> {
  await exigirUsuario();
  await db
    .update(osTable)
    .set({ status: "em_andamento", iniciadaEm: new Date() })
    .where(eq(osTable.id, osId));
  revalidatePath("/os");
}
