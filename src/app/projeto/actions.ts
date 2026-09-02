"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { comentario, projeto as projetoTable } from "@/db/schema";

const texto = (d: FormData, campo: string) => {
  const v = String(d.get(campo) ?? "").trim();
  return v === "" ? null : v;
};

const numero = (d: FormData, campo: string) => {
  const v = texto(d, campo);
  if (v === null) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? String(n) : null;
};

/** Etapa 2: o que o cliente contou e quanto ele consome. */
export async function salvarInformacoes(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  await exigirUsuario();
  await db
    .update(projetoTable)
    .set({
      consumoMedioKwh: numero(dados, "consumoMedioKwh"),
      concessionaria: texto(dados, "concessionaria"),
      observacoes: texto(dados, "observacoes"),
      atualizadoEm: new Date(),
    })
    .where(eq(projetoTable.id, projetoId));
  revalidatePath(`/projeto/${projetoId}`);
}

/**
 * Etapa 5: o que o técnico encontrou no local.
 *
 * Quem registra fica gravado junto, e não só a data: quando alguém precisar
 * entender uma vistoria estranha meses depois, a pergunta é para uma pessoa,
 * não para o sistema.
 */
export async function salvarVistoria(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  const usuario = await exigirUsuario();
  const data = texto(dados, "vistoriaEm");
  await db
    .update(projetoTable)
    .set({
      vistoriaEm: data ? new Date(`${data}T12:00:00`) : null,
      vistoriaPorId: usuario.id,
      vistoriaObservacoes: texto(dados, "vistoriaObservacoes"),
      atualizadoEm: new Date(),
    })
    .where(eq(projetoTable.id, projetoId));
  revalidatePath(`/projeto/${projetoId}`);
}

/** Etapa 8: ART, memorial e o protocolo do parecer de acesso. */
export async function salvarProjetoTecnico(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  await exigirUsuario();
  await db
    .update(projetoTable)
    .set({
      numeroArt: texto(dados, "numeroArt"),
      protocoloConcessionaria: texto(dados, "protocoloConcessionaria"),
      potenciaKwp: numero(dados, "potenciaKwp"),
      valor: numero(dados, "valor"),
      atualizadoEm: new Date(),
    })
    .where(eq(projetoTable.id, projetoId));
  revalidatePath(`/projeto/${projetoId}`);
}

/**
 * Comentário preso ao projeto.
 *
 * É o que substitui a comunidade do WhatsApp sem virar chat: a conversa fica
 * junto do objeto de que se fala, e continua pesquisável seis meses depois.
 */
export async function comentar(projetoId: string, dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const conteudo = texto(dados, "texto");
  if (!conteudo) {
    redirect(`/projeto/${projetoId}`);
  }
  await db.insert(comentario).values({
    empresaId: usuario.empresaId,
    entidade: "projeto",
    entidadeId: projetoId,
    autorId: usuario.id,
    texto: conteudo,
  });
  revalidatePath(`/projeto/${projetoId}`);
}
