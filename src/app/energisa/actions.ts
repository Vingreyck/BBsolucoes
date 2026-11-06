"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import { reagirNaEsteira, sincronizar } from "@/energisa/sincronizar";
import { exigirGestaoWeb } from "@/os/acesso";

export type ResultadoImportacao = { ok: true; texto: string } | { ok: false; erro: string };

/**
 * A lista "Meus projetos" que o favorito "Enviar ao Selebi" trouxe do portal
 * da Energisa. Grava, vincula, faz a esteira reagir e avisa o Healthchecks de
 * que alguém atualizou hoje — se ninguém atualizar, é ele que manda o e-mail.
 */
export async function importarDoPortal(lista: unknown): Promise<ResultadoImportacao> {
  const ator = await exigirGestaoWeb();
  if (!Array.isArray(lista) || lista.length === 0) return { ok: false, erro: "A lista chegou vazia." };
  if (lista.length > 5000) return { ok: false, erro: "A lista é grande demais para ser a do portal." };
  const crus = lista.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");

  const resumo = await sincronizar(ator.empresaId, crus);
  const partes = [`${resumo.lidos} projetos lidos`];
  if (resumo.novos) partes.push(`${resumo.novos} novos`);
  if (resumo.mudaram) partes.push(`${resumo.mudaram} mudaram de situação`);
  if (resumo.vinculados) partes.push(`${resumo.vinculados} vinculados`);
  if (resumo.movidos.length) partes.push(`movidos na esteira: ${resumo.movidos.join(", ")}`);
  const texto = partes.join(" · ");

  await db.insert(schema.roboEnergisa).values({ empresaId: ator.empresaId }).onConflictDoNothing();
  await db
    .update(schema.roboEnergisa)
    .set({
      estado: "conectado",
      mensagem: `${texto} — enviado por ${ator.nome.split(" ")[0]}`,
      ultimaLeituraEm: new Date(),
      totalProjetos: resumo.lidos,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.roboEnergisa.empresaId, ator.empresaId));

  const check = process.env.ENERGISA_HEALTHCHECK_URL?.trim();
  if (check) {
    await fetch(check, { method: "POST", body: texto, signal: AbortSignal.timeout(8_000) }).catch(() => undefined);
  }

  revalidatePath("/energisa");
  revalidatePath("/esteira");
  return { ok: true, texto };
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
