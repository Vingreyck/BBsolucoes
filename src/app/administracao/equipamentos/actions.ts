"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { tipoDoDocumento } from "@/documentos/conteudo";
import { driveConfigurado, enviarArquivo, garantirPasta } from "@/documentos/drive";
import { limparNome } from "@/documentos/pastas";
import { itemDaBase, type ItemDaBase } from "@/equipamentos/base";
import { chaveDoModelo, lerPlanilhaDePrecos, lerPreco, linhasDoCsv } from "@/equipamentos/planilha";
import { idDaBase, type TipoDeEquipamento } from "@/equipamentos/regras";
import { ressincronizarModelo } from "@/projeto/datasheets";
import ExcelJS from "exceljs";

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

// ------------------------------------------- a base pública e os preços (23/11)

/**
 * Põe um modelo da base de equipamentos (ANEEL) no catálogo da empresa, com a
 * potência e os dados técnicos que a base tem. Já no catálogo: só avisa.
 */
export async function adicionarDaBase(baseId: string): Promise<void> {
  const usuario = await exigirCatalogo();
  const item = itemDaBase(baseId);
  if (!item || !item.potenciaW) voltar({ erro: "Modelo não encontrado na base." });
  const [ja] = await db
    .select({ id: schema.modeloEquipamento.id })
    .from(schema.modeloEquipamento)
    .where(and(eq(schema.modeloEquipamento.empresaId, usuario.empresaId), eq(schema.modeloEquipamento.baseId, item.id)));
  if (ja) voltar({ ok: `${item.fabricante} ${item.modelo} já estava no catálogo.` });
  await db.insert(schema.modeloEquipamento).values(valoresDaBase(usuario.empresaId, item, null));
  revalidatePath(PAGINA);
  voltar({ ok: `${item.fabricante} ${item.modelo} entrou no catálogo. Falta o datasheet e o Inmetro, se for vender.` });
}

function valoresDaBase(empresaId: string, item: ItemDaBase, preco: number | null): typeof schema.modeloEquipamento.$inferInsert {
  return {
    empresaId,
    tipo: item.tipo,
    fabricante: item.fabricante.slice(0, 80),
    modelo: item.modelo.slice(0, 120),
    potenciaW: item.potenciaW ? String(item.potenciaW) : null,
    baseId: item.id,
    precoCusto: preco === null ? null : String(preco),
    especificacoes: {
      fases: item.fases ?? null,
      modulosPorUnidade: item.modulosPorUnidade ?? null,
      areaM2: item.eletrico?.areaM2 ?? null,
      ...(item.eletrico ? { eletrico: item.eletrico } : {}),
    },
  };
}

/** O preço de custo de um modelo (o que a empresa paga ao distribuidor por unidade). */
export async function salvarPrecoDeCusto(modeloId: string, dados: FormData): Promise<void> {
  const usuario = await exigirCatalogo();
  const bruto = texto(dados, "precoCusto", 30);
  const preco = bruto ? lerPreco(bruto) : null;
  if (bruto && preco === null) voltar({ erro: "Preço inválido: escreva em reais, como 650,00." });
  await db
    .update(schema.modeloEquipamento)
    .set({ precoCusto: preco === null ? null : String(preco) })
    .where(and(eq(schema.modeloEquipamento.id, modeloId), eq(schema.modeloEquipamento.empresaId, usuario.empresaId)));
  revalidatePath(PAGINA);
  voltar({ ok: preco === null ? "Preço tirado." : "Preço de custo guardado." });
}

/** 5 MB de planilha: a do distribuidor tem algumas centenas de linhas. */
const PLANILHA_MAXIMA = 5 * 1024 * 1024;

/**
 * A planilha de preços do distribuidor (XLSX ou CSV, com modelo e preço; tipo,
 * fabricante e potência ajudam). Cada linha atualiza o preço do modelo no
 * catálogo; o que não está no catálogo mas está na base da ANEEL entra no
 * catálogo; o resto é contado e mostrado.
 */
export async function importarPlanilhaDePrecos(dados: FormData): Promise<void> {
  const usuario = await exigirCatalogo();
  const arquivo = dados.get("planilha");
  if (!(arquivo instanceof File) || arquivo.size === 0) voltar({ erro: "Escolha a planilha." });
  if (arquivo.size > PLANILHA_MAXIMA) voltar({ erro: "A planilha passou de 5 MB." });
  const conteudo = Buffer.from(await arquivo.arrayBuffer());

  let linhas: string[][] = [];
  if (/\.xlsx$/i.test(arquivo.name)) {
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(conteudo as unknown as ArrayBuffer);
    const aba = livro.worksheets[0];
    aba?.eachRow({ includeEmpty: false }, (linha) => {
      const celulas: string[] = [];
      linha.eachCell({ includeEmpty: true }, (c, i) => {
        const v = c.value as unknown;
        const t =
          v === null || v === undefined
            ? ""
            : typeof v === "object" && v !== null && "result" in v
              ? String((v as { result: unknown }).result ?? "")
              : typeof v === "object" && v !== null && "richText" in v
                ? (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("")
                : String(v);
        celulas[i - 1] = t;
      });
      linhas.push(Array.from(celulas, (c) => c ?? ""));
    });
  } else if (/\.(csv|txt)$/i.test(arquivo.name)) {
    linhas = linhasDoCsv(conteudo.toString("utf8"));
  } else {
    voltar({ erro: "A planilha precisa ser .xlsx ou .csv." });
  }

  const { itens, ignoradas, semCabecalho } = lerPlanilhaDePrecos(linhas);
  if (semCabecalho) voltar({ erro: "Não achei as colunas: a planilha precisa de uma coluna de modelo e uma de preço, com o nome no cabeçalho." });

  const catalogo = await db.query.modeloEquipamento.findMany({ where: eq(schema.modeloEquipamento.empresaId, usuario.empresaId) });
  let atualizados = 0;
  let novos = 0;
  let semPar = 0;
  for (const l of itens) {
    const k = chaveDoModelo(l.modelo);
    const doCatalogo = catalogo.find((m) => chaveDoModelo(m.modelo) === k && (!l.tipo || m.tipo === l.tipo));
    if (doCatalogo) {
      await db.update(schema.modeloEquipamento).set({ precoCusto: String(l.preco) }).where(eq(schema.modeloEquipamento.id, doCatalogo.id));
      atualizados++;
      continue;
    }
    const tipos: TipoDeEquipamento[] = l.tipo ? [l.tipo] : ["modulo", "inversor", "microinversor"];
    const daBase = tipos.map((t) => itemDaBase(idDaBase(t, l.modelo))).find((x) => x && x.potenciaW);
    if (daBase) {
      const [novo] = await db.insert(schema.modeloEquipamento).values(valoresDaBase(usuario.empresaId, daBase, l.preco)).onConflictDoNothing().returning();
      if (novo) {
        catalogo.push(novo);
        novos++;
      } else atualizados++;
      continue;
    }
    if (l.tipo && l.potenciaW && l.fabricante) {
      const [novo] = await db
        .insert(schema.modeloEquipamento)
        .values({ empresaId: usuario.empresaId, tipo: l.tipo, fabricante: l.fabricante.slice(0, 80), modelo: l.modelo.slice(0, 120), potenciaW: String(l.potenciaW), precoCusto: String(l.preco) })
        .returning();
      if (novo) catalogo.push(novo);
      novos++;
      continue;
    }
    semPar++;
  }
  revalidatePath(PAGINA);
  voltar({
    ok: `Planilha lida: ${atualizados} ${atualizados === 1 ? "preço atualizado" : "preços atualizados"}, ${novos} ${novos === 1 ? "modelo novo" : "modelos novos"} no catálogo${semPar ? `, ${semPar} sem par (sem tipo e potência para cadastrar)` : ""}${ignoradas ? `, ${ignoradas} ${ignoradas === 1 ? "linha ignorada" : "linhas ignoradas"}` : ""}.`,
  });
}
