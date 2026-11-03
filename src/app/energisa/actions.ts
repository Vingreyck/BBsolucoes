"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import { reagirNaEsteira } from "@/energisa/sincronizar";
import { exigirGestaoWeb } from "@/os/acesso";

/**
 * O que a tela do robô da Energisa pede. O robô roda noutro container e lê a
 * linha `robo_energisa` a cada poucos segundos — estas ações só escrevem nela.
 */

async function garantirLinha(empresaId: string) {
  await db.insert(schema.roboEnergisa).values({ empresaId }).onConflictDoNothing();
}

export async function pedirEntrada(): Promise<void> {
  const ator = await exigirGestaoWeb();
  await garantirLinha(ator.empresaId);
  await db
    .update(schema.roboEnergisa)
    .set({ pedido: "entrar", pedidoPorId: ator.id, codigo: null, mensagem: "Pedido enviado ao robô: abrindo o login da Energisa…", atualizadoEm: new Date() })
    .where(eq(schema.roboEnergisa.empresaId, ator.empresaId));
  revalidatePath("/energisa");
}

export async function pedirLeitura(): Promise<void> {
  const ator = await exigirGestaoWeb();
  await garantirLinha(ator.empresaId);
  await db
    .update(schema.roboEnergisa)
    .set({ pedido: "ler", pedidoPorId: ator.id, atualizadoEm: new Date() })
    .where(eq(schema.roboEnergisa.empresaId, ator.empresaId));
  revalidatePath("/energisa");
}

/** O código do SMS. Vive na linha só até o robô usar (ele apaga na hora). */
export async function enviarCodigo(form: FormData): Promise<void> {
  const ator = await exigirGestaoWeb();
  const codigo = String(form.get("codigo") ?? "").replace(/\D/g, "");
  if (codigo.length < 4 || codigo.length > 8) return;
  await db
    .update(schema.roboEnergisa)
    .set({ codigo, codigoEm: new Date(), pedidoPorId: ator.id, mensagem: "Código recebido. Entrando na Energisa…", atualizadoEm: new Date() })
    .where(eq(schema.roboEnergisa.empresaId, ator.empresaId));
  revalidatePath("/energisa");
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
