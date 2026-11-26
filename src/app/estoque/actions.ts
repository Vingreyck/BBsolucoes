"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, schema } from "@/db";
import type { LinhaDaEntrada } from "@/db/schema/estoque";
import { tipoDoDocumento } from "@/documentos/conteudo";
import { exigirEstoque } from "@/estoque/acesso";
import {
  ajustarSaldo,
  descartarRascunho,
  desfazerEntrada,
  ErroEstoque,
  guardarArquivo,
  lancarAMao,
  lancarEntrada,
  salvarItem,
  type LinhaConferida,
} from "@/estoque/estoque";
import { lerDocumentoDeEntrada, tipoDoArquivoDeEntrada, type DocumentoLido, type PapelDoArquivo } from "@/estoque/ler-documento";
import { marcarRepetidos, normalizarUnidade, numeroBr, sugerirItem } from "@/estoque/regras";

/**
 * As ações do estoque no site. A regra mora em `@/estoque`; aqui fica o que é
 * da tela: ler o formulário, chamar a regra e voltar com a mensagem. O
 * `redirect` fica fora do `try` (no Next ele é uma exceção).
 */

/** 20 MB por arquivo: PDF de pedido com foto passa de 10 às vezes. */
const ARQUIVO_MAXIMO = 20 * 1024 * 1024;

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
    if (e instanceof ErroEstoque) return { erro: e.message };
    throw e;
  }
}

function texto(form: FormData, campo: string, max = 300): string {
  return String(form.get(campo) ?? "").trim().slice(0, max);
}

function revalidar(): void {
  revalidatePath("/estoque");
  revalidatePath("/estoque/entradas");
  revalidatePath("/estoque/movimentos");
}

// ------------------------------------------------------------------ entrada por anexo

interface ArquivoRecebido {
  papel: PapelDoArquivo;
  conteudo: Uint8Array;
  tipo: { mime: string; extensao: string };
}

async function receber(form: FormData, campo: PapelDoArquivo): Promise<ArquivoRecebido | null> {
  const f = form.get(campo);
  if (!(f instanceof File) || f.size === 0) return null;
  const rotulo = campo === "nota" ? "A nota" : "O pedido";
  if (f.size > ARQUIVO_MAXIMO) throw new ErroEstoque(`${rotulo} passou de 20 MB.`);
  const conteudo = new Uint8Array(await f.arrayBuffer());
  // O conteúdo diz o que o arquivo é, nunca o nome ou o tipo declarado.
  const tipo = tipoDoArquivoDeEntrada(conteudo, tipoDoDocumento(conteudo, f.name));
  if (!tipo) throw new ErroEstoque(`${rotulo} precisa ser o XML da NF-e, um PDF ou uma foto (JPEG ou PNG).`);
  if (campo === "pedido" && tipo.mime === "application/xml") {
    // XML de NF-e no campo do pedido: é nota, lê como nota.
    return { papel: "nota", conteudo, tipo };
  }
  return { papel: campo, conteudo, tipo };
}

/**
 * Recebe a nota e/ou o pedido, lê os itens e abre a conferência. Nada mexe no
 * saldo aqui: a entrada nasce como rascunho.
 */
export async function enviarDocumentosAction(form: FormData): Promise<void> {
  const usuario = await exigirEstoque();
  let criada: string | null = null;

  const m = await tentar(async () => {
    const recebidos = [await receber(form, "nota"), await receber(form, "pedido")].filter((a): a is ArquivoRecebido => a !== null);
    if (!recebidos.length) throw new ErroEstoque("Escolha a nota fiscal, o pedido, ou os dois.");

    const lidos: { papel: PapelDoArquivo; lido: DocumentoLido | null; erro: string | null }[] = [];
    for (const a of recebidos) {
      const r = await lerDocumentoDeEntrada(a.conteudo, a.tipo.mime, a.papel);
      lidos.push("lido" in r ? { papel: a.papel, lido: r.lido, erro: null } : { papel: a.papel, lido: null, erro: r.erro });
    }

    // Cabeçalho: o da nota vale mais que o do pedido.
    const ordem = [...lidos].sort((x, y) => (x.papel === "nota" ? 0 : 1) - (y.papel === "nota" ? 0 : 1));
    const pega = <K extends keyof DocumentoLido>(k: K): DocumentoLido[K] | null => {
      for (const l of ordem) if (l.lido && l.lido[k] !== null && l.lido[k] !== undefined) return l.lido[k];
      return null;
    };
    const chaveAcesso = pega("chaveAcesso") as string | null;
    if (chaveAcesso) {
      const ja = await db.query.entradaEstoque.findFirst({
        where: and(
          eq(schema.entradaEstoque.empresaId, usuario.empresaId),
          eq(schema.entradaEstoque.chaveAcesso, chaveAcesso),
          eq(schema.entradaEstoque.situacao, "lancada"),
        ),
        columns: { id: true, numero: true },
      });
      if (ja) throw new ErroEstoque(`Esta nota fiscal${ja.numero ? ` (nº ${ja.numero})` : ""} já foi lançada no estoque.`);
    }

    // Itens: os da nota primeiro, depois os do pedido; o que repete começa fora.
    const [itens, modelos] = await Promise.all([
      db.query.itemEstoque.findMany({
        where: eq(schema.itemEstoque.empresaId, usuario.empresaId),
        columns: { id: true, nome: true, codigo: true, modeloEquipamentoId: true },
      }),
      db.query.modeloEquipamento.findMany({
        where: eq(schema.modeloEquipamento.empresaId, usuario.empresaId),
        columns: { id: true, fabricante: true, modelo: true },
        orderBy: asc(schema.modeloEquipamento.modelo),
      }),
    ]);
    const linhas = marcarRepetidos(ordem.flatMap((l) => l.lido?.linhas ?? [])).map((l) => ({ ...l, ...sugerirItem(l, itens, modelos) }));

    const avisos = [
      ...lidos.map((l) => (l.erro ? `${l.papel === "nota" ? "Nota" : "Pedido"}: ${l.erro}` : null)),
      ...lidos.map((l) => l.lido?.aviso ?? null),
    ].filter(Boolean);
    const leitura = lidos.some((l) => l.lido?.leitura === "xml") ? "xml" : lidos.some((l) => l.lido) ? "ia" : "manual";

    const [entrada] = await db
      .insert(schema.entradaEstoque)
      .values({
        empresaId: usuario.empresaId,
        numero: (pega("numero") as string | null)?.slice(0, 60) ?? null,
        fornecedor: (pega("fornecedor") as string | null)?.slice(0, 200) ?? null,
        cnpjFornecedor: pega("cnpjFornecedor") as string | null,
        emitidaEm: pega("emitidaEm") as string | null,
        chaveAcesso,
        valorTotal: pega("valorTotal") === null ? null : String(pega("valorTotal")),
        leitura,
        itensLidos: linhas,
        criadoPor: usuario.id,
      })
      .returning({ id: schema.entradaEstoque.id });
    criada = entrada.id;

    // O arquivo vai para o Drive como os documentos do dossiê. Se o Drive falhar,
    // a conferência continua: o aviso diz que o arquivo não ficou guardado.
    const rotulo = [pega("numero"), pega("fornecedor")].filter(Boolean).join(" - ") || new Date().toISOString().slice(0, 10);
    let semDrive = false;
    for (const a of recebidos) {
      try {
        const g = await guardarArquivo(usuario.empresaId, entrada.id, a.papel, a.conteudo, a.tipo, String(rotulo));
        if (!g.guardado) semDrive = true;
      } catch (e) {
        console.error("[estoque] arquivo da entrada não subiu para o Drive", e);
        semDrive = true;
      }
    }
    if (semDrive) avisos.push("O arquivo não foi guardado no Drive (sem conexão ou não configurado): a entrada vale, mas sem o anexo.");
    if (avisos.length) {
      await db.update(schema.entradaEstoque).set({ aviso: avisos.join("\n") }).where(eq(schema.entradaEstoque.id, entrada.id));
    }
  });

  if (!criada) redirect(destino("/estoque/entradas/nova", m));
  revalidar();
  redirect(`/estoque/entradas/${criada}`);
}

/**
 * Adicionar à mão: os itens digitados entram direto no saldo (sem conferência,
 * porque quem digitou já conferiu). Nome que já existe soma no mesmo item.
 */
export async function lancarAMaoAction(form: FormData): Promise<void> {
  const usuario = await exigirEstoque();
  const total = Math.min(200, Number(form.get("linhas") ?? 0) || 0);
  const linhas = Array.from({ length: total }, (_, i) => ({
    nome: texto(form, `nome_${i}`, 200),
    quantidade: texto(form, `quantidade_${i}`, 20),
    unidade: normalizarUnidade(texto(form, `unidade_${i}`, 10)),
  })).filter((l) => l.nome || l.quantidade);
  const m = await tentar(async () => {
    const sem = linhas.find((l) => !l.nome);
    if (sem) throw new ErroEstoque("Toda linha com quantidade precisa do nome do item.");
    const r = await lancarAMao({ id: usuario.id, empresaId: usuario.empresaId }, cabecalhoDoFormulario(form), linhas);
    return r.itens === 1 ? "1 item entrou no estoque." : `${r.itens} itens entraram no estoque.`;
  });
  revalidar();
  redirect(destino(m.erro ? "/estoque/entradas/nova" : "/estoque", m) + (m.erro ? "#a-mao" : ""));
}

// ------------------------------------------------------------------ conferência

function linhasDoFormulario(form: FormData): LinhaConferida[] {
  const total = Math.min(500, Number(form.get("linhas") ?? 0) || 0);
  const linhas: LinhaConferida[] = [];
  for (let i = 0; i < total; i++) {
    const descricao = texto(form, `descricao_${i}`);
    const itemId = texto(form, `item_${i}`, 40) || null;
    if (!descricao && !itemId) continue;
    const origem = texto(form, `origem_${i}`, 12);
    linhas.push({
      entra: form.get(`entra_${i}`) === "on",
      descricao,
      quantidade: texto(form, `quantidade_${i}`, 20),
      unidade: normalizarUnidade(texto(form, `unidade_${i}`, 10)),
      itemId,
      modeloId: texto(form, `modelo_${i}`, 40) || null,
      codigo: texto(form, `codigo_${i}`, 60) || null,
      valorUnitario: numeroBr(texto(form, `valor_${i}`, 20)),
      origem: origem === "observacao" || origem === "pedido" ? origem : "lista",
    });
  }
  return linhas;
}

function cabecalhoDoFormulario(form: FormData) {
  return {
    numero: texto(form, "numero", 60) || null,
    fornecedor: texto(form, "fornecedor", 200) || null,
    emitidaEm: texto(form, "emitidaEm", 10) || null,
  };
}

export async function lancarEntradaAction(entradaId: string, form: FormData): Promise<void> {
  const usuario = await exigirEstoque();
  const linhas = linhasDoFormulario(form);
  const cabecalho = cabecalhoDoFormulario(form);
  const m = await tentar(async () => {
    const r = await lancarEntrada({ id: usuario.id, empresaId: usuario.empresaId }, entradaId, cabecalho, linhas);
    return r.itens === 1 ? "1 item entrou no estoque." : `${r.itens} itens entraram no estoque.`;
  });
  if (m.erro) {
    // O que foi digitado não se perde: fica no rascunho para corrigir.
    const rascunho: LinhaDaEntrada[] = linhas.map((l) => ({
      descricao: l.descricao,
      quantidade: numeroBr(String(l.quantidade)) ?? 0,
      unidade: l.unidade,
      codigo: l.codigo,
      valorUnitario: l.valorUnitario,
      origem: l.origem,
      entra: l.entra,
      motivo: null,
      itemId: l.itemId,
      modeloId: l.modeloId,
    }));
    await db
      .update(schema.entradaEstoque)
      .set({
        itensLidos: rascunho,
        numero: cabecalho.numero,
        fornecedor: cabecalho.fornecedor,
        emitidaEm: cabecalho.emitidaEm && /^\d{4}-\d{2}-\d{2}$/.test(cabecalho.emitidaEm) ? cabecalho.emitidaEm : null,
      })
      .where(
        and(
          eq(schema.entradaEstoque.id, entradaId),
          eq(schema.entradaEstoque.empresaId, usuario.empresaId),
          eq(schema.entradaEstoque.situacao, "rascunho"),
        ),
      );
  }
  revalidar();
  redirect(destino(`/estoque/entradas/${entradaId}`, m));
}

export async function descartarEntradaAction(entradaId: string): Promise<void> {
  const usuario = await exigirEstoque();
  const m = await tentar(async () => {
    await descartarRascunho({ id: usuario.id, empresaId: usuario.empresaId }, entradaId);
    return "Rascunho descartado (os arquivos foram para a lixeira do Drive).";
  });
  revalidar();
  redirect(destino(m.erro ? `/estoque/entradas/${entradaId}` : "/estoque/entradas", m));
}

/** Desfazer uma entrada lançada tira do saldo o que ela somou. Só o administrador. */
export async function desfazerEntradaAction(entradaId: string): Promise<void> {
  const usuario = await exigirEstoque();
  if (usuario.papel !== "adm") redirect(destino(`/estoque/entradas/${entradaId}`, { erro: "Só o administrador desfaz uma entrada lançada." }));
  const m = await tentar(async () => {
    await desfazerEntrada({ id: usuario.id, empresaId: usuario.empresaId }, entradaId);
    return "Entrada desfeita: o que ela somou saiu do saldo (com estorno no histórico).";
  });
  revalidar();
  redirect(destino(`/estoque/entradas/${entradaId}`, m));
}

// ------------------------------------------------------------------ itens

/** Volta para a lista do saldo mantendo a busca e a página em que a pessoa estava. */
function voltarParaSaldo(form: FormData, m: Mensagem): never {
  const volta = texto(form, "volta", 300);
  const caminho = volta.startsWith("/estoque") && !volta.startsWith("//") ? volta : "/estoque";
  const [base, busca] = caminho.split("?");
  const q = new URLSearchParams(busca ?? "");
  q.delete("ok");
  q.delete("erro");
  if (m.ok) q.set("ok", m.ok);
  if (m.erro) q.set("erro", m.erro);
  const s = q.toString();
  redirect(s ? `${base}?${s}` : base);
}

export async function ajustarAction(itemId: string, form: FormData): Promise<void> {
  const usuario = await exigirEstoque();
  const m = await tentar(async () => {
    const contado = numeroBr(texto(form, "contado", 20));
    if (contado === null) throw new ErroEstoque("Diga quanto tem na prateleira.");
    const diferenca = await ajustarSaldo({ id: usuario.id, empresaId: usuario.empresaId }, itemId, contado, texto(form, "observacao"));
    if (diferenca === 0) return "O saldo já era esse: nada mudou.";
    return `Saldo ajustado (${diferenca > 0 ? "+" : ""}${diferenca.toLocaleString("pt-BR")}).`;
  });
  revalidar();
  voltarParaSaldo(form, m);
}

export async function salvarItemAction(itemId: string, form: FormData): Promise<void> {
  const usuario = await exigirEstoque();
  const m = await tentar(async () => {
    const minimoTexto = texto(form, "minimo", 20);
    const minimo = minimoTexto ? numeroBr(minimoTexto) : null;
    if (minimoTexto && (minimo === null || minimo < 0)) throw new ErroEstoque("O mínimo precisa ser um número (zero ou mais).");
    await salvarItem({ id: usuario.id, empresaId: usuario.empresaId }, itemId, {
      nome: texto(form, "nome", 200),
      unidade: texto(form, "unidade", 10),
      minimo,
      modeloId: texto(form, "modelo", 40) || null,
      ativo: form.get("ativo") === "on",
    });
    return "Item salvo.";
  });
  revalidar();
  voltarParaSaldo(form, m);
}
