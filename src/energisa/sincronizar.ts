import { and, eq, inArray, isNull } from "drizzle-orm";

import { db, schema } from "@/db";
import { moverNaEsteira } from "@/projeto/esteira";

import {
  acaoNaEsteira,
  normalizarItem,
  numeroDoProjeto,
  ROTULO_FASE,
  vigente,
  vinculoAutomatico,
  type FaseEnergisa,
  type ItemEnergisa,
} from "./situacoes";

export type { ItemEnergisa };

/**
 * A lista que chegou do portal da Energisa (pela extensão ou pelo favorito)
 * vira dado no Selebi: grava, liga cada linha ao projeto certo e faz a esteira
 * reagir à situação nova.
 */

export interface ResumoSincronizacao {
  lidos: number;
  novos: number;
  mudaram: number;
  vinculados: number;
  movidos: string[];
}

export async function sincronizar(empresaId: string, crus: Record<string, unknown>[]): Promise<ResumoSincronizacao> {
  const itens = crus.map(normalizarItem).filter((i): i is ItemEnergisa => i !== null);
  const resumo: ResumoSincronizacao = { lidos: itens.length, novos: 0, mudaram: 0, vinculados: 0, movidos: [] };
  if (!itens.length) return resumo;

  const existentes = await db.query.energisaProjeto.findMany({ where: eq(schema.energisaProjeto.empresaId, empresaId) });
  const porNumero = new Map(existentes.map((e) => [e.numero, e]));
  const agora = new Date();
  const novos: (typeof schema.energisaProjeto.$inferInsert)[] = [];
  const iguais: string[] = [];

  // Com a extensão lendo a cada 30 min, quase tudo chega igual: só o que mudou
  // é regravado; o resto ganha o `vistoEm` numa instrução só.
  for (const item of itens) {
    const ja = porNumero.get(item.numero);
    const campos = {
      empreendimento: item.empreendimento,
      endereco: item.endereco,
      tipo: item.tipo,
      dataAbertura: item.dataAbertura,
      codigoSituacao: item.codigo,
      descricaoSituacao: item.descricao,
      fase: item.fase,
      vistoEm: agora,
    };
    if (!ja) {
      if (!novos.some((n) => n.numero === item.numero)) {
        novos.push({ empresaId, numero: item.numero, ...campos, situacaoDesde: agora });
      }
      continue;
    }
    const mudouSituacao = ja.codigoSituacao !== item.codigo || (ja.descricaoSituacao ?? "") !== (item.descricao ?? "");
    const mudouResto =
      ja.empreendimento !== item.empreendimento ||
      ja.endereco !== item.endereco ||
      ja.tipo !== item.tipo ||
      ja.fase !== item.fase ||
      (ja.dataAbertura?.getTime() ?? null) !== (item.dataAbertura?.getTime() ?? null);
    if (!mudouSituacao && !mudouResto) {
      iguais.push(ja.id);
      continue;
    }
    if (mudouSituacao) resumo.mudaram++;
    await db
      .update(schema.energisaProjeto)
      .set({ ...campos, ...(mudouSituacao ? { situacaoDesde: agora } : {}) })
      .where(eq(schema.energisaProjeto.id, ja.id));
  }
  if (novos.length) {
    await db.insert(schema.energisaProjeto).values(novos).onConflictDoNothing();
    resumo.novos = novos.length;
  }
  if (iguais.length) {
    await db.update(schema.energisaProjeto).set({ vistoEm: agora }).where(inArray(schema.energisaProjeto.id, iguais));
  }

  resumo.vinculados = await vincularPendentes(empresaId);
  resumo.movidos = await reagirNaEsteira(empresaId);
  return resumo;
}

/**
 * Liga ao projeto do Selebi o que ainda está solto: primeiro pelo número
 * (alguém já anotou o ID da Energisa no campo "Protocolo" do projeto), depois
 * pelo nome do cliente no nome do empreendimento — só quando não há dúvida.
 */
async function vincularPendentes(empresaId: string): Promise<number> {
  const pendentes = await db.query.energisaProjeto.findMany({
    where: and(eq(schema.energisaProjeto.empresaId, empresaId), isNull(schema.energisaProjeto.projetoId)),
    columns: { id: true, numero: true, empreendimento: true },
  });
  if (!pendentes.length) return 0;

  const projetos = await db.query.projeto.findMany({
    where: eq(schema.projeto.empresaId, empresaId),
    columns: { id: true, protocoloConcessionaria: true, situacao: true },
    with: { cliente: { columns: { nome: true } } },
  });
  const porProtocolo = new Map<string, string>();
  for (const p of projetos) {
    const n = numeroDoProjeto(p.protocoloConcessionaria);
    if (n) porProtocolo.set(n, p.id);
  }
  const abertos = projetos
    .filter((p) => p.situacao === "em_andamento")
    .map((p) => ({ projetoId: p.id, cliente: p.cliente.nome }));

  let ligados = 0;
  for (const s of pendentes) {
    const pelo = porProtocolo.get(s.numero);
    const projetoId = pelo ?? vinculoAutomatico(s.empreendimento, abertos);
    if (!projetoId) continue;
    await db
      .update(schema.energisaProjeto)
      .set({ projetoId, vinculo: pelo ? "protocolo" : "automatico" })
      .where(eq(schema.energisaProjeto.id, s.id));
    ligados++;
  }
  return ligados;
}

/**
 * Para cada projeto do Selebi com linha na Energisa, a situação vigente que a
 * esteira ainda não viu: anota no projeto e, quando a regra manda
 * (`acaoNaEsteira`), move o cartão. Devolve os nomes dos clientes movidos.
 */
export async function reagirNaEsteira(empresaId: string): Promise<string[]> {
  const ligadas = await db.query.energisaProjeto.findMany({
    where: eq(schema.energisaProjeto.empresaId, empresaId),
  });
  const porProjeto = new Map<string, typeof ligadas>();
  for (const l of ligadas) {
    if (!l.projetoId) continue;
    const lista = porProjeto.get(l.projetoId) ?? [];
    lista.push(l);
    porProjeto.set(l.projetoId, lista);
  }
  if (!porProjeto.size) return [];

  const projetos = await db.query.projeto.findMany({
    where: inArray(schema.projeto.id, [...porProjeto.keys()]),
    with: { etapa: { columns: { slug: true, nome: true } }, cliente: { columns: { nome: true } } },
  });
  const movidos: string[] = [];

  for (const p of projetos) {
    const entradas = porProjeto.get(p.id)!.map((e) => ({ ...e, fase: e.fase as FaseEnergisa }));
    const v = vigente(entradas);
    if (!v || !v.codigoSituacao || v.codigoSituacao === v.aplicadoCodigo) continue;

    const acao = p.situacao === "em_andamento" ? acaoNaEsteira(v.fase, p.etapa.slug) : null;
    let texto = `Energisa (projeto ${v.numero}): ${v.descricaoSituacao ?? ROTULO_FASE[v.fase]}.`;
    if (acao) {
      const nova = await moverNaEsteira({
        empresaId,
        projetoId: p.id,
        direcao: acao,
        observacao:
          acao === "avancar"
            ? `Automático: a Energisa conectou a UC GD (projeto ${v.numero}).`
            : `Automático: a Energisa reprovou a vistoria (projeto ${v.numero}) — corrigir e pedir de novo.`,
      });
      if (nova) {
        texto += ` O projeto foi para "${nova.nome}" automaticamente.`;
        movidos.push(p.cliente.nome);
      }
    }
    // A primeira leitura de um projeto só vira recado quando faz algo; as
    // seguintes, sempre que a situação muda.
    if (acao || v.aplicadoCodigo !== null) {
      await db.insert(schema.comentario).values({
        empresaId,
        entidade: "projeto",
        entidadeId: p.id,
        autorId: null,
        texto,
      });
    }
    await db
      .update(schema.energisaProjeto)
      .set({ aplicadoCodigo: v.codigoSituacao })
      .where(eq(schema.energisaProjeto.id, v.id));
  }
  return movidos;
}
