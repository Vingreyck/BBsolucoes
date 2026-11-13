"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { tipoDoDocumento } from "@/documentos/conteudo";
import { premissasDoFormulario } from "@/proposta/premissas";

/**
 * Salva as premissas da proposta comercial. Só o adm; e só vale se **todos** os
 * campos forem números dentro do razoável: premissa pela metade daria uma
 * proposta com número inventado.
 */
export async function salvarPremissas(dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");

  const campos: Record<string, string> = {};
  for (const [chave, valor] of dados.entries()) if (typeof valor === "string") campos[chave] = valor;
  const premissas = premissasDoFormulario(campos);
  if (!premissas) redirect("/administracao/proposta?erro=1");

  await db.update(schema.empresa).set({ propostaConfig: premissas }).where(eq(schema.empresa.id, usuario.empresaId));
  revalidatePath("/administracao/proposta");
  revalidatePath("/esteira");
  redirect("/administracao/proposta?ok=1");
}

/** 3 MB: a foto vai dentro de cada PDF que o cliente baixa pelo celular. */
const CAPA_MAXIMA = 3 * 1024 * 1024;

/**
 * A foto da capa da proposta (opcional). Sem ela, a capa sai com o desenho dos
 * módulos ao pôr do sol. Vale para as propostas já geradas também: a foto não
 * faz parte da "fotografia do dia", é a cara da empresa.
 */
export async function salvarCapa(dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");

  let capa: string | null | undefined;
  const arquivo = dados.get("capa");
  if (arquivo instanceof File && arquivo.size > 0) {
    if (arquivo.size > CAPA_MAXIMA) redirect("/administracao/proposta?erro=capa-grande");
    const conteudo = new Uint8Array(await arquivo.arrayBuffer());
    // O conteúdo diz o que o arquivo é, não o nome: só PNG e JPEG, que o PDF lê.
    const real = tipoDoDocumento(conteudo, arquivo.name);
    if (!real || !["image/png", "image/jpeg"].includes(real.mime)) redirect("/administracao/proposta?erro=capa-tipo");
    capa = `data:${real.mime};base64,${Buffer.from(conteudo).toString("base64")}`;
  }
  if (dados.get("tirarCapa") === "sim") capa = null;
  if (capa === undefined) redirect("/administracao/proposta");

  await db.update(schema.empresa).set({ propostaCapa: capa }).where(eq(schema.empresa.id, usuario.empresaId));
  revalidatePath("/administracao/proposta");
  redirect("/administracao/proposta?capa=ok");
}
