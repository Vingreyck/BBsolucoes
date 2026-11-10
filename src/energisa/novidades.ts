import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db, schema } from "@/db";

import { liberaOsDeInstalacao, ROTULO_FASE, vigente, type FaseEnergisa } from "./situacoes";

/**
 * O aviso do Início: o que a Energisa mudou nos últimos dias nos projetos já
 * ligados ao Selebi, e quantos aprovados ainda esperam a OS de instalação.
 *
 * Mostra só o que pede atenção ou é notícia boa — aprovado, em obra, vistoria
 * aprovada, UC conectada, indeferido, vistoria reprovada. "Em análise" e
 * "vistoria pendente" são espera e não viram aviso.
 */

const ABERTAS = ["aberta", "agendada", "em_deslocamento", "em_andamento", "aguardando_peca"] as const;
const AVISAM: FaseEnergisa[] = ["aprovado", "obra", "indeferido", "vistoria_aprovada", "vistoria_reprovada", "conectada"];

export interface NovidadeEnergisa {
  projetoId: string;
  cliente: string;
  etapa: string;
  numero: string;
  situacao: string;
  fase: FaseEnergisa;
  desde: Date;
  /** Etapa 9, aprovado e sem OS de instalação: é a chamada para gerar a OS. */
  precisaOs: boolean;
}

export async function novidadesDaEnergisa(
  empresaId: string,
  dias = 7,
): Promise<{ temEnergisa: boolean; novidades: NovidadeEnergisa[]; esperandoOs: number }> {
  const ligadas = await db.query.energisaProjeto.findMany({
    where: and(eq(schema.energisaProjeto.empresaId, empresaId), isNotNull(schema.energisaProjeto.projetoId)),
    columns: { id: true, projetoId: true, numero: true, fase: true, descricaoSituacao: true, situacaoDesde: true, dataAbertura: true },
  });
  if (!ligadas.length) return { temEnergisa: false, novidades: [], esperandoOs: 0 };

  const porProjeto = new Map<string, typeof ligadas>();
  for (const l of ligadas) {
    const lista = porProjeto.get(l.projetoId!) ?? [];
    lista.push(l);
    porProjeto.set(l.projetoId!, lista);
  }
  const ids = [...porProjeto.keys()];
  const [projetos, comOs] = await Promise.all([
    db.query.projeto.findMany({
      where: and(inArray(schema.projeto.id, ids), eq(schema.projeto.situacao, "em_andamento")),
      columns: { id: true },
      with: { cliente: { columns: { nome: true } }, etapa: { columns: { nome: true, slug: true } } },
    }),
    db
      .select({ projetoId: schema.ordemServico.projetoId })
      .from(schema.ordemServico)
      .where(
        and(
          eq(schema.ordemServico.empresaId, empresaId),
          inArray(schema.ordemServico.projetoId, ids),
          eq(schema.ordemServico.tipo, "instalacao"),
          inArray(schema.ordemServico.status, [...ABERTAS]),
        ),
      ),
  ]);
  const temOs = new Set(comOs.map((o) => o.projetoId));
  const desde = new Date(Date.now() - dias * 86_400_000);

  const novidades: NovidadeEnergisa[] = [];
  let esperandoOs = 0;
  for (const p of projetos) {
    const v = vigente(porProjeto.get(p.id)!.map((e) => ({ ...e, fase: e.fase as FaseEnergisa })));
    if (!v) continue;
    const precisaOs = p.etapa.slug === "aprovacao_concessionaria" && liberaOsDeInstalacao(v.fase) && !temOs.has(p.id);
    if (precisaOs) esperandoOs++;
    if ((v.situacaoDesde && v.situacaoDesde >= desde && AVISAM.includes(v.fase)) || precisaOs) {
      novidades.push({
        projetoId: p.id,
        cliente: p.cliente.nome,
        etapa: p.etapa.nome,
        numero: v.numero,
        situacao: v.descricaoSituacao ?? ROTULO_FASE[v.fase],
        fase: v.fase,
        desde: v.situacaoDesde ?? new Date(0),
        precisaOs,
      });
    }
  }
  // Primeiro o que pede ação (gerar OS), depois o mais recente.
  novidades.sort((a, b) => Number(b.precisaOs) - Number(a.precisaOs) || b.desde.getTime() - a.desde.getTime());
  return { temEnergisa: true, novidades, esperandoOs };
}
