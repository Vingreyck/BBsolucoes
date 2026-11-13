import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db, schema } from "@/db";
import { dadosTecnicosDosProjetos } from "@/projeto/aproveitar-vistoria";

import { ehLigacao, ligacaoDoProjeto, type Ligacao } from "./calculo";
import { lerPremissas, type Premissas } from "./premissas";
import type { EmpresaDaProposta, EntradaProposta } from "./proposta";

/**
 * O que a proposta precisa do banco: as premissas da empresa, a última proposta
 * de cada projeto e a montagem da entrada a partir das linhas.
 */

export async function premissasDaEmpresa(empresaId: string): Promise<Premissas | null> {
  const e = await db.query.empresa.findFirst({
    where: eq(schema.empresa.id, empresaId),
    columns: { propostaConfig: true },
  });
  return lerPremissas(e?.propostaConfig);
}

export interface PropostaDoProjeto {
  id: string;
  numero: number;
  token: string;
  criadoEm: Date;
  enviadoEm: Date | null;
  validaAte: string | null;
}

/** A proposta mais recente de cada projeto (gerar de novo cria outra; vale a última). */
export async function ultimasPropostas(empresaId: string, projetoIds: string[]): Promise<Map<string, PropostaDoProjeto>> {
  const mapa = new Map<string, PropostaDoProjeto>();
  if (!projetoIds.length) return mapa;
  const linhas = await db
    .select({
      id: schema.proposta.id,
      projetoId: schema.proposta.projetoId,
      numero: schema.proposta.numero,
      token: schema.proposta.token,
      criadoEm: schema.proposta.criadoEm,
      enviadoEm: schema.proposta.enviadoEm,
      dados: schema.proposta.dados,
    })
    .from(schema.proposta)
    .where(and(eq(schema.proposta.empresaId, empresaId), inArray(schema.proposta.projetoId, projetoIds)))
    .orderBy(desc(schema.proposta.criadoEm));
  for (const l of linhas) {
    if (mapa.has(l.projetoId)) continue;
    const { dados, projetoId, ...resto } = l;
    mapa.set(projetoId, { ...resto, validaAte: (dados as { validaAte?: string } | null)?.validaAte ?? null });
  }
  return mapa;
}

type ProjetoCompleto = NonNullable<Awaited<ReturnType<typeof projetoParaProposta>>>;

/** O projeto, com cliente, responsável e kit, só se for da empresa de quem pede. */
export async function projetoParaProposta(empresaId: string, projetoId: string) {
  return db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, empresaId)),
    with: {
      cliente: { columns: { nome: true, cidade: true, uf: true, telefone: true } },      responsavel: { columns: { nome: true, telefone: true } },
    },
  });
}

/** (11) 99999-9999, a partir dos dígitos; o que não parece telefone vira nulo. */
export function telefoneBonito(t: string | null | undefined): string | null {
  const d = (t ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
}

export type ModeloDoCatalogo = { id: string; tipo: string; fabricante: string; modelo: string; potenciaW: string | null };

/** O que não muda de projeto para projeto: dá para carregar uma vez para vários cartões. */
export interface ContextoDaProposta {
  empresa: EmpresaDaProposta;
  premissas: Premissas | null;
  catalogo: ModeloDoCatalogo[];
  /** Quem assina a proposta como "Responsável Comercial". */
  quem: { nome: string; telefone?: string | null };
  /** As pessoas que podem ser escolhidas como responsável (a janela de gerar lista estas). */
  responsaveis: ResponsavelDaProposta[];
}

export interface ResponsavelDaProposta {
  id: string;
  nome: string;
  telefone: string | null;
}

/**
 * Quem vem marcado na janela de gerar: quem está gerando, se puder ser
 * responsável; senão o responsável do projeto; senão o primeiro da lista.
 */
export function responsavelPadrao(
  responsaveis: ResponsavelDaProposta[],
  usuarioId: string,
  responsavelDoProjetoId: string | null,
): string {
  const tem = (id: string | null) => (id && responsaveis.some((r) => r.id === id) ? id : null);
  return tem(usuarioId) ?? tem(responsavelDoProjetoId) ?? responsaveis[0]?.id ?? "";
}

/** A entrada da proposta a partir do projeto e do contexto, sem banco. */
export function montarEntrada(
  projeto: Pick<
    ProjetoCompleto,
    | "cliente"
    | "responsavel"
    | "potenciaKwp"
    | "valor"
    | "consumoMedioKwh"
    | "equipamentos"
    | "telhadoTipo"
    | "inversorModeloId"
    | "inversorQtd"
    | "moduloModeloId"
    | "moduloQtd"
  >,
  ctx: ContextoDaProposta,
  ligacao: Ligacao,
): EntradaProposta {
  const doKit = (id: string | null) => ctx.catalogo.find((m) => m.id === id) ?? null;
  // O responsável é o escolhido na hora de gerar (`ctx.quem`), não o dono do
  // projeto: nem toda proposta sai da mesma pessoa.
  const responsavel = ctx.quem;
  return {
    empresa: ctx.empresa,
    cliente: { nome: projeto.cliente.nome, cidade: projeto.cliente.cidade, uf: projeto.cliente.uf },
    responsavel: { nome: responsavel.nome, contato: telefoneBonito(responsavel.telefone) },
    projeto: {
      potenciaKwp: projeto.potenciaKwp,
      valor: projeto.valor,
      consumoMedioKwh: projeto.consumoMedioKwh,
      equipamentos: projeto.equipamentos,
      telhadoTipo: projeto.telhadoTipo,
    },
    inversor: doKit(projeto.inversorModeloId),
    inversorQtd: projeto.inversorQtd,
    modulo: doKit(projeto.moduloModeloId),
    moduloQtd: projeto.moduloQtd,
    ligacao,
    premissas: ctx.premissas,
  };
}

/**
 * O contexto que não depende do projeto: a empresa (com quantas usinas ela
 * acompanha hoje, para a página de monitoramento), as premissas e o catálogo.
 */
export async function contextoDaProposta(
  empresaId: string,
  quem: ContextoDaProposta["quem"],
): Promise<ContextoDaProposta> {
  const [empresa, premissas, catalogo, usinas, responsaveis] = await Promise.all([
    db.query.empresa.findFirst({
      where: eq(schema.empresa.id, empresaId),
      columns: { nome: true, razaoSocial: true, cnpj: true, endereco: true, email: true },
    }),
    premissasDaEmpresa(empresaId),
    db.query.modeloEquipamento.findMany({
      where: eq(schema.modeloEquipamento.empresaId, empresaId),
      columns: { id: true, tipo: true, fabricante: true, modelo: true, potenciaW: true },
    }),
    // Só as usinas em operação: a arquivada no recomeço não conta.
    db
      .select({ n: count() })
      .from(schema.usina)
      .where(and(eq(schema.usina.empresaId, empresaId), isNull(schema.usina.arquivadaEm))),
    responsaveisPossiveis(empresaId),
  ]);
  return {
    empresa: { ...(empresa ?? { nome: "" }), usinas: Number(usinas[0]?.n ?? 0) },
    premissas,
    catalogo,
    quem,
    responsaveis,
  };
}

/** Quem pode assinar proposta: administração e vendedores, com conta ativa e aprovada. */
export async function responsaveisPossiveis(empresaId: string): Promise<ResponsavelDaProposta[]> {
  return db
    .select({ id: schema.usuario.id, nome: schema.usuario.nome, telefone: schema.usuario.telefone })
    .from(schema.usuario)
    .where(
      and(
        eq(schema.usuario.empresaId, empresaId),
        eq(schema.usuario.ativo, true),
        isNotNull(schema.usuario.aprovadoEm),
        inArray(schema.usuario.papel, ["adm", "vendedor"]),
      ),
    )
    .orderBy(asc(schema.usuario.nome));
}

/**
 * Junta o que a proposta pede para um projeto: o tipo de ligação vem da escolha
 * de quem gera, do cadastro do projeto ou dos polos do disjuntor que o técnico
 * anotou na vistoria (bifásica na falta). `quem` é o usuário logado, para o
 * "Responsável Comercial" quando o projeto não tem responsável.
 */
export async function entradaDaProposta(
  empresaId: string,
  projeto: ProjetoCompleto,
  quem: ContextoDaProposta["quem"],
  ligacaoEscolhida?: Ligacao | null,
): Promise<EntradaProposta> {
  const [ctx, tecnicos] = await Promise.all([
    contextoDaProposta(empresaId, quem),
    ligacaoEscolhida || ehLigacao(projeto.ligacao) ? null : dadosTecnicosDosProjetos(empresaId, [projeto.id]),
  ]);
  const ligacao = ligacaoEscolhida ?? ligacaoDoProjeto(projeto.ligacao, tecnicos?.get(projeto.id)?.dados.polos);
  return montarEntrada(projeto, ctx, ligacao);
}
