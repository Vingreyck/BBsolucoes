"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, schema } from "@/db";
import { ErroOs, exigirAtorWeb, exigirGestaoWeb } from "@/os/acesso";
import { anexar, removerAnexo, type CategoriaAnexo } from "@/os/anexos";
import {
  abrirRetorno,
  criarOs,
  executarAcao,
  renovarLinkRelatorio,
  type Acao,
} from "@/os/fluxo";
import { anotar } from "@/os/notas";
import { relogioDoCampo } from "@/os/relogio";
import { responderItem } from "@/os/respostas";
import type { PrioridadeOs, TipoOs } from "@/os/tipos";

/**
 * As ações da OS no site. A regra mora em `@/os`; aqui fica só o que é da
 * tela: ler o formulário, chamar a regra e voltar com a mensagem.
 *
 * Recusa de regra (`ErroOs`) vira mensagem na tela; qualquer outro erro sobe
 * como erro de verdade. E o `redirect` fica fora do `try`: no Next ele é uma
 * exceção, e um `catch` genérico o engoliria.
 */

type Mensagem = { ok?: string; erro?: string };

function destino(caminho: string, m: Mensagem): string {
  const q = new URLSearchParams();
  if (m.ok) q.set("ok", m.ok);
  if (m.erro) q.set("erro", m.erro);
  const s = q.toString();
  return s ? `${caminho}?${s}` : caminho;
}

async function tentar(fn: () => Promise<string | void>): Promise<Mensagem> {
  try {
    const ok = await fn();
    return ok ? { ok } : {};
  } catch (e) {
    if (e instanceof ErroOs) return { erro: e.message };
    throw e;
  }
}

function texto(form: FormData, campo: string): string {
  return String(form.get(campo) ?? "").trim();
}

function nuloSeVazio(form: FormData, campo: string): string | null {
  return texto(form, campo) || null;
}

/** Motivo de lista + detalhe livre. "Outro" exige o detalhe. */
function motivoDo(form: FormData): string {
  const m = texto(form, "motivo");
  const detalhe = texto(form, "motivoDetalhe");
  if (!m) return detalhe;
  if (m === "Outro") return detalhe;
  return detalhe ? `${m} — ${detalhe}` : m;
}

const TIPOS = new Set<string>(schema.tipoOs.enumValues);
const PRIORIDADES = new Set<string>(schema.prioridadeOs.enumValues);

const FEITO: Record<string, string> = {
  atribuir: "Responsável atualizado.",
  agendar: "Agendamento salvo.",
  deslocamento: "Registrado: saiu para o local.",
  iniciar: "Atendimento iniciado.",
  pausar: "Atendimento pausado.",
  retomar: "Atendimento retomado.",
  concluir: "OS concluída.",
  nao_atendida: "Registrada como não atendida — voltou para a fila.",
  cancelar: "OS cancelada.",
  reabrir: "OS reaberta.",
  editar: "Dados atualizados.",
};

// ---------------------------------------------------------------------------

export async function criarOsAction(form: FormData): Promise<void> {
  const ator = await exigirGestaoWeb();
  const clienteId = texto(form, "clienteId");
  const tipo = texto(form, "tipo");
  const prioridade = texto(form, "prioridade") || "normal";

  let criada: { id: string } | null = null;
  const m = await tentar(async () => {
    if (!TIPOS.has(tipo)) throw new ErroOs("validacao", "Escolha o tipo da OS.");
    if (!PRIORIDADES.has(prioridade)) throw new ErroOs("validacao", "Prioridade inválida.");
    const agendadaCampo = texto(form, "agendadaPara");
    const agendadaPara = relogioDoCampo(agendadaCampo);
    if (agendadaCampo && !agendadaPara) throw new ErroOs("validacao", "Data do agendamento inválida.");
    criada = await criarOs(ator, {
      clienteId,
      usinaId: nuloSeVazio(form, "usinaId"),
      projetoId: nuloSeVazio(form, "projetoId"),
      tipo: tipo as TipoOs,
      prioridade: prioridade as PrioridadeOs,
      descricao: texto(form, "descricao"),
      responsavelId: nuloSeVazio(form, "responsavelId"),
      agendadaPara,
      origem: texto(form, "origem") === "cliente" ? "cliente" : "manual",
    });
  });

  if (!criada) {
    const volta = new URLSearchParams({ cliente: clienteId });
    const projeto = texto(form, "projetoId");
    if (projeto) volta.set("projeto", projeto);
    if (m.erro) volta.set("erro", m.erro);
    redirect(`/os/nova?${volta.toString()}`);
  }
  const id = (criada as { id: string }).id;
  revalidatePath("/os");
  redirect(destino(`/os/${id}`, { ok: "OS aberta." }));
}

export async function acaoOsAction(osId: string, form: FormData): Promise<void> {
  const ator = await exigirAtorWeb();
  const tipo = texto(form, "acao");

  const m = await tentar(async () => {
    let acao: Acao;
    switch (tipo) {
      case "atribuir":
        acao = { tipo, responsavelId: nuloSeVazio(form, "responsavelId") };
        break;
      case "agendar": {
        const agendadaPara = relogioDoCampo(texto(form, "agendadaPara"));
        if (!agendadaPara) throw new ErroOs("validacao", "Escolha o dia e a hora.");
        acao = { tipo, agendadaPara, motivo: motivoDo(form) || null };
        break;
      }
      case "deslocamento":
      case "iniciar":
      case "retomar":
        acao = { tipo };
        break;
      case "pausar":
      case "nao_atendida":
      case "cancelar":
      case "reabrir":
        acao = { tipo, motivo: motivoDo(form) };
        break;
      case "concluir":
        acao = {
          tipo,
          resultado: texto(form, "resultado") === "nao_resolvido" ? "nao_resolvido" : "resolvido",
          laudo: nuloSeVazio(form, "laudo"),
          assinaturaNome: nuloSeVazio(form, "assinaturaNome"),
        };
        break;
      case "editar": {
        const prioridade = texto(form, "prioridade");
        const prazoCampo = texto(form, "prazoSla");
        acao = {
          tipo,
          descricao: form.has("descricao") ? texto(form, "descricao") : undefined,
          prioridade: PRIORIDADES.has(prioridade) ? (prioridade as PrioridadeOs) : undefined,
          usinaId: form.has("usinaId") ? nuloSeVazio(form, "usinaId") : undefined,
          projetoId: form.has("projetoId") ? nuloSeVazio(form, "projetoId") : undefined,
          prazoSla: form.has("prazoSla") ? relogioDoCampo(prazoCampo) : undefined,
        };
        break;
      }
      default:
        throw new ErroOs("validacao", "Ação desconhecida.");
    }
    const r = await executarAcao(ator, osId, acao);
    return [FEITO[tipo], ...r.avisos].filter(Boolean).join(" ");
  });

  revalidatePath(`/os/${osId}`);
  revalidatePath("/os");
  redirect(destino(`/os/${osId}`, m));
}

export async function responderItemAction(osId: string, itemId: string, form: FormData): Promise<void> {
  const ator = await exigirAtorWeb();
  const tipoResposta = texto(form, "tipoResposta");

  const m = await tentar(async () => {
    let valor: unknown;
    if (tipoResposta === "multipla") valor = form.getAll("valor").map(String);
    else if (tipoResposta === "serial") valor = texto(form, "valor").split(/[\n,;]+/);
    else valor = texto(form, "valor");
    const r = await responderItem(ator, osId, itemId, {
      valor,
      observacao: form.has("observacao") ? texto(form, "observacao") : undefined,
    });
    return ["Resposta salva.", ...r.avisos].join(" ");
  });

  revalidatePath(`/os/${osId}`);
  redirect(destino(`/os/${osId}`, m) + `#item-${itemId}`);
}

export async function anexarAction(osId: string, form: FormData): Promise<void> {
  const ator = await exigirAtorWeb();
  const itemId = nuloSeVazio(form, "itemId");

  const m = await tentar(async () => {
    const arquivos = form.getAll("arquivo").filter((f): f is File => f instanceof File && f.size > 0);
    if (!arquivos.length) throw new ErroOs("validacao", "Escolha uma foto.");
    const categoria = (texto(form, "categoria") || "foto") as CategoriaAnexo;
    for (const arquivo of arquivos) {
      const modificado = new Date(arquivo.lastModified);
      await anexar(ator, osId, {
        conteudo: new Uint8Array(await arquivo.arrayBuffer()),
        nomeOriginal: arquivo.name,
        categoria,
        itemId,
        capturadoEm: Number.isNaN(modificado.getTime()) ? null : modificado,
      });
    }
    return arquivos.length === 1 ? "Foto enviada." : `${arquivos.length} fotos enviadas.`;
  });

  revalidatePath(`/os/${osId}`);
  redirect(destino(`/os/${osId}`, m) + (itemId ? `#item-${itemId}` : "#anexos"));
}

export async function removerAnexoAction(osId: string, anexoId: string): Promise<void> {
  const ator = await exigirAtorWeb();
  const m = await tentar(async () => {
    await removerAnexo(ator, osId, anexoId);
    return "Anexo removido (o arquivo foi para a lixeira do Drive).";
  });
  revalidatePath(`/os/${osId}`);
  redirect(destino(`/os/${osId}`, m));
}

export async function abrirRetornoAction(osId: string): Promise<void> {
  const ator = await exigirGestaoWeb();
  let nova: { id: string } | null = null;
  const m = await tentar(async () => {
    nova = await abrirRetorno(ator, osId);
  });
  if (!nova) redirect(destino(`/os/${osId}`, m));
  revalidatePath("/os");
  redirect(destino(`/os/${(nova as { id: string }).id}`, { ok: "Retorno aberto." }));
}

export async function renovarLinkAction(osId: string): Promise<void> {
  const ator = await exigirGestaoWeb();
  const m = await tentar(async () => {
    await renovarLinkRelatorio(ator, osId);
    return "Link novo gerado. O anterior parou de abrir.";
  });
  revalidatePath(`/os/${osId}`);
  redirect(destino(`/os/${osId}`, m) + "#relatorio");
}

export async function comentarOsAction(osId: string, form: FormData): Promise<void> {
  const ator = await exigirAtorWeb();
  const corpo = texto(form, "texto");
  if (corpo) {
    // Mesma regra do app (`@/os/notas`): quem vê a OS escreve nela.
    await anotar(ator, osId, corpo).catch((e) => {
      if (!(e instanceof ErroOs)) throw e;
    });
  }
  revalidatePath(`/os/${osId}`);
  redirect(`/os/${osId}#comentarios`);
}

/** Alerta crítico vira OS urgente; o resto entra como normal. */
function prioridadeDe(severidade: string): PrioridadeOs {
  return severidade === "critico" ? "urgente" : "normal";
}

/**
 * Abre uma ordem de serviço a partir de um alerta.
 *
 * É o elo entre monitorar e operar: sem ele o sistema avisa que a usina parou e
 * a informação morre na tela. A OS carrega de onde veio, e o alerta guarda para
 * onde foi, então nenhum dos dois lados fica órfão.
 */
export async function abrirOsDoAlerta(alertaId: string): Promise<void> {
  const ator = await exigirGestaoWeb();

  const alerta = await db.query.alerta.findFirst({
    where: and(eq(schema.alerta.id, alertaId), eq(schema.alerta.empresaId, ator.empresaId)),
    with: { usina: { columns: { id: true, clienteId: true } } },
  });
  if (!alerta) redirect("/alertas");

  // Já tem OS: leva para lá em vez de abrir outra para o mesmo problema.
  if (alerta.ordemServicoId) redirect(`/os/${alerta.ordemServicoId}`);

  // A OS existe para alguém ir até uma pessoa, e usina sem dono não tem
  // pessoa. Manda para a fila de quem precisa ser ligado.
  const clienteId = alerta.usina.clienteId;
  if (!clienteId) redirect(`/usinas/sem-dono?usina=${alerta.usinaId}`);

  const os = await criarOs(ator, {
    clienteId,
    usinaId: alerta.usinaId,
    tipo: "corretiva",
    prioridade: prioridadeDe(alerta.severidade),
    descricao: alerta.mensagem,
    origem: "alerta",
  });
  await db
    .update(schema.alerta)
    .set({ ordemServicoId: os.id, status: "reconhecido" })
    .where(eq(schema.alerta.id, alertaId));

  revalidatePath("/alertas");
  revalidatePath("/os");
  redirect(`/os/${os.id}`);
}
