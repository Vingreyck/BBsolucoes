"use server";

import { and, asc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { ehTipoResposta, type TipoOs } from "@/os/tipos";

/**
 * Editar os modelos de OS. Só o adm: é a regra do que o técnico precisa trazer
 * do campo, e mudar isso muda o que trava a conclusão de toda OS nova.
 *
 * Mudança aqui vale para as OS abertas daqui em diante. As que já existem
 * guardaram a própria cópia do checklist — o técnico que está no meio de uma
 * não vê a lista mudar debaixo dele, e o relatório continua batendo.
 */

async function exigirAdm() {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm") redirect("/sem-acesso");
  return usuario;
}

const TIPOS = new Set<string>(schema.tipoOs.enumValues);
const TIPOS_DOC = new Set<string>(schema.tipoDocumento.enumValues);

function texto(form: FormData, campo: string): string {
  return String(form.get(campo) ?? "").trim();
}

async function modeloDa(empresaId: string, tipo: string) {
  if (!TIPOS.has(tipo)) redirect("/administracao/modelos");
  const modelo = await db.query.modeloOs.findFirst({
    where: and(eq(schema.modeloOs.empresaId, empresaId), eq(schema.modeloOs.tipo, tipo as TipoOs)),
    columns: { id: true },
  });
  if (!modelo) redirect("/administracao/modelos");
  return modelo;
}

function voltar(tipo: string, m: { ok?: string; erro?: string }, ancora = ""): never {
  const q = new URLSearchParams(m as Record<string, string>).toString();
  revalidatePath(`/administracao/modelos/${tipo}`);
  revalidatePath("/administracao/modelos");
  redirect(`/administracao/modelos/${tipo}${q ? `?${q}` : ""}${ancora}`);
}

export async function salvarModelo(tipo: string, form: FormData): Promise<void> {
  const usuario = await exigirAdm();
  const modelo = await modeloDa(usuario.empresaId, tipo);
  const nome = texto(form, "nome");
  if (!nome) voltar(tipo, { erro: "O modelo precisa de um nome." });
  const prazo = texto(form, "prazoHoras");
  const prazoHoras = prazo ? Math.round(Number(prazo)) : null;
  if (prazoHoras !== null && (!Number.isFinite(prazoHoras) || prazoHoras < 1 || prazoHoras > 8760)) {
    voltar(tipo, { erro: "Prazo em horas: entre 1 e 8760, ou vazio para sem prazo." });
  }
  await db
    .update(schema.modeloOs)
    .set({
      nome: nome.slice(0, 120),
      instrucoes: texto(form, "instrucoes").slice(0, 2000) || null,
      prazoHoras,
      exigeAssinatura: form.get("exigeAssinatura") === "sim",
      etapaSlug: texto(form, "etapaSlug") || null,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.modeloOs.id, modelo.id));
  voltar(tipo, { ok: "Modelo salvo." });
}

export async function salvarItem(tipo: string, itemId: string | null, form: FormData): Promise<void> {
  const usuario = await exigirAdm();
  const modelo = await modeloDa(usuario.empresaId, tipo);

  const descricao = texto(form, "descricao");
  const tipoResposta = texto(form, "tipoResposta");
  const opcoes = texto(form, "opcoes")
    .split(/\n/)
    .map((o) => o.trim())
    .filter(Boolean);
  const fotosMinimas = Math.round(Number(texto(form, "fotosMinimas") || "0"));
  const tipoDocumento = texto(form, "tipoDocumento");
  const chave = texto(form, "chave").toLowerCase();

  const ancora = itemId ? `#item-${itemId}` : "#novo";
  if (!descricao) voltar(tipo, { erro: "O item precisa de uma descrição." }, ancora);
  if (!ehTipoResposta(tipoResposta)) voltar(tipo, { erro: "Tipo de resposta inválido." }, ancora);
  if ((tipoResposta === "escolha" || tipoResposta === "multipla") && opcoes.length < 2) {
    voltar(tipo, { erro: "Lista de opções: pelo menos duas, uma por linha." }, ancora);
  }
  if (!Number.isFinite(fotosMinimas) || fotosMinimas < 0 || fotosMinimas > 20) {
    voltar(tipo, { erro: "Fotos mínimas: de 0 a 20." }, ancora);
  }
  if (tipoDocumento && !TIPOS_DOC.has(tipoDocumento)) voltar(tipo, { erro: "Tipo de documento inválido." }, ancora);
  if (chave && !/^[a-z0-9_]{2,60}$/.test(chave)) {
    voltar(tipo, { erro: "Chave: só letras minúsculas, números e _ (ex.: disjuntor_amperagem)." }, ancora);
  }

  const campos = {
    descricao: descricao.slice(0, 300),
    secao: texto(form, "secao").slice(0, 80) || null,
    ajuda: texto(form, "ajuda").slice(0, 600) || null,
    tipoResposta,
    opcoes: tipoResposta === "escolha" || tipoResposta === "multipla" ? opcoes.slice(0, 40) : null,
    unidade: tipoResposta === "numero" ? texto(form, "unidade").slice(0, 20) || null : null,
    obrigatorio: form.get("obrigatorio") === "sim",
    fotosMinimas: tipoResposta === "foto" ? Math.max(1, fotosMinimas) : fotosMinimas,
    apenasCamera: form.get("apenasCamera") === "sim",
    tipoDocumento: (tipoDocumento || null) as (typeof schema.tipoDocumento.enumValues)[number] | null,
    chave: chave || null,
  };

  if (itemId) {
    await db
      .update(schema.modeloOsItem)
      .set(campos)
      .where(and(eq(schema.modeloOsItem.id, itemId), eq(schema.modeloOsItem.modeloId, modelo.id)));
  } else {
    const [{ maior }] = await db
      .select({ maior: max(schema.modeloOsItem.ordem) })
      .from(schema.modeloOsItem)
      .where(eq(schema.modeloOsItem.modeloId, modelo.id));
    await db.insert(schema.modeloOsItem).values({
      ...campos,
      empresaId: usuario.empresaId,
      modeloId: modelo.id,
      ordem: (maior ?? 0) + 10,
    });
  }
  await db.update(schema.modeloOs).set({ atualizadoEm: new Date() }).where(eq(schema.modeloOs.id, modelo.id));
  voltar(tipo, { ok: itemId ? "Item salvo." : "Item acrescentado." }, ancora);
}

export async function moverItem(tipo: string, itemId: string, direcao: "subir" | "descer"): Promise<void> {
  const usuario = await exigirAdm();
  const modelo = await modeloDa(usuario.empresaId, tipo);
  const itens = await db.query.modeloOsItem.findMany({
    where: eq(schema.modeloOsItem.modeloId, modelo.id),
    orderBy: asc(schema.modeloOsItem.ordem),
    columns: { id: true, ordem: true },
  });
  const i = itens.findIndex((x) => x.id === itemId);
  const j = direcao === "subir" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= itens.length) voltar(tipo, {}, `#item-${itemId}`);
  // Renumera tudo de 10 em 10 com a troca feita: some com empate de ordem.
  const nova = [...itens];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  await db.transaction(async (tx) => {
    for (const [k, item] of nova.entries()) {
      await tx.update(schema.modeloOsItem).set({ ordem: (k + 1) * 10 }).where(eq(schema.modeloOsItem.id, item.id));
    }
  });
  voltar(tipo, {}, `#item-${itemId}`);
}

export async function removerItem(tipo: string, itemId: string): Promise<void> {
  const usuario = await exigirAdm();
  const modelo = await modeloDa(usuario.empresaId, tipo);
  await db
    .delete(schema.modeloOsItem)
    .where(and(eq(schema.modeloOsItem.id, itemId), eq(schema.modeloOsItem.modeloId, modelo.id)));
  voltar(tipo, { ok: "Item removido do modelo (as OS já abertas continuam com ele)." });
}
