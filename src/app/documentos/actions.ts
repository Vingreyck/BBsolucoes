"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { exigirAcessoDocumentos } from "@/auth/permissao";
import { db, schema } from "@/db";
import { driveConfigurado, enviarArquivo, garantirPasta } from "@/documentos/drive";

/**
 * Sobe um documento pelo Selebi.
 *
 * Este é o ponto em que a adivinhação por nome de arquivo deixa de existir. A
 * importação precisou adivinhar o tipo pelo nome porque os 2.788 arquivos já
 * estavam lá; daqui para a frente o tipo vem do **slot** em que a pessoa
 * clicou, e não há o que errar.
 *
 * O arquivo vai para o Drive da empresa, na pasta do cliente, com o nome no
 * padrão `TIPO - CLIENTE.pdf`. **Sem comprimir** — decisão explícita do dono, e
 * a certa: comprimir PDF escaneado é degradar um papel que pode virar prova.
 */

/** Extensão permitida. Papel é PDF, imagem ou documento — não executável. */
const TIPOS_ACEITOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
]);

/** 60 MB. O maior memorial escaneado do Drive da BB tem 30. */
const TAMANHO_MAXIMO = 60 * 1024 * 1024;

const ROTULO_ARQUIVO: Record<string, string> = {
  art: "ART",
  boleto_art: "BOLETO ART",
  contrato: "CONTRATO",
  memorial: "MEMORIAL",
  procuracao: "PROCURACAO",
  recibo: "RECIBO",
  documento_pessoal: "DOCUMENTO",
  uc_geradora: "UC GERADORA",
  projeto_eletrico: "PROJETO ELETRICO",
  simulacao: "SIMULACAO",
  uc_beneficiaria: "UCS",
  compensativo: "COMPENSATIVO",
  nota_fiscal: "NOTA FISCAL",
  ficha_cadastral: "FICHA",
  datasheet: "DATASHEET",
  comprovante: "COMPROVANTE",
  declaracao: "DECLARACAO",
  orcamento: "ORCAMENTO",
  foto_padrao: "PADRAO",
  protocolo: "PROTOCOLO",
  outro: "OUTRO",
};

/** Tira acento e o que o Drive e o Windows não gostam em nome de arquivo. */
function limparNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ResultadoEnvio {
  erro?: string;
  ok?: string;
}

export async function enviarDocumento(
  _anterior: ResultadoEnvio,
  form: FormData,
): Promise<ResultadoEnvio> {
  const acesso = await exigirAcessoDocumentos();
  const usuario = acesso.usuario;

  if (!driveConfigurado()) {
    return {
      erro:
        "O Drive ainda não está conectado. Rode `npm run drive:autorizar` e " +
        "coloque GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REFRESH_TOKEN no .env.",
    };
  }

  const projetoId = String(form.get("projetoId") ?? "");
  const tipo = String(form.get("tipo") ?? "") as
    (typeof schema.tipoDocumento.enumValues)[number];
  const assinado = form.get("assinado") === "sim";
  const arquivo = form.get("arquivo");

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: "Escolha um arquivo." };
  }
  if (arquivo.size > TAMANHO_MAXIMO) {
    const mb = Math.round(arquivo.size / 1024 / 1024);
    return { erro: `O arquivo tem ${mb} MB e o limite é 60 MB.` };
  }
  if (!TIPOS_ACEITOS.has(arquivo.type)) {
    return {
      erro: `Tipo de arquivo não aceito (${arquivo.type || "desconhecido"}). Use PDF, imagem ou documento do Office.`,
    };
  }
  if (!schema.tipoDocumento.enumValues.includes(tipo)) {
    return { erro: "Tipo de documento inválido." };
  }
  /**
   * O `tipo` vem de um campo escondido do formulário, e campo escondido é
   * palpite do navegador, não fato. Sem esta linha, trocar o valor no
   * inspetor deixaria o técnico gravar um "contrato" no dossiê.
   */
  if (!acesso.pode(tipo)) {
    return { erro: "Este tipo de documento não é das suas etapas." };
  }

  const projeto = await db.query.projeto.findFirst({
    where: and(
      eq(schema.projeto.id, projetoId),
      eq(schema.projeto.empresaId, usuario.empresaId),
    ),
    with: { cliente: true },
  });
  if (!projeto) return { erro: "Dossiê não encontrado." };

  /**
   * Onde gravar: a pasta que o cliente já tem no Drive.
   *
   * `pastaExterna` foi gravada na importação e é o id da pasta do cliente. Se
   * o cliente não tem pasta — venda que nasceu aqui dentro —, cria uma sob
   * `CLIENTES <ano>`, seguindo a árvore que a BB já usa.
   */
  const comPasta = await db.query.documento.findFirst({
    where: and(
      eq(schema.documento.clienteId, projeto.clienteId),
      eq(schema.documento.empresaId, usuario.empresaId),
    ),
    columns: { pastaExterna: true },
  });

  let pastaId = comPasta?.pastaExterna ?? null;

  try {
    if (!pastaId) {
      const raiz = process.env.GOOGLE_DRIVE_RAIZ;
      if (!raiz) {
        return {
          erro:
            "Falta GOOGLE_DRIVE_RAIZ no .env — é o id da pasta \"Energia solar\" no Drive. " +
            "Está no cabeçalho de scripts/listar-drive.gs.",
        };
      }
      const ano = new Date().getFullYear();
      const pastaDoAno = await garantirPasta(`CLIENTES ${ano}`, raiz);
      pastaId = await garantirPasta(limparNome(projeto.cliente.nome), pastaDoAno);
    }

    const ponto = arquivo.name.lastIndexOf(".");
    const extensao = ponto < 0 ? "" : arquivo.name.slice(ponto);
    const nomeFinal = `${ROTULO_ARQUIVO[tipo] ?? tipo.toUpperCase()} - ${limparNome(
      projeto.cliente.nome,
    ).toUpperCase()}${assinado ? " ASSINADO" : ""}${extensao}`;

    const enviado = await enviarArquivo({
      nome: nomeFinal,
      mimeType: arquivo.type,
      pastaId,
      conteudo: await arquivo.arrayBuffer(),
    });

    /**
     * Versão: um a mais que a maior que já existe deste tipo no dossiê.
     *
     * Substituir o arquivo antigo seria perder o histórico — e no Drive da BB
     * "Memorial Descritivo Assinado" e "Memorial Descritivo Assinado V2"
     * convivem justamente porque alguém precisou do anterior.
     */
    const existentes = await db.query.documento.findMany({
      where: and(
        eq(schema.documento.projetoId, projeto.id),
        eq(schema.documento.tipo, tipo),
      ),
      columns: { versao: true },
    });
    const versao = Math.max(0, ...existentes.map((d) => d.versao)) + 1;

    const [gravado] = await db
      .insert(schema.documento)
      .values({
        empresaId: usuario.empresaId,
        clienteId: projeto.clienteId,
        projetoId: projeto.id,
        tipo,
        status: assinado ? "assinado" : "indefinido",
        versao,
        nomeArquivo: nomeFinal,
        caminho: "",
        linkDrive: enviado.webViewLink ?? `https://drive.google.com/file/d/${enviado.id}/view`,
        pastaExterna: pastaId.slice(0, 80),
        origem: `CLIENTES ${new Date().getFullYear()}`,
        tamanhoBytes: arquivo.size,
        modificadoEm: new Date(),
        criadoPor: usuario.id,
      })
      .returning({ id: schema.documento.id });

    await db.insert(schema.documentoAcesso).values({
      empresaId: usuario.empresaId,
      documentoId: gravado.id,
      descricao: `${nomeFinal} (${projeto.titulo})`,
      usuarioId: usuario.id,
      acao: "enviou",
    });

    revalidatePath(`/documentos/${projeto.id}`);
    revalidatePath("/documentos");
    return { ok: `${nomeFinal} enviado.` };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falhou ao enviar." };
  }
}
