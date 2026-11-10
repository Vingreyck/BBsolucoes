import { and, eq, inArray, isNull } from "drizzle-orm";

import { db, schema } from "@/db";
import { moverNaEsteira } from "@/projeto/esteira";
import { avisarUsuario } from "@/push/avisos";

import {
  acaoNaEsteira,
  liberaOsDeInstalacao,
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
  // Depois do recomeço (`npm run recomecar`), o que foi aberto no portal antes
  // dele não volta: a lista do portal continua trazendo os antigos, e o Selebi
  // passa a ignorá-los. Sem data de abertura, entra (não dá para saber).
  const empresa = await db.query.empresa.findFirst({
    where: eq(schema.empresa.id, empresaId),
    columns: { recomecoEm: true },
  });
  const corte = empresa?.recomecoEm ?? null;
  const itens = crus
    .map(normalizarItem)
    .filter((i): i is ItemEnergisa => i !== null)
    .filter((i) => !corte || !i.dataAbertura || i.dataAbertura >= corte);
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
 * Para cada projeto do Selebi com linha na Energisa: anota a situação nova no
 * projeto, move o cartão quando a regra manda (`acaoNaEsteira`) e avisa no
 * celular quem cuida daquela etapa e o responsável pelo projeto. Devolve os
 * nomes dos clientes movidos.
 *
 * **Avançar** é conferido em toda leitura, não só quando a situação muda: se
 * a Energisa aprovou a vistoria antes de o projeto chegar ao "Pedido de
 * vistoria", ele anda assim que chega — a leitura nunca se perde.
 * **Voltar** (vistoria reprovada) só na hora em que a situação muda; senão a
 * reprovação antiga, ainda na tela da Energisa, devolveria o projeto que a
 * equipe acabou de corrigir e mandar de novo.
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

  const [projetos, equipe] = await Promise.all([
    db.query.projeto.findMany({
      where: inArray(schema.projeto.id, [...porProjeto.keys()]),
      with: {
        etapa: { columns: { slug: true, nome: true, papelResponsavel: true } },
        cliente: { columns: { nome: true } },
      },
    }),
    db.query.usuario.findMany({
      where: and(eq(schema.usuario.empresaId, empresaId), eq(schema.usuario.ativo, true)),
      columns: { id: true, papel: true },
    }),
  ]);
  const movidos: string[] = [];
  const avisos: { para: Set<string>; titulo: string; corpo: string; projetoId: string }[] = [];

  /** Quem recebe: o responsável pelo projeto e quem cuida da etapa em que ele estava. */
  const destinatarios = (p: (typeof projetos)[number]) => {
    const ids = new Set<string>();
    if (p.responsavelId) ids.add(p.responsavelId);
    for (const u of equipe) if (p.etapa.papelResponsavel && u.papel === p.etapa.papelResponsavel) ids.add(u.id);
    return ids;
  };

  for (const p of projetos) {
    const entradas = porProjeto.get(p.id)!.map((e) => ({ ...e, fase: e.fase as FaseEnergisa }));
    const v = vigente(entradas);
    if (!v || !v.codigoSituacao) continue;
    const mudou = v.codigoSituacao !== v.aplicadoCodigo;
    // A primeira leitura de um projeto (nada aplicado ainda) não vira recado nem aviso.
    const novidade = mudou && v.aplicadoCodigo !== null;

    const regra = p.situacao === "em_andamento" ? acaoNaEsteira(v.fase, p.etapa.slug) : null;
    const acao = regra === "avancar" || (regra === "voltar" && mudou) ? regra : null;
    if (!mudou && !acao) continue;

    const situacao = v.descricaoSituacao ?? ROTULO_FASE[v.fase];
    let texto = `Energisa (projeto ${v.numero}): ${situacao}.`;
    if (acao) {
      const nova = await moverNaEsteira({
        empresaId,
        projetoId: p.id,
        direcao: acao,
        observacao:
          acao === "avancar"
            ? `Automático: a Energisa aprovou o pedido de vistoria (projeto ${v.numero}, ${situacao}).`
            : `Automático: a Energisa reprovou a vistoria (projeto ${v.numero}) — corrigir e pedir de novo.`,
      });
      if (nova) {
        texto += ` O projeto foi para "${nova.nome}" automaticamente.`;
        movidos.push(p.cliente.nome);
        avisos.push({
          para: destinatarios(p),
          projetoId: p.id,
          titulo: acao === "avancar" ? `Vistoria aprovada: ${p.cliente.nome}` : `Vistoria reprovada: ${p.cliente.nome}`,
          corpo:
            acao === "avancar"
              ? `A Energisa aceitou o pedido de vistoria (${situacao}). O projeto foi para ${nova.nome} sozinho.`
              : `O projeto voltou para ${nova.nome}. Corrija e peça a vistoria de novo.`,
        });
      }
    } else if (novidade && p.situacao === "em_andamento" && p.etapa.slug === "aprovacao_concessionaria") {
      // Etapa 9: a aprovação não move sozinha (a obra precisa de técnico e dia), mas avisa quem cuida dela.
      if (liberaOsDeInstalacao(v.fase)) {
        avisos.push({
          para: destinatarios(p),
          projetoId: p.id,
          titulo: `Energisa aprovou: ${p.cliente.nome}`,
          corpo: "Gere a OS de instalação na esteira: escolha o técnico e o dia, e o projeto anda sozinho.",
        });
      } else if (v.fase === "indeferido") {
        avisos.push({
          para: destinatarios(p),
          projetoId: p.id,
          titulo: `Energisa indeferiu: ${p.cliente.nome}`,
          corpo: "Veja o motivo no portal da Energisa e reenvie o projeto.",
        });
      }
    }

    if (acao || novidade) {
      await db.insert(schema.comentario).values({
        empresaId,
        entidade: "projeto",
        entidadeId: p.id,
        autorId: null,
        texto,
      });
    }
    if (mudou) {
      await db
        .update(schema.energisaProjeto)
        .set({ aplicadoCodigo: v.codigoSituacao })
        .where(eq(schema.energisaProjeto.id, v.id));
    }
  }

  // O aviso vai depois de gravar tudo: é extra, e nunca atrasa nem derruba a leitura.
  for (const a of avisos) {
    for (const usuarioId of a.para) {
      void avisarUsuario(usuarioId, { titulo: a.titulo, corpo: a.corpo, dados: { tipo: "projeto", projetoId: a.projetoId } });
    }
  }
  return movidos;
}
