"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, schema } from "@/db";
import { vigente, type FaseEnergisa } from "@/energisa/situacoes";
import { exigirGestaoWeb } from "@/os/acesso";
import { criarOs } from "@/os/fluxo";
import { numeroOs } from "@/os/tipos";
import { moverNaEsteira } from "@/projeto/esteira";

const ABERTAS = ["aberta", "agendada", "em_deslocamento", "em_andamento", "aguardando_peca"] as const;

/**
 * "Gerar OS de instalação", no cartão da etapa 9 depois que a Energisa aprova.
 *
 * Abre a OS de instalação do projeto e leva o cartão para Execução — é a OS
 * dessa etapa, e concluí-la é o que empurra o projeto para o pedido de
 * vistoria. Se já existe uma OS de instalação aberta, leva para ela.
 */
export async function gerarOsInstalacao(projetoId: string): Promise<void> {
  const ator = await exigirGestaoWeb();
  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, ator.empresaId)),
    with: { etapa: { columns: { slug: true } } },
  });
  if (!projeto) redirect("/esteira");

  const [jaTem] = await db
    .select({ id: schema.ordemServico.id })
    .from(schema.ordemServico)
    .where(
      and(
        eq(schema.ordemServico.projetoId, projeto.id),
        eq(schema.ordemServico.tipo, "instalacao"),
        inArray(schema.ordemServico.status, [...ABERTAS]),
      ),
    )
    .limit(1);
  if (jaTem) redirect(`/os/${jaTem.id}`);

  const entradas = await db.query.energisaProjeto.findMany({ where: eq(schema.energisaProjeto.projetoId, projeto.id) });
  const v = vigente(entradas.map((e) => ({ ...e, fase: e.fase as FaseEnergisa })));
  const os = await criarOs(ator, {
    clienteId: projeto.clienteId,
    usinaId: projeto.usinaId,
    projetoId: projeto.id,
    tipo: "instalacao",
    prioridade: "normal",
    descricao: v
      ? `Instalação do sistema: a Energisa aprovou o projeto ${v.numero} (${v.descricaoSituacao ?? "aprovado"}).`
      : "Instalação do sistema: projeto aprovado pela Energisa.",
  });
  if (projeto.etapa.slug === "aprovacao_concessionaria") {
    await moverNaEsteira({
      empresaId: ator.empresaId,
      projetoId: projeto.id,
      direcao: "avancar",
      usuarioId: ator.id,
      observacao: `${numeroOs(os.numero)} de instalação gerada: projeto aprovado pela Energisa.`,
    });
  }
  revalidatePath("/esteira");
  redirect(`/os/${os.id}`);
}
