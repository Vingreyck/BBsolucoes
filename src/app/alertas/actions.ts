"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { alerta as alertaTable } from "@/db/schema";

/**
 * Marca que alguém viu o alerta e está cuidando.
 *
 * Reconhecer não é resolver: a usina continua parada. Serve para o resto da
 * equipe parar de tratar como novidade e para saber há quanto tempo alguém
 * sabe do problema sem ter ido lá.
 */
export async function reconhecerAlerta(alertaId: string): Promise<void> {
  await db
    .update(alertaTable)
    .set({ status: "reconhecido" })
    .where(eq(alertaTable.id, alertaId));
  revalidatePath("/alertas");
}

export async function resolverAlerta(alertaId: string): Promise<void> {
  await db
    .update(alertaTable)
    .set({ status: "resolvido", resolvidoEm: new Date() })
    .where(eq(alertaTable.id, alertaId));
  revalidatePath("/alertas");
}
