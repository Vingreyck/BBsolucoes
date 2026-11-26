import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import type { LinhaDaEntrada } from "@/db/schema/estoque";
import { driveConfigurado, enviarArquivo, garantirPasta, moverParaLixeira } from "@/documentos/drive";
import { limparNome } from "@/documentos/pastas";

import { arredondar, chaveDoNome, normalizarUnidade, quantidadeValida } from "./regras";

/**
 * O estoque no banco: itens com saldo, entradas por nota ou pedido, ajuste de
 * contagem. A baixa pela OS fica em `baixa.ts`.
 *
 * Um depósito só; o saldo pode ficar negativo (a tela marca em vermelho).
 */

type Transacao = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Quem vê e lança o estoque. O papel "estoque" existe desde o começo esperando esta tela. */
const PAPEIS_ESTOQUE = new Set(["adm", "estoque", "engenheiro"]);

export function podeVerEstoque(papel: string): boolean {
  return PAPEIS_ESTOQUE.has(papel);
}

export class ErroEstoque extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroEstoque";
  }
}

export interface QuemLanca {
  id: string;
  empresaId: string;
}

// ------------------------------------------------------------------ itens e saldo

/** Cada item com o saldo (soma do livro) e o último movimento. */
export async function itensComSaldo(empresaId: string) {
  const linhas = await db
    .select({
      id: schema.itemEstoque.id,
      nome: schema.itemEstoque.nome,
      codigo: schema.itemEstoque.codigo,
      unidade: schema.itemEstoque.unidade,
      minimo: schema.itemEstoque.minimo,
      ativo: schema.itemEstoque.ativo,
      modeloEquipamentoId: schema.itemEstoque.modeloEquipamentoId,
      saldo: sql<string>`coalesce(sum(${schema.movimentoEstoque.quantidade}), 0)`,
      ultimo: sql<Date | null>`max(${schema.movimentoEstoque.criadoEm})`,
    })
    .from(schema.itemEstoque)
    .leftJoin(schema.movimentoEstoque, eq(schema.movimentoEstoque.itemId, schema.itemEstoque.id))
    .where(eq(schema.itemEstoque.empresaId, empresaId))
    .groupBy(schema.itemEstoque.id)
    .orderBy(asc(schema.itemEstoque.nome));
  return linhas.map((l) => ({
    ...l,
    saldo: arredondar(Number(l.saldo)),
    minimo: l.minimo === null ? null : Number(l.minimo),
    ultimo: l.ultimo ? new Date(l.ultimo) : null,
  }));
}

export type ItemComSaldo = Awaited<ReturnType<typeof itensComSaldo>>[number];

/** O item com este nome (pela chave), criado se ainda não existir. */
export async function garantirItem(
  tx: Transacao,
  empresaId: string,
  dados: { nome: string; unidade?: string | null; codigo?: string | null; modeloId?: string | null },
): Promise<string> {
  const nome = dados.nome.trim().replace(/\s+/g, " ").slice(0, 200);
  const chave = chaveDoNome(nome);
  if (!chave) throw new ErroEstoque("O item precisa de um nome.");
  let modeloId: string | null = null;
  if (dados.modeloId) {
    const m = await tx.query.modeloEquipamento.findFirst({
      where: and(eq(schema.modeloEquipamento.id, dados.modeloId), eq(schema.modeloEquipamento.empresaId, empresaId)),
      columns: { id: true },
    });
    modeloId = m?.id ?? null;
  }
  await tx
    .insert(schema.itemEstoque)
    .values({
      empresaId,
      nome,
      chave,
      unidade: normalizarUnidade(dados.unidade),
      codigo: dados.codigo?.trim().slice(0, 60) || null,
      modeloEquipamentoId: modeloId,
    })
    .onConflictDoNothing({ target: [schema.itemEstoque.empresaId, schema.itemEstoque.chave] });
  const item = await tx.query.itemEstoque.findFirst({
    where: and(eq(schema.itemEstoque.empresaId, empresaId), eq(schema.itemEstoque.chave, chave)),
    columns: { id: true, ativo: true, codigo: true, modeloEquipamentoId: true },
  });
  if (!item) throw new ErroEstoque("Não deu para criar o item.");
  // Item que já existia volta à lista, e ganha o código e o modelo se não tinha.
  const completar: Partial<typeof schema.itemEstoque.$inferInsert> = {};
  if (!item.ativo) completar.ativo = true;
  if (!item.codigo && dados.codigo?.trim()) completar.codigo = dados.codigo.trim().slice(0, 60);
  if (!item.modeloEquipamentoId && modeloId) completar.modeloEquipamentoId = modeloId;
  if (Object.keys(completar).length) await tx.update(schema.itemEstoque).set(completar).where(eq(schema.itemEstoque.id, item.id));
  return item.id;
}

async function itemDaEmpresa(tx: Transacao, empresaId: string, itemId: string) {
  return tx.query.itemEstoque.findFirst({
    where: and(eq(schema.itemEstoque.id, itemId), eq(schema.itemEstoque.empresaId, empresaId)),
    columns: { id: true },
  });
}

/** Contei na prateleira: o saldo passa a ser este, e a diferença vira um ajuste no livro. */
export async function ajustarSaldo(quem: QuemLanca, itemId: string, contado: number, observacao: string): Promise<number> {
  if (!Number.isFinite(contado) || contado < 0 || contado > 1_000_000) throw new ErroEstoque("Diga quanto tem na prateleira (zero ou mais).");
  return db.transaction(async (tx) => {
    // Trava o item: dois ajustes juntos não calculam a diferença do mesmo saldo.
    const [item] = await tx
      .select({ id: schema.itemEstoque.id })
      .from(schema.itemEstoque)
      .where(and(eq(schema.itemEstoque.id, itemId), eq(schema.itemEstoque.empresaId, quem.empresaId)))
      .for("update");
    if (!item) throw new ErroEstoque("Item não encontrado.");
    const [{ saldo }] = await tx
      .select({ saldo: sql<string>`coalesce(sum(${schema.movimentoEstoque.quantidade}), 0)` })
      .from(schema.movimentoEstoque)
      .where(eq(schema.movimentoEstoque.itemId, item.id));
    const diferenca = arredondar(arredondar(contado) - Number(saldo));
    if (diferenca === 0) return 0;
    await tx.insert(schema.movimentoEstoque).values({
      empresaId: quem.empresaId,
      itemId: item.id,
      quantidade: String(diferenca),
      motivo: "ajuste",
      observacao: observacao.trim().slice(0, 300) || "Contagem na prateleira",
      usuarioId: quem.id,
      origem: "web",
    });
    return diferenca;
  });
}

export async function salvarItem(
  quem: QuemLanca,
  itemId: string,
  dados: { nome?: string; unidade?: string; minimo?: number | null; modeloId?: string | null; ativo?: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await itemDaEmpresa(tx, quem.empresaId, itemId);
    if (!item) throw new ErroEstoque("Item não encontrado.");
    const campos: Partial<typeof schema.itemEstoque.$inferInsert> = {};
    if (dados.nome !== undefined) {
      const nome = dados.nome.trim().replace(/\s+/g, " ").slice(0, 200);
      if (!chaveDoNome(nome)) throw new ErroEstoque("O item precisa de um nome.");
      const chave = chaveDoNome(nome);
      const outro = await tx.query.itemEstoque.findFirst({
        where: and(eq(schema.itemEstoque.empresaId, quem.empresaId), eq(schema.itemEstoque.chave, chave)),
        columns: { id: true },
      });
      if (outro && outro.id !== item.id) throw new ErroEstoque(`Já existe um item chamado "${nome}".`);
      campos.nome = nome;
      campos.chave = chave;
    }
    if (dados.unidade !== undefined) campos.unidade = normalizarUnidade(dados.unidade);
    if (dados.minimo !== undefined) campos.minimo = dados.minimo === null ? null : String(arredondar(dados.minimo));
    if (dados.ativo !== undefined) campos.ativo = dados.ativo;
    if (dados.modeloId !== undefined) {
      if (dados.modeloId) {
        const m = await tx.query.modeloEquipamento.findFirst({
          where: and(eq(schema.modeloEquipamento.id, dados.modeloId), eq(schema.modeloEquipamento.empresaId, quem.empresaId)),
          columns: { id: true },
        });
        if (!m) throw new ErroEstoque("Modelo do catálogo não encontrado.");
      }
      campos.modeloEquipamentoId = dados.modeloId || null;
    }
    if (Object.keys(campos).length) await tx.update(schema.itemEstoque).set(campos).where(eq(schema.itemEstoque.id, item.id));
  });
}

// ------------------------------------------------------------------ entradas

const PASTA_ESTOQUE = "ESTOQUE - NOTAS E PEDIDOS";

/** Guarda o arquivo da entrada no Drive (pasta do ano). Sem Drive, só a ficha. */
export async function guardarArquivo(
  empresaId: string,
  entradaId: string,
  papel: "nota" | "pedido",
  conteudo: Uint8Array,
  tipo: { mime: string; extensao: string },
  rotulo: string,
): Promise<{ guardado: boolean }> {
  let driveId: string | null = null;
  let driveLink: string | null = null;
  const nome = `${papel === "nota" ? "NOTA" : "PEDIDO"} - ${limparNome(rotulo).toUpperCase().slice(0, 120)}${tipo.extensao}`;
  const raiz = process.env.GOOGLE_DRIVE_RAIZ;
  if (driveConfigurado() && raiz) {
    const pasta = await garantirPasta(PASTA_ESTOQUE, raiz);
    const doAno = await garantirPasta(String(new Date().getFullYear()), pasta);
    const enviado = await enviarArquivo({ nome, mimeType: tipo.mime, pastaId: doAno, conteudo });
    driveId = enviado.id;
    driveLink = enviado.webViewLink ?? `https://drive.google.com/file/d/${enviado.id}/view`;
  }
  await db.insert(schema.entradaEstoqueArquivo).values({
    empresaId,
    entradaId,
    papel,
    nome,
    mime: tipo.mime,
    tamanho: conteudo.byteLength,
    driveId,
    driveLink,
  });
  return { guardado: Boolean(driveId) };
}

export async function entradaDaEmpresa(empresaId: string, entradaId: string) {
  return db.query.entradaEstoque.findFirst({
    where: and(eq(schema.entradaEstoque.id, entradaId), eq(schema.entradaEstoque.empresaId, empresaId)),
    with: {
      arquivos: { orderBy: asc(schema.entradaEstoqueArquivo.criadoEm) },
      criador: { columns: { nome: true } },
    },
  });
}

export async function listarEntradas(empresaId: string) {
  return db.query.entradaEstoque.findMany({
    where: eq(schema.entradaEstoque.empresaId, empresaId),
    with: {
      arquivos: { columns: { id: true, papel: true, nome: true } },
      criador: { columns: { nome: true } },
    },
    orderBy: desc(schema.entradaEstoque.criadoEm),
  });
}

/** Uma linha da conferência como veio do formulário. */
export interface LinhaConferida {
  entra: boolean;
  descricao: string;
  quantidade: unknown;
  unidade: string;
  /** Item existente, ou nulo para criar um com o nome da descrição. */
  itemId: string | null;
  modeloId: string | null;
  codigo: string | null;
  valorUnitario: number | null;
  origem: LinhaDaEntrada["origem"];
}

/**
 * Lança a entrada: cada linha marcada vira (ou encontra) um item e soma no
 * saldo. A mesma NF-e (pela chave de acesso) não entra duas vezes.
 */
export async function lancarEntrada(
  quem: QuemLanca,
  entradaId: string,
  cabecalho: { numero: string | null; fornecedor: string | null; emitidaEm: string | null },
  linhas: LinhaConferida[],
): Promise<{ itens: number }> {
  const marcadas = linhas.filter((l) => l.entra);
  if (!marcadas.length) throw new ErroEstoque("Marque pelo menos um item para entrar no estoque.");
  for (const l of marcadas) {
    if (!l.descricao.trim() && !l.itemId) throw new ErroEstoque("Toda linha marcada precisa de um item ou de uma descrição.");
    if (quantidadeValida(l.quantidade) === null) throw new ErroEstoque(`Quantidade inválida em "${l.descricao || "linha sem nome"}".`);
  }

  try {
    return await db.transaction(async (tx) => {
      const [entrada] = await tx
        .select()
        .from(schema.entradaEstoque)
        .where(and(eq(schema.entradaEstoque.id, entradaId), eq(schema.entradaEstoque.empresaId, quem.empresaId)))
        .for("update");
      if (!entrada) throw new ErroEstoque("Entrada não encontrada.");
      if (entrada.situacao !== "rascunho") throw new ErroEstoque("Esta entrada já foi lançada.");

      const finais: LinhaDaEntrada[] = [];
      for (const l of linhas) {
        const quantidade = quantidadeValida(l.quantidade) ?? 0;
        let itemId: string | null = null;
        if (l.entra) {
          if (l.itemId) {
            const item = await itemDaEmpresa(tx, quem.empresaId, l.itemId);
            if (!item) throw new ErroEstoque("Um dos itens escolhidos não existe mais. Recarregue a página.");
            itemId = item.id;
          } else {
            itemId = await garantirItem(tx, quem.empresaId, {
              nome: l.descricao,
              unidade: l.unidade,
              codigo: l.codigo,
              modeloId: l.modeloId,
            });
          }
          await tx.insert(schema.movimentoEstoque).values({
            empresaId: quem.empresaId,
            itemId,
            quantidade: String(quantidade),
            motivo: "entrada",
            entradaId: entrada.id,
            observacao: [cabecalho.numero ? `Nota/pedido ${cabecalho.numero}` : null, cabecalho.fornecedor].filter(Boolean).join(" · ") || null,
            usuarioId: quem.id,
            origem: "web",
          });
        }
        finais.push({
          descricao: l.descricao.trim().slice(0, 300),
          quantidade,
          unidade: normalizarUnidade(l.unidade),
          codigo: l.codigo,
          valorUnitario: l.valorUnitario,
          origem: l.origem,
          entra: l.entra,
          motivo: null,
          itemId,
          modeloId: l.modeloId,
        });
      }

      await tx
        .update(schema.entradaEstoque)
        .set({
          situacao: "lancada",
          numero: cabecalho.numero?.trim().slice(0, 60) || null,
          fornecedor: cabecalho.fornecedor?.trim().slice(0, 200) || null,
          emitidaEm: cabecalho.emitidaEm && /^\d{4}-\d{2}-\d{2}$/.test(cabecalho.emitidaEm) ? cabecalho.emitidaEm : null,
          itensLidos: finais,
          lancadaPor: quem.id,
          lancadaEm: new Date(),
        })
        .where(eq(schema.entradaEstoque.id, entrada.id));
      return { itens: marcadas.length };
    });
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    if (err.code === "23505" || err.cause?.code === "23505") {
      throw new ErroEstoque("Esta nota fiscal (mesma chave de acesso) já foi lançada no estoque.");
    }
    throw e;
  }
}

export interface LinhaAMao {
  /** Nome do item: se já existir (mesma chave), soma nele; senão, cria. */
  nome: string;
  quantidade: unknown;
  unidade: string;
}

/**
 * Adicionar à mão, sem nota: cria a entrada e já lança, numa ida só. Fica no
 * histórico como entrada "à mão", com quem lançou e a observação.
 */
export async function lancarAMao(
  quem: QuemLanca,
  cabecalho: { numero: string | null; fornecedor: string | null; emitidaEm: string | null },
  linhas: LinhaAMao[],
): Promise<{ entradaId: string; itens: number }> {
  const validas = linhas.filter((l) => l.nome.trim());
  if (!validas.length) throw new ErroEstoque("Escreva pelo menos um item com a quantidade.");
  const [entrada] = await db
    .insert(schema.entradaEstoque)
    .values({ empresaId: quem.empresaId, leitura: "manual", criadoPor: quem.id })
    .returning({ id: schema.entradaEstoque.id });
  try {
    const r = await lancarEntrada(
      quem,
      entrada.id,
      cabecalho,
      validas.map((l) => ({
        entra: true,
        descricao: l.nome,
        quantidade: l.quantidade,
        unidade: l.unidade,
        itemId: null,
        modeloId: null,
        codigo: null,
        valorUnitario: null,
        origem: "lista",
      })),
    );
    return { entradaId: entrada.id, itens: r.itens };
  } catch (e) {
    // Não deu: a ficha vazia não fica para trás.
    await db.delete(schema.entradaEstoque).where(eq(schema.entradaEstoque.id, entrada.id));
    throw e;
  }
}

/** Desfaz uma entrada lançada por engano: o que ela somou sai do saldo, com estorno no livro. */
export async function desfazerEntrada(quem: QuemLanca, entradaId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [entrada] = await tx
      .select({ id: schema.entradaEstoque.id, situacao: schema.entradaEstoque.situacao, numero: schema.entradaEstoque.numero })
      .from(schema.entradaEstoque)
      .where(and(eq(schema.entradaEstoque.id, entradaId), eq(schema.entradaEstoque.empresaId, quem.empresaId)))
      .for("update");
    if (!entrada) throw new ErroEstoque("Entrada não encontrada.");
    if (entrada.situacao !== "lancada") throw new ErroEstoque("Só dá para desfazer uma entrada lançada.");
    const somado = await tx
      .select({ itemId: schema.movimentoEstoque.itemId, total: sql<string>`sum(${schema.movimentoEstoque.quantidade})` })
      .from(schema.movimentoEstoque)
      .where(eq(schema.movimentoEstoque.entradaId, entrada.id))
      .groupBy(schema.movimentoEstoque.itemId);
    const estornos = somado.filter((s) => Math.abs(Number(s.total)) >= 0.0005);
    if (estornos.length) {
      await tx.insert(schema.movimentoEstoque).values(
        estornos.map((s) => ({
          empresaId: quem.empresaId,
          itemId: s.itemId,
          quantidade: String(arredondar(-Number(s.total))),
          motivo: "estorno",
          entradaId: entrada.id,
          observacao: `Entrada ${entrada.numero ?? ""} desfeita`.replace(/\s+/g, " "),
          usuarioId: quem.id,
          origem: "web",
        })),
      );
    }
    await tx
      .update(schema.entradaEstoque)
      .set({ situacao: "desfeita", desfeitaPor: quem.id, desfeitaEm: new Date() })
      .where(eq(schema.entradaEstoque.id, entrada.id));
  });
}

/** Descarta o rascunho: a ficha some e os arquivos vão para a lixeira do Drive (30 dias para voltar). */
export async function descartarRascunho(quem: QuemLanca, entradaId: string): Promise<void> {
  const entrada = await entradaDaEmpresa(quem.empresaId, entradaId);
  if (!entrada) throw new ErroEstoque("Entrada não encontrada.");
  if (entrada.situacao !== "rascunho") throw new ErroEstoque("Entrada lançada não se descarta: use “Desfazer entrada”.");
  await db.delete(schema.entradaEstoque).where(eq(schema.entradaEstoque.id, entrada.id));
  for (const a of entrada.arquivos) {
    if (!a.driveId) continue;
    try {
      await moverParaLixeira(a.driveId);
    } catch (e) {
      console.error(`[estoque] arquivo ${a.driveId} da entrada descartada não foi para a lixeira`, e);
    }
  }
}

// ------------------------------------------------------------------ histórico

export async function movimentos(empresaId: string, filtro: { itemId?: string | null } = {}) {
  return db.query.movimentoEstoque.findMany({
    where: and(
      eq(schema.movimentoEstoque.empresaId, empresaId),
      filtro.itemId ? eq(schema.movimentoEstoque.itemId, filtro.itemId) : undefined,
    ),
    with: {
      item: { columns: { id: true, nome: true, unidade: true } },
      usuario: { columns: { nome: true } },
      ordemServico: { columns: { id: true, numero: true } },
      entrada: { columns: { id: true, numero: true, fornecedor: true } },
    },
    orderBy: desc(schema.movimentoEstoque.criadoEm),
    limit: 2000,
  });
}
