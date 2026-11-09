"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import { ErroOs, exigirGestaoWeb } from "@/os/acesso";
import { executarAcao } from "@/os/fluxo";
import { relogioDoCampo } from "@/os/relogio";

/**
 * Agendar arrastando: a OS cai numa pessoa e num dia da agenda.
 *
 * São as duas ações da tela da OS, na mesma ordem: primeiro quem vai (se
 * mudou), depois quando. A regra continua em `@/os/fluxo` — só a gestão
 * agenda, reagendar pede motivo, OS em atendimento não se mexe — e a recusa
 * volta como mensagem para a janelinha, sem sair da agenda.
 *
 * O motivo é conferido antes de trocar o responsável: se faltasse, a troca de
 * pessoa ficaria feita e o agendamento não.
 */
export async function agendarArrastando(
  osId: string,
  destino: { responsavelId: string | null; dia: string; hora: string; motivo?: string },
): Promise<{ erro?: string }> {
  const ator = await exigirGestaoWeb();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(destino.dia) || !/^\d{2}:\d{2}$/.test(destino.hora)) {
    return { erro: "Escolha o dia e a hora." };
  }
  const agendadaPara = relogioDoCampo(`${destino.dia}T${destino.hora}`);
  if (!agendadaPara) return { erro: "Escolha um horário válido." };

  const os = await db.query.ordemServico.findFirst({
    where: and(eq(schema.ordemServico.id, osId), eq(schema.ordemServico.empresaId, ator.empresaId)),
    columns: { responsavelId: true, agendadaPara: true },
  });
  if (!os) return { erro: "Ordem de serviço não encontrada." };
  const motivo = destino.motivo?.trim() || null;
  if (os.agendadaPara && !motivo) return { erro: "Diga o motivo do reagendamento." };

  try {
    const responsavelId = destino.responsavelId || null;
    if ((os.responsavelId ?? null) !== responsavelId) {
      await executarAcao(ator, osId, { tipo: "atribuir", responsavelId });
    }
    await executarAcao(ator, osId, { tipo: "agendar", agendadaPara, motivo });
  } catch (e) {
    if (e instanceof ErroOs) return { erro: e.message };
    throw e;
  }

  revalidatePath("/os/agenda");
  revalidatePath("/os");
  revalidatePath(`/os/${osId}`);
  return {};
}
