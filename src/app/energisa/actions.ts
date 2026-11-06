"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import { registrarLista, type ResultadoImportacao } from "@/energisa/importar";
import { reagirNaEsteira } from "@/energisa/sincronizar";
import { exigirGestaoWeb } from "@/os/acesso";

/** A lista que o favorito "Enviar ao Selebi" trouxe do portal da Energisa. */
export async function importarDoPortal(lista: unknown): Promise<ResultadoImportacao> {
  const ator = await exigirGestaoWeb();
  return registrarLista(ator, lista, "favorito");
}

/** Liga a linha do portal ao projeto do Selebi escolhido, e a esteira já reage. */
export async function vincular(energisaId: string, form: FormData): Promise<void> {
  const ator = await exigirGestaoWeb();
  const projetoId = String(form.get("projetoId") ?? "");
  if (!projetoId) return;
  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, ator.empresaId)),
    columns: { id: true },
  });
  if (!projeto) return;
  await db
    .update(schema.energisaProjeto)
    .set({ projetoId, vinculo: "manual", aplicadoCodigo: null })
    .where(and(eq(schema.energisaProjeto.id, energisaId), eq(schema.energisaProjeto.empresaId, ator.empresaId)));
  await reagirNaEsteira(ator.empresaId);
  revalidatePath("/energisa");
  revalidatePath("/esteira");
}

export async function desvincular(energisaId: string): Promise<void> {
  const ator = await exigirGestaoWeb();
  await db
    .update(schema.energisaProjeto)
    .set({ projetoId: null, vinculo: null, aplicadoCodigo: null })
    .where(and(eq(schema.energisaProjeto.id, energisaId), eq(schema.energisaProjeto.empresaId, ator.empresaId)));
  revalidatePath("/energisa");
  revalidatePath("/esteira");
}
