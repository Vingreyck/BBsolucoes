"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { tipoDoDocumento } from "@/documentos/conteudo";
import { driveConfigurado, enviarArquivo, garantirPasta } from "@/documentos/drive";
import { limparNome } from "@/documentos/pastas";
import { ressincronizarModelo } from "@/projeto/datasheets";

const PAGINA = "/administracao/equipamentos";
const TIPOS = new Set(["inversor", "microinversor", "modulo"]);
/** 25 MB: datasheet de fabricante passa de 10 às vezes (muita foto). */
const ARQUIVO_MAXIMO = 25 * 1024 * 1024;

/** O catálogo é de quem cuida do projeto: o adm e o engenheiro. */
async function exigirCatalogo() {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm" && usuario.papel !== "engenheiro") redirect("/sem-acesso");
  return usuario;
}

function voltar(m: { ok?: string; erro?: string }): never {
  const q = new URLSearchParams();
  if (m.ok) q.set("ok", m.ok);
  if (m.erro) q.set("erro", m.erro);
  redirect(`${PAGINA}?${q.toString()}`);
}

function texto(d: FormData, campo: string, max = 120): string {
  return String(d.get(campo) ?? "").trim().slice(0, max);
}

/**
 * Sobe um PDF do fabricante para a pasta BIBLIOTECA DE EQUIPAMENTOS do Drive.
 * Devolve null se o campo veio vazio.
 */
async function subirPdf(
  arquivo: FormDataEntryValue | null,
  qual: "DATASHEET" | "INMETRO",
  m: { fabricante: string; modelo: string },
): Promise<{ link: string; nome: string } | null> {
  if (!(arquivo instanceof File) || arquivo.size === 0) return null;
  if (!driveConfigurado()) voltar({ erro: "O Drive não está conectado neste servidor: não dá para guardar o arquivo." });
  if (arquivo.size > ARQUIVO_MAXIMO) voltar({ erro: `O ${qual.toLowerCase()} passou de 25 MB.` });
  const conteudo = new Uint8Array(await arquivo.arrayBuffer());
  // O conteúdo diz o que o arquivo é: só PDF, que é o que a Energisa recebe.
  const real = tipoDoDocumento(conteudo, arquivo.name);
  if (real?.mime !== "application/pdf") voltar({ erro: `O ${qual.toLowerCase()} precisa ser um PDF.` });

  const raiz = process.env.GOOGLE_DRIVE_RAIZ;
  if (!raiz) voltar({ erro: "Falta GOOGLE_DRIVE_RAIZ no .env do servidor." });
  const pasta = await garantirPasta("BIBLIOTECA DE EQUIPAMENTOS", raiz);
  const nome = `${qual} - ${limparNome(`${m.fabricante} ${m.modelo}`).toUpperCase()}.pdf`;
  const enviado = await enviarArquivo({ nome, mimeType: "application/pdf", pastaId: pasta, conteudo });
  return { link: enviado.webViewLink ?? `https://drive.google.com/file/d/${enviado.id}/view`, nome };
}

/** Cadastra um modelo de inversor ou de módulo, já com os PDFs se vierem. */
export async function criarModelo(dados: FormData): Promise<void> {
  const usuario = await exigirCatalogo();
  const tipo = texto(dados, "tipo");
  const fabricante = texto(dados, "fabricante");
  const modelo = texto(dados, "modelo");
  const potencia = Number(texto(dados, "potenciaW").replace(/\./g, "").replace(",", "."));
  if (!TIPOS.has(tipo)) voltar({ erro: "Escolha se é inversor, microinversor ou módulo." });
  if (!fabricante || !modelo) voltar({ erro: "Escreva o fabricante e o modelo." });

  const jaTem = (
    await db
      .select({ id: schema.modeloEquipamento.id, fabricante: schema.modeloEquipamento.fabricante, modelo: schema.modeloEquipamento.modelo })
      .from(schema.modeloEquipamento)
      .where(and(eq(schema.modeloEquipamento.empresaId, usuario.empresaId), eq(schema.modeloEquipamento.tipo, tipo as never)))
  ).some((m) => m.fabricante.toLowerCase() === fabricante.toLowerCase() && m.modelo.toLowerCase() === modelo.toLowerCase());
  if (jaTem) voltar({ erro: `${fabricante} ${modelo} já está no catálogo.` });

  const datasheet = await subirPdf(dados.get("datasheet"), "DATASHEET", { fabricante, modelo });
  const inmetro = await subirPdf(dados.get("inmetro"), "INMETRO", { fabricante, modelo });

  await db.insert(schema.modeloEquipamento).values({
    empresaId: usuario.empresaId,
    tipo: tipo as never,
    fabricante,
    modelo,
    potenciaW: Number.isFinite(potencia) && potencia > 0 ? String(potencia) : null,
    datasheetLink: datasheet?.link ?? null,
    datasheetNome: datasheet?.nome ?? null,
    inmetroLink: inmetro?.link ?? null,
    inmetroNome: inmetro?.nome ?? null,
  });

  revalidatePath(PAGINA);
  voltar({ ok: `${fabricante} ${modelo} entrou no catálogo.` });
}

/**
 * Sobe (ou troca) o datasheet e/ou o Inmetro de um modelo. Todo projeto que
 * usa o modelo recebe o arquivo novo no dossiê na hora.
 */
export async function enviarArquivosDoModelo(modeloId: string, dados: FormData): Promise<void> {
  const usuario = await exigirCatalogo();
  const m = await db.query.modeloEquipamento.findFirst({
    where: and(eq(schema.modeloEquipamento.id, modeloId), eq(schema.modeloEquipamento.empresaId, usuario.empresaId)),
  });
  if (!m) voltar({ erro: "Modelo não encontrado." });

  const datasheet = await subirPdf(dados.get("datasheet"), "DATASHEET", m);
  const inmetro = await subirPdf(dados.get("inmetro"), "INMETRO", m);
  if (!datasheet && !inmetro) voltar({ erro: "Escolha pelo menos um PDF para enviar." });

  await db
    .update(schema.modeloEquipamento)
    .set({
      ...(datasheet ? { datasheetLink: datasheet.link, datasheetNome: datasheet.nome } : {}),
      ...(inmetro ? { inmetroLink: inmetro.link, inmetroNome: inmetro.nome } : {}),
    })
    .where(eq(schema.modeloEquipamento.id, m.id));

  const projetos = await ressincronizarModelo(usuario.empresaId, m.id);
  revalidatePath(PAGINA);
  voltar({
    ok: `Arquivo de ${m.fabricante} ${m.modelo} guardado.${projetos ? ` ${projetos} ${projetos === 1 ? "projeto recebeu" : "projetos receberam"} no dossiê.` : ""}`,
  });
}

/** Tira o modelo da lista de escolha (quem já usa continua com ele). */
export async function alternarModelo(modeloId: string): Promise<void> {
  const usuario = await exigirCatalogo();
  const m = await db.query.modeloEquipamento.findFirst({
    where: and(eq(schema.modeloEquipamento.id, modeloId), eq(schema.modeloEquipamento.empresaId, usuario.empresaId)),
    columns: { id: true, ativo: true },
  });
  if (!m) return;
  await db.update(schema.modeloEquipamento).set({ ativo: !m.ativo }).where(eq(schema.modeloEquipamento.id, m.id));
  revalidatePath(PAGINA);
}
