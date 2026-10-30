"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import { exigirGestaoWeb } from "@/os/acesso";

/** Anota que o relatório do mês foi mandado ao cliente (o WhatsApp já abriu no navegador). */
export async function registrarEnvioRelatorio(usinaId: string, mes: string): Promise<void> {
  const ator = await exigirGestaoWeb();
  await db
    .update(schema.relatorioGeracao)
    .set({ enviadoEm: new Date(), enviadoPorId: ator.id, envios: sql`${schema.relatorioGeracao.envios} + 1` })
    .where(
      and(
        eq(schema.relatorioGeracao.empresaId, ator.empresaId),
        eq(schema.relatorioGeracao.usinaId, usinaId),
        eq(schema.relatorioGeracao.mes, mes),
      ),
    );
  revalidatePath("/relatorios");
}
