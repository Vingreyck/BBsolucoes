import { randomBytes } from "node:crypto";

import { and, asc, eq, like } from "drizzle-orm";

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

import {
  apagarDoDeposito,
  arquivoPendente,
  caminhoPendente,
  guardarNoDeposito,
  lerDoDeposito,
  limparOrfaos,
} from "./deposito-local";

import { ErroOs, podeExecutar, podeVer, type Ator } from "./acesso";
import { violouUnico } from "./fluxo";
import { relogioDe } from "./relogio";
import { EXTENSAO, tipoReal, TAMANHO_MAXIMO_VIDEO } from "./tipo-arquivo";
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
 * O técnico não espera o Google: o arquivo fica primeiro no disco do servidor
 * (`deposito-local.ts`) e sobe para o Drive logo em seguida, em segundo plano
 * ([subirPendente]). Enquanto isso o `caminho` é `pendente://…`, e abrir o anexo
 * lê do disco.
 *
 * Quando o item diz que a foto é um documento do dossiê (`tipoDocumento`, como
 * a foto do padrão), ela entra também no dossiê da venda: a exigência da etapa
 * fica cumprida sem ninguém baixar a foto do WhatsApp e subir de novo — que é
 * exatamente o que travava 70 dossiês.
 */

export const CATEGORIAS = ["foto", "video", "assinatura", "documento"] as const;
export type CategoriaAnexo = (typeof CATEGORIAS)[number];

/** 15 MB. Foto de celular comprimida pelo app fica bem abaixo disso. */
const TAMANHO_MAXIMO = 15 * 1024 * 1024;

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
  const mime = tipoReal(novo.conteudo);
  const ehVideo = mime === "video/mp4" || mime === "video/quicktime";
  if (novo.conteudo.byteLength > (ehVideo ? TAMANHO_MAXIMO_VIDEO : TAMANHO_MAXIMO)) {
    throw new ErroOs("validacao", `O arquivo passou de ${ehVideo ? 50 : 15} MB.`, 413);
  }
  const aceitos =
    novo.categoria === "documento"
      ? ["image/jpeg", "image/png", "application/pdf"]
      : novo.categoria === "assinatura"
        ? ["image/jpeg", "image/png"]
        : ["image/jpeg", "image/png", "video/mp4", "video/quicktime"];
  if (!mime || !aceitos.includes(mime)) {
    throw new ErroOs(
      "validacao",
      novo.categoria === "documento"
        ? "Envie PDF, JPEG ou PNG."
        : novo.categoria === "assinatura"
          ? "A assinatura precisa ser JPEG ou PNG."
          : "A foto precisa ser JPEG ou PNG (ou um vídeo MP4/MOV, onde o item aceita).",
      415,
    );
  }
  // O tipo vale pelo conteúdo: um vídeo mandado como "foto" é um vídeo.
  const categoria: CategoriaAnexo = ehVideo ? "video" : novo.categoria === "video" ? "foto" : novo.categoria;
  if (ehVideo && !item?.aceitaVideo) {
    throw new ErroOs("validacao", "Este item não aceita vídeo — tire uma foto.", 415);
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

  const coord = (v: number | null | undefined, lim: number) =>
    v !== null && v !== undefined && Number.isFinite(v) && Math.abs(v) <= lim ? v.toFixed(7) : null;

  // Primeiro no disco do servidor, se houver espaço; sem espaço, direto ao
  // Drive, como sempre foi.
  const local = guardarNoDeposito(novo.conteudo, EXTENSAO[mime]);
  const enviado = local ? null : await subirParaDrive(os, item, categoria, mime, capturadoEm, novo.conteudo);

  try {
    const resultado = await db.transaction(async (tx) => {
      const [anexo] = await tx
        .insert(schema.osAnexo)
        .values({
          empresaId: os.empresaId,
          ordemServicoId: os.id,
          categoria,
          caminho: enviado ? enviado.link : caminhoPendente(local!),
          nomeOriginal:
            novo.nomeOriginal?.slice(0, 200) ?? enviado?.nome ?? nomeNoDrive(os.numero, item, categoria, mime, capturadoEm),
          tamanhoBytes: novo.conteudo.byteLength,
          enviadoPorId: ator.id,
          capturadoEm,
          checklistItemId: item?.id ?? null,
          idCliente: novo.idCliente ?? null,
          mime,
          driveId: enviado?.id ?? null,
          latitude: coord(novo.latitude, 90),
          longitude: coord(novo.longitude, 180),
        })
        .returning({ id: schema.osAnexo.id });

      // Pendente, o dossiê recebe a foto quando ela chegar ao Drive.
      const documentoId =
        enviado && item?.tipoDocumento && os.projetoId && !ehVideo
          ? await entrarNoDossie(tx, {
              anexoId: anexo.id,
              os: { ...os, projetoId: os.projetoId },
              tipo: item.tipoDocumento,
              enviado,
              tamanho: novo.conteudo.byteLength,
              usuarioId: ator.id,
              origem: ator.origem === "app" ? "app" : "site",
            })
          : null;

      if (item) await recalcularItem(tx, item.id);
      await tx
        .update(schema.ordemServico)
        .set({ atualizadoEm: new Date() })
        .where(eq(schema.ordemServico.id, os.id));

      return { anexoId: anexo.id, repetido: false, documentoId };
    });
    if (local) void subirPendente(resultado.anexoId);
    return resultado;
  } catch (e) {
    if (local) apagarDoDeposito(local);
    // Duas cópias da mesma foto subiram ao mesmo tempo: fica a primeira, e o
    // arquivo da segunda vai para a lixeira do Drive (ou some do disco).
    if (novo.idCliente && violouUnico(e, "os_anexo_id_cliente_uq")) {
      if (enviado) await moverParaLixeira(enviado.id).catch(() => undefined);
      const ja = await anexoPeloIdCliente(ator.empresaId, novo.idCliente);
      if (ja) return { anexoId: ja.id, repetido: true, documentoId: ja.documentoId };
    }
    throw e;
  }
}

type Transacao = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ItemDoAnexo = { descricao: string } | null | undefined;

/** "OS 0047 - Foto do padrão - 20261030-143000-a1b2.jpg" */
function nomeNoDrive(
  numero: number,
  item: ItemDoAnexo,
  categoria: CategoriaAnexo,
  mime: string,
  capturadoEm: Date,
): string {
  const num = String(numero).padStart(4, "0");
  const rotulo =
    categoria === "assinatura"
      ? "Assinatura do cliente"
      : (item?.descricao.slice(0, 70) ??
        (categoria === "documento" ? "Documento" : categoria === "video" ? "Vídeo" : "Foto"));
  return (
    limparNome(`OS ${num} - ${rotulo} - ${carimbo(capturadoEm)}-${randomBytes(2).toString("hex")}`) +
    EXTENSAO[mime]
  );
}

interface NoDrive {
  id: string;
  link: string;
  nome: string;
  pasta: string;
  pastaCliente: string;
}

/** Sobe para a pasta da OS, dentro da pasta do cliente. */
async function subirParaDrive(
  os: { empresaId: string; numero: number; tipo: string; cliente: { id: string; nome: string } },
  item: ItemDoAnexo,
  categoria: CategoriaAnexo,
  mime: string,
  capturadoEm: Date,
  conteudo: Uint8Array,
): Promise<NoDrive> {
  const num = String(os.numero).padStart(4, "0");
  const pastaCliente = await pastaDoCliente(os.empresaId, os.cliente);
  const pasta = `OS ${num} - ${TIPO_ROTULO[os.tipo] ?? os.tipo}`;
  const pastaOs = await garantirPasta(pasta, pastaCliente);
  const nome = nomeNoDrive(os.numero, item, categoria, mime, capturadoEm);
  const enviado = await enviarArquivo({ nome, mimeType: mime, pastaId: pastaOs, conteudo });
  return {
    id: enviado.id,
    link: enviado.webViewLink ?? `https://drive.google.com/file/d/${enviado.id}/view`,
    nome,
    pasta,
    pastaCliente,
  };
}

/**
 * A foto que é documento (a do padrão, por exemplo) entra no dossiê da venda.
 * Só depois de estar no Drive: o dossiê sempre aponta para o arquivo de lá.
 */
async function entrarNoDossie(
  tx: Transacao,
  d: {
    anexoId: string;
    os: { empresaId: string; clienteId: string; projetoId: string; numero: number };
    tipo: NonNullable<typeof schema.documento.$inferInsert.tipo>;
    enviado: NoDrive;
    tamanho: number;
    usuarioId: string | null;
    origem: "app" | "site" | null;
  },
): Promise<string> {
  const [doc] = await tx
    .insert(schema.documento)
    .values({
      empresaId: d.os.empresaId,
      clienteId: d.os.clienteId,
      projetoId: d.os.projetoId,
      tipo: d.tipo,
      status: "indefinido",
      nomeArquivo: d.enviado.nome,
      caminho: d.enviado.pasta,
      linkDrive: d.enviado.link,
      pastaExterna: d.enviado.pastaCliente.slice(0, 80),
      origem: `CLIENTES ${new Date().getFullYear()}`,
      tamanhoBytes: d.tamanho,
      modificadoEm: new Date(),
      criadoPor: d.usuarioId,
    })
    .returning({ id: schema.documento.id });
  await tx.update(schema.osAnexo).set({ documentoId: doc.id }).where(eq(schema.osAnexo.id, d.anexoId));
  await tx.insert(schema.documentoAcesso).values({
    empresaId: d.os.empresaId,
    documentoId: doc.id,
    descricao: `${d.enviado.nome} (${numeroDaOs(d.os.numero)}${d.origem ? `, pelo ${d.origem}` : ""})`,
    usuarioId: d.usuarioId,
    acao: "enviou",
  });
  return doc.id;
}

/** Os que estão subindo agora — o envio logo após o anexo e a ronda não sobem o mesmo duas vezes. */
const subindo = new Set<string>();

/**
 * Leva ao Drive um anexo que ficou no disco. Devolve `true` se subiu.
 *
 * Se o anexo foi tirado da OS enquanto subia, o arquivo já enviado vai para a
 * lixeira do Drive. Falhou (Drive fora do ar)? Fica no disco, e a ronda de
 * minuto em minuto tenta de novo.
 */
export async function subirPendente(anexoId: string): Promise<boolean> {
  if (subindo.has(anexoId)) return false;
  subindo.add(anexoId);
  try {
    const anexo = await db.query.osAnexo.findFirst({
      where: eq(schema.osAnexo.id, anexoId),
      with: { ordemServico: { with: { cliente: { columns: { id: true, nome: true } } } } },
    });
    const arquivo = arquivoPendente(anexo?.caminho);
    if (!anexo || !arquivo) return false;
    const conteudo = lerDoDeposito(arquivo);
    if (!conteudo) {
      console.error(`[anexos] o arquivo do anexo ${anexoId} sumiu do disco antes de subir.`);
      return false;
    }
    const item = anexo.checklistItemId
      ? await db.query.osChecklistItem.findFirst({ where: eq(schema.osChecklistItem.id, anexo.checklistItemId) })
      : null;
    const os = anexo.ordemServico;
    const mime = anexo.mime ?? "application/octet-stream";
    const categoria = anexo.categoria as CategoriaAnexo;
    const enviado = await subirParaDrive(os, item, categoria, mime, anexo.capturadoEm ?? anexo.criadoEm, conteudo);

    const gravou = await db.transaction(async (tx) => {
      const linhas = await tx
        .update(schema.osAnexo)
        .set({ caminho: enviado.link, driveId: enviado.id })
        .where(and(eq(schema.osAnexo.id, anexo.id), eq(schema.osAnexo.caminho, anexo.caminho)))
        .returning({ id: schema.osAnexo.id });
      if (!linhas.length) return false;
      if (item?.tipoDocumento && os.projetoId && categoria !== "video" && !anexo.documentoId) {
        await entrarNoDossie(tx, {
          anexoId: anexo.id,
          os: { ...os, projetoId: os.projetoId },
          tipo: item.tipoDocumento,
          enviado,
          tamanho: conteudo.byteLength,
          usuarioId: anexo.enviadoPorId,
          origem: null,
        });
      }
      return true;
    });
    if (!gravou) await moverParaLixeira(enviado.id).catch(() => undefined);
    apagarDoDeposito(arquivo);
    return gravou;
  } catch (e) {
    console.warn(`[anexos] ${anexoId} não subiu ao Drive, tento de novo depois:`, e instanceof Error ? e.message : e);
    return false;
  } finally {
    subindo.delete(anexoId);
  }
}

/** Uma ronda: sobe os pendentes, do mais antigo ao mais novo, e limpa o que ficou sem dono. */
export async function subirPendentes(): Promise<{ subiram: number; faltam: number }> {
  const pendentes = await db
    .select({ id: schema.osAnexo.id, caminho: schema.osAnexo.caminho })
    .from(schema.osAnexo)
    .where(like(schema.osAnexo.caminho, "pendente://%"))
    .orderBy(asc(schema.osAnexo.criadoEm));
  let subiram = 0;
  for (const p of pendentes) if (await subirPendente(p.id)) subiram++;
  limparOrfaos(new Set(pendentes.map((p) => arquivoPendente(p.caminho)).filter((a): a is string => a !== null)));
  return { subiram, faltam: pendentes.length - subiram };
}

let ronda: ReturnType<typeof setInterval> | null = null;

/** Chamado uma vez quando o site sobe (`instrumentation.ts`). */
export function iniciarEnvioDeAnexos(intervaloMs = 60_000): void {
  if (ronda) return;
  let ocupado = false;
  const rodar = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      await subirPendentes();
    } catch (e) {
      console.warn("[anexos] a ronda de envio ao Drive falhou:", e instanceof Error ? e.message : e);
    } finally {
      ocupado = false;
    }
  };
  ronda = setInterval(rodar, intervaloMs);
  ronda.unref?.();
  void rodar();
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

  const local = arquivoPendente(anexo.caminho);
  if (local) {
    apagarDoDeposito(local);
    return;
  }
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
  const local = arquivoPendente(anexo.caminho);
  if (local) {
    const bytes = lerDoDeposito(local);
    if (!bytes) throw new ErroOs("nao_encontrado", "O arquivo do anexo ainda está subindo; tente de novo.", 404);
    return {
      corpo: new Blob([bytes as Uint8Array<ArrayBuffer>]).stream(),
      tamanho: String(bytes.byteLength),
      tipo: anexo.mime ?? "application/octet-stream",
      nome: anexo.nomeOriginal ?? "anexo",
    };
  }
  const arquivo = anexo.driveId ?? idDoLink(anexo.caminho);
  if (!arquivo) throw new ErroOs("nao_encontrado", "O anexo não tem arquivo no Drive.", 404);
  const baixado = await baixarArquivo(arquivo);
  return { ...baixado, tipo: anexo.mime ?? baixado.tipo, nome: anexo.nomeOriginal ?? "anexo" };
}

/** Os bytes de um anexo — o relatório em PDF desenha as fotos. */
export async function bytesDoAnexo(anexo: { driveId: string | null; caminho: string }): Promise<Uint8Array | null> {
  const local = arquivoPendente(anexo.caminho);
  if (local) return lerDoDeposito(local);
  const arquivo = anexo.driveId ?? idDoLink(anexo.caminho);
  if (!arquivo) return null;
  try {
    const { corpo } = await baixarArquivo(arquivo);
    return new Uint8Array(await new Response(corpo).arrayBuffer());
  } catch {
    return null;
  }
}
