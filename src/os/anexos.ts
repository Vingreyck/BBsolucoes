import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  baixarArquivo,
  driveConfigurado,
  enviarArquivo,
  garantirPasta,
  idDoLink,
  moverParaLixeira,
} from "@/documentos/drive";
import { limparNome, pastaDoCliente } from "@/documentos/pastas";

import { ErroOs, podeExecutar, podeVer, type Ator } from "./acesso";
import { violouUnico } from "./fluxo";
import { relogioDe } from "./relogio";
import { recalcularItem } from "./respostas";
import { encerrada, TIPO_ROTULO } from "./tipos";

/**
 * Foto, assinatura e documento anexados à OS.
 *
 * O arquivo vai para o Drive da empresa, na pasta do cliente, numa subpasta da
 * OS (`OS 0047 - Vistoria`) — o mesmo depósito dos documentos, então quem
 * abrir a pasta do cliente encontra tudo junto. O banco guarda o que é, de qual
 * item, quando e onde foi tirado.
 *
 * Quando o item diz que a foto é um documento do dossiê (`tipoDocumento`, como
 * a foto do padrão), ela entra também no dossiê da venda: a exigência da etapa
 * fica cumprida sem ninguém baixar a foto do WhatsApp e subir de novo — que é
 * exatamente o que travava 70 dossiês.
 */

export const CATEGORIAS = ["foto", "assinatura", "documento"] as const;
export type CategoriaAnexo = (typeof CATEGORIAS)[number];

/** 15 MB. Foto de celular comprimida pelo app fica bem abaixo disso. */
const TAMANHO_MAXIMO = 15 * 1024 * 1024;

/**
 * O tipo pelo conteúdo, não pelo que o celular declarou. JPEG e PNG são o que
 * o relatório em PDF sabe desenhar; PDF só como documento.
 */
function tipoReal(conteudo: Uint8Array): "image/jpeg" | "image/png" | "application/pdf" | null {
  const b = conteudo;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return null;
}

const EXTENSAO: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

function carimbo(d: Date): string {
  const r = relogioDe(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${r.getUTCFullYear()}${p(r.getUTCMonth() + 1)}${p(r.getUTCDate())}-${p(r.getUTCHours())}${p(r.getUTCMinutes())}${p(r.getUTCSeconds())}`;
}

export interface NovoAnexo {
  conteudo: Uint8Array;
  nomeOriginal?: string | null;
  categoria: CategoriaAnexo;
  itemId?: string | null;
  /** Hora do celular em que a foto foi tirada. */
  capturadoEm?: Date | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Id dado pelo celular: reenviar a mesma foto não duplica. */
  idCliente?: string | null;
}

export interface ResultadoAnexo {
  anexoId: string;
  repetido: boolean;
  documentoId: string | null;
}

async function anexoPeloIdCliente(empresaId: string, idCliente: string) {
  return db.query.osAnexo.findFirst({
    where: and(eq(schema.osAnexo.empresaId, empresaId), eq(schema.osAnexo.idCliente, idCliente)),
    columns: { id: true, documentoId: true },
  });
}

export async function anexar(ator: Ator, osId: string, novo: NovoAnexo): Promise<ResultadoAnexo> {
  if (novo.idCliente) {
    const ja = await anexoPeloIdCliente(ator.empresaId, novo.idCliente);
    if (ja) return { anexoId: ja.id, repetido: true, documentoId: ja.documentoId };
  }

  const os = await db.query.ordemServico.findFirst({
    where: and(eq(schema.ordemServico.id, osId), eq(schema.ordemServico.empresaId, ator.empresaId)),
    with: { cliente: { columns: { id: true, nome: true } } },
  });
  if (!os) throw new ErroOs("nao_encontrada", "Ordem de serviço não encontrada.", 404);
  if (!podeExecutar(ator, os)) throw new ErroOs("sem_permissao", "Esta OS não é sua.", 403);
  if (encerrada(os.status)) {
    throw new ErroOs("os_encerrada", "A OS já foi encerrada; não recebe mais anexo.", 409);
  }
  if (!CATEGORIAS.includes(novo.categoria)) {
    throw new ErroOs("validacao", "Categoria de anexo inválida.");
  }

  const item = novo.itemId
    ? await db.query.osChecklistItem.findFirst({
        where: and(
          eq(schema.osChecklistItem.id, novo.itemId),
          eq(schema.osChecklistItem.ordemServicoId, os.id),
        ),
      })
    : null;
  if (novo.itemId && !item) throw new ErroOs("nao_encontrado", "Item do checklist não encontrado.", 404);

  if (novo.conteudo.byteLength === 0) throw new ErroOs("validacao", "O arquivo veio vazio.");
  if (novo.conteudo.byteLength > TAMANHO_MAXIMO) {
    throw new ErroOs("validacao", "O arquivo passou de 15 MB.", 413);
  }
  const mime = tipoReal(novo.conteudo);
  const aceitos = novo.categoria === "documento" ? ["image/jpeg", "image/png", "application/pdf"] : ["image/jpeg", "image/png"];
  if (!mime || !aceitos.includes(mime)) {
    throw new ErroOs(
      "validacao",
      novo.categoria === "documento" ? "Envie PDF, JPEG ou PNG." : "A foto precisa ser JPEG ou PNG.",
      415,
    );
  }

  if (!driveConfigurado()) {
    throw new ErroOs(
      "drive_desligado",
      "O Drive da empresa não está conectado neste servidor; a foto não tem onde ser guardada.",
      503,
    );
  }

  const capturadoEm =
    novo.capturadoEm && !Number.isNaN(novo.capturadoEm.getTime()) && novo.capturadoEm <= new Date()
      ? novo.capturadoEm
      : new Date();

  const num = String(os.numero).padStart(4, "0");
  const pastaCliente = await pastaDoCliente(os.empresaId, os.cliente);
  const pastaOs = await garantirPasta(`OS ${num} - ${TIPO_ROTULO[os.tipo] ?? os.tipo}`, pastaCliente);
  const rotulo =
    novo.categoria === "assinatura"
      ? "Assinatura do cliente"
      : (item?.descricao.slice(0, 70) ?? (novo.categoria === "documento" ? "Documento" : "Foto"));
  const nome =
    limparNome(`OS ${num} - ${rotulo} - ${carimbo(capturadoEm)}-${randomBytes(2).toString("hex")}`) +
    EXTENSAO[mime];

  const enviado = await enviarArquivo({ nome, mimeType: mime, pastaId: pastaOs, conteudo: novo.conteudo });
  const link = enviado.webViewLink ?? `https://drive.google.com/file/d/${enviado.id}/view`;

  const coord = (v: number | null | undefined, lim: number) =>
    v !== null && v !== undefined && Number.isFinite(v) && Math.abs(v) <= lim ? v.toFixed(7) : null;

  try {
    return await db.transaction(async (tx) => {
      const [anexo] = await tx
        .insert(schema.osAnexo)
        .values({
          empresaId: os.empresaId,
          ordemServicoId: os.id,
          categoria: novo.categoria,
          caminho: link,
          nomeOriginal: novo.nomeOriginal?.slice(0, 200) ?? nome,
          tamanhoBytes: novo.conteudo.byteLength,
          enviadoPorId: ator.id,
          capturadoEm,
          checklistItemId: item?.id ?? null,
          idCliente: novo.idCliente ?? null,
          mime,
          driveId: enviado.id,
          latitude: coord(novo.latitude, 90),
          longitude: coord(novo.longitude, 180),
        })
        .returning({ id: schema.osAnexo.id });

      let documentoId: string | null = null;
      if (item?.tipoDocumento && os.projetoId) {
        const [doc] = await tx
          .insert(schema.documento)
          .values({
            empresaId: os.empresaId,
            clienteId: os.clienteId,
            projetoId: os.projetoId,
            tipo: item.tipoDocumento,
            status: "indefinido",
            nomeArquivo: nome,
            caminho: `OS ${num} - ${TIPO_ROTULO[os.tipo] ?? os.tipo}`,
            linkDrive: link,
            pastaExterna: pastaCliente.slice(0, 80),
            origem: `CLIENTES ${new Date().getFullYear()}`,
            tamanhoBytes: novo.conteudo.byteLength,
            modificadoEm: new Date(),
            criadoPor: ator.id,
          })
          .returning({ id: schema.documento.id });
        documentoId = doc.id;
        await tx.update(schema.osAnexo).set({ documentoId }).where(eq(schema.osAnexo.id, anexo.id));
        await tx.insert(schema.documentoAcesso).values({
          empresaId: os.empresaId,
          documentoId,
          descricao: `${nome} (${numeroDaOs(os.numero)}, pelo ${ator.origem === "app" ? "app" : "site"})`,
          usuarioId: ator.id,
          acao: "enviou",
        });
      }

      if (item) await recalcularItem(tx, item.id);
      await tx
        .update(schema.ordemServico)
        .set({ atualizadoEm: new Date() })
        .where(eq(schema.ordemServico.id, os.id));

      return { anexoId: anexo.id, repetido: false, documentoId };
    });
  } catch (e) {
    // Duas cópias da mesma foto subiram ao mesmo tempo: fica a primeira, e o
    // arquivo da segunda vai para a lixeira do Drive.
    if (novo.idCliente && violouUnico(e, "os_anexo_id_cliente_uq")) {
      await moverParaLixeira(enviado.id).catch(() => undefined);
      const ja = await anexoPeloIdCliente(ator.empresaId, novo.idCliente);
      if (ja) return { anexoId: ja.id, repetido: true, documentoId: ja.documentoId };
    }
    throw e;
  }
}

function numeroDaOs(n: number): string {
  return `OS ${String(n).padStart(4, "0")}`;
}

/**
 * Tira um anexo da OS. O arquivo vai para a **lixeira** do Drive, e não é
 * apagado: fica lá 30 dias e volta com dois cliques.
 */
export async function removerAnexo(ator: Ator, osId: string, anexoId: string): Promise<void> {
  const anexo = await db.query.osAnexo.findFirst({
    where: and(
      eq(schema.osAnexo.id, anexoId),
      eq(schema.osAnexo.ordemServicoId, osId),
      eq(schema.osAnexo.empresaId, ator.empresaId),
    ),
    with: { ordemServico: true },
  });
  if (!anexo) throw new ErroOs("nao_encontrado", "Anexo não encontrado.", 404);
  if (encerrada(anexo.ordemServico.status)) {
    throw new ErroOs("os_encerrada", "A OS já foi encerrada; os anexos ficam como estão.", 409);
  }
  if (!ator.gestao && anexo.enviadoPorId !== ator.id) {
    throw new ErroOs("sem_permissao", "Só quem enviou, ou a gestão, tira o anexo.", 403);
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.osAnexo).where(eq(schema.osAnexo.id, anexo.id));
    if (anexo.documentoId) {
      await tx.delete(schema.documento).where(eq(schema.documento.id, anexo.documentoId));
    }
    if (anexo.checklistItemId) await recalcularItem(tx, anexo.checklistItemId);
    await tx
      .update(schema.ordemServico)
      .set({ atualizadoEm: new Date() })
      .where(eq(schema.ordemServico.id, osId));
  });

  const arquivo = anexo.driveId ?? idDoLink(anexo.caminho);
  if (arquivo) await moverParaLixeira(arquivo).catch(() => undefined);
}

/** O arquivo de um anexo, para quem pode ver a OS. */
export async function abrirAnexo(ator: Ator, anexoId: string) {
  const anexo = await db.query.osAnexo.findFirst({
    where: and(eq(schema.osAnexo.id, anexoId), eq(schema.osAnexo.empresaId, ator.empresaId)),
    with: { ordemServico: { columns: { responsavelId: true } } },
  });
  if (!anexo || !podeVer(ator, anexo.ordemServico)) {
    throw new ErroOs("nao_encontrado", "Anexo não encontrado.", 404);
  }
  const arquivo = anexo.driveId ?? idDoLink(anexo.caminho);
  if (!arquivo) throw new ErroOs("nao_encontrado", "O anexo não tem arquivo no Drive.", 404);
  const baixado = await baixarArquivo(arquivo);
  return { ...baixado, tipo: anexo.mime ?? baixado.tipo, nome: anexo.nomeOriginal ?? "anexo" };
}

/** Os bytes de um anexo — o relatório em PDF desenha as fotos. */
export async function bytesDoAnexo(anexo: { driveId: string | null; caminho: string }): Promise<Uint8Array | null> {
  const arquivo = anexo.driveId ?? idDoLink(anexo.caminho);
  if (!arquivo) return null;
  try {
    const { corpo } = await baixarArquivo(arquivo);
    return new Uint8Array(await new Response(corpo).arrayBuffer());
  } catch {
    return null;
  }
}
