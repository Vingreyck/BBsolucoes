import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import { enviarPush, pushConfigurado, type Aviso } from "./fcm";
import { quandoLegivel, textoDoAviso, type MotivoAviso } from "./texto";

export type { MotivoAviso };

/**
 * Avisa uma pessoa em todos os celulares dela. Nunca lança: o aviso é um
 * extra — se falhar, a OS já foi atribuída e o técnico vê ao abrir o app.
 */
export async function avisarUsuario(usuarioId: string, aviso: Aviso): Promise<void> {
  if (!pushConfigurado()) return;
  try {
    const aparelhos = await db
      .select({ id: schema.aparelhoPush.id, token: schema.aparelhoPush.token })
      .from(schema.aparelhoPush)
      .where(eq(schema.aparelhoPush.usuarioId, usuarioId));
    if (!aparelhos.length) return;

    const mortos: string[] = [];
    await Promise.all(
      aparelhos.map(async (a) => {
        if ((await enviarPush(a.token, aviso)) === "token_invalido") mortos.push(a.id);
      }),
    );
    if (mortos.length) await db.delete(schema.aparelhoPush).where(inArray(schema.aparelhoPush.id, mortos));
  } catch (e) {
    console.warn("[push] aviso não saiu:", e instanceof Error ? e.message : e);
  }
}

/** Atalho usado pelo fluxo da OS: monta o texto e avisa o responsável. */
export async function avisarOs(
  usuarioId: string,
  motivo: MotivoAviso,
  os: { id: string; numero: number; prioridade: string; clienteId: string; agendadaPara?: string | null },
): Promise<void> {
  try {
    const cliente = await db.query.cliente.findFirst({
      where: eq(schema.cliente.id, os.clienteId),
      columns: { nome: true },
    });
    const aviso = textoDoAviso(motivo, {
      numero: os.numero,
      urgente: os.prioridade === "urgente",
      cliente: cliente?.nome,
      quando: quandoLegivel(os.agendadaPara),
    });
    aviso.dados.osId = os.id;
    await avisarUsuario(usuarioId, aviso);
  } catch (e) {
    console.warn("[push] aviso de OS não saiu:", e instanceof Error ? e.message : e);
  }
}
