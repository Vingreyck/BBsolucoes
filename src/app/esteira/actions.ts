"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, schema } from "@/db";
import { vigente, type FaseEnergisa } from "@/energisa/situacoes";
import { exigirGestaoWeb } from "@/os/acesso";
import { criarOs } from "@/os/fluxo";
import { formatarRelogio, relogioDoCampo } from "@/os/relogio";
import { numeroOs } from "@/os/tipos";
import { moverNaEsteira } from "@/projeto/esteira";

const ABERTAS = ["aberta", "agendada", "em_deslocamento", "em_andamento", "aguardando_peca"] as const;

function voltar(m: { ok?: string; erro?: string; os?: string }, para = "/esteira"): never {
  const q = new URLSearchParams();
  if (m.ok) q.set("ok", m.ok);
  if (m.erro) q.set("erro", m.erro);
  if (m.os) q.set("os", m.os);
  redirect(`${para}?${q.toString()}`);
}

/** De onde veio o clique: o cartão da esteira ou a tela do projeto. */
type Origem = "esteira" | "projeto";

/** O projeto, só se for da empresa de quem pede e estiver no Lead. */
async function projetoNoLead(projetoId: string, empresaId: string) {
  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, empresaId)),
    with: { etapa: { columns: { slug: true } }, cliente: { columns: { id: true, nome: true } } },
  });
  if (!projeto) voltar({ erro: "Projeto não encontrado." });
  if (projeto.etapa.slug !== "lead") {
    voltar({ erro: `${projeto.cliente.nome} já saiu do Lead: a proposta já foi decidida.` });
  }
  return projeto;
}

/**
 * "Aprovada", no cartão do Lead: o cliente aceitou a proposta comercial.
 *
 * O projeto anda sozinho para a etapa seguinte (Aguardando OS de vistoria),
 * onde o botão da OS de vistoria já espera.
 */
export async function aprovarProposta(projetoId: string, origem: Origem): Promise<void> {
  const ator = await exigirGestaoWeb();
  const projeto = await projetoNoLead(projetoId, ator.empresaId);

  const nova = await moverNaEsteira({
    empresaId: ator.empresaId,
    projetoId: projeto.id,
    direcao: "avancar",
    usuarioId: ator.id,
    observacao: "Proposta comercial aprovada pelo cliente.",
  });

  revalidatePath("/");
  revalidatePath("/esteira");
  revalidatePath(`/projeto/${projeto.id}`);
  voltar(
    {
      ok: nova
        ? `${projeto.cliente.nome}: proposta aprovada. O projeto foi para "${nova.nome}".`
        : `${projeto.cliente.nome}: proposta aprovada.`,
    },
    origem === "projeto" ? `/projeto/${projeto.id}` : "/esteira",
  );
}

/**
 * "Reprovada", no cartão do Lead: o cliente recusou a proposta, e o projeto é
 * excluído (pedido do dono: reprovada não fica na esteira).
 *
 * Só vale no Lead. Depois dele já existe OS, documento e histórico de verdade,
 * e apagar isso por um clique seria perder trabalho.
 *
 * O cliente vai junto **só** se não sobrar nada dele: outro projeto, usina,
 * documento, OS ou unidade consumidora o seguram. Documento, em especial,
 * cairia em cascata com o cliente — por isso a conferência vem antes.
 */
export async function reprovarProposta(projetoId: string): Promise<void> {
  const ator = await exigirGestaoWeb();
  const projeto = await projetoNoLead(projetoId, ator.empresaId);

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.comentario)
      .where(
        and(
          eq(schema.comentario.empresaId, ator.empresaId),
          eq(schema.comentario.entidade, "projeto"),
          eq(schema.comentario.entidadeId, projeto.id),
        ),
      );
    // Eventos, seriais e cobranças caem em cascata; OS e documentos ficam, sem projeto.
    await tx.delete(schema.projeto).where(eq(schema.projeto.id, projeto.id));
  });

  const clienteId = projeto.cliente.id;
  const contar = async (tabela: "projeto" | "usina" | "documento" | "ordemServico" | "unidadeConsumidora") => {
    const t = schema[tabela];
    const [linha] = await db.select({ id: t.id }).from(t).where(eq(t.clienteId, clienteId)).limit(1);
    return Boolean(linha);
  };
  const preso =
    (await contar("projeto")) ||
    (await contar("usina")) ||
    (await contar("documento")) ||
    (await contar("ordemServico")) ||
    (await contar("unidadeConsumidora"));

  let clienteSaiu = false;
  if (!preso) {
    try {
      await db.delete(schema.cliente).where(and(eq(schema.cliente.id, clienteId), eq(schema.cliente.empresaId, ator.empresaId)));
      clienteSaiu = true;
    } catch {
      // Alguma tabela nova ainda aponta para ele: o cliente fica, o projeto já saiu.
    }
  }

  revalidatePath("/");
  revalidatePath("/esteira");
  voltar({
    ok: `Proposta reprovada: o projeto de ${projeto.cliente.nome} foi excluído${clienteSaiu ? ", junto com o cadastro do cliente" : ""}.`,
  });
}

/**
 * "Gerar OS de instalação", no cartão da etapa 9 depois que a Energisa aprova.
 *
 * Quem cuida da etapa escolhe o técnico e o dia, e o resto é automático:
 * - a OS de instalação nasce já agendada com o técnico;
 * - ele recebe o aviso no celular;
 * - o cartão anda para Execução. É a OS dessa etapa, e concluí-la é o que
 *   empurra o projeto para o pedido de vistoria.
 *
 * Se já existe uma OS de instalação aberta, não abre outra: só leva o
 * projeto adiante, se ainda estiver na etapa 9.
 */
export async function gerarOsInstalacao(projetoId: string, form: FormData): Promise<void> {
  const ator = await exigirGestaoWeb();
  const responsavelId = String(form.get("responsavelId") ?? "").trim();
  const agendadaPara = relogioDoCampo(String(form.get("agendadaPara") ?? ""));
  if (!responsavelId) voltar({ erro: "Escolha o técnico que vai fazer a instalação." });
  if (!agendadaPara) voltar({ erro: "Escolha o dia e a hora da instalação." });

  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, ator.empresaId)),
    with: { etapa: { columns: { slug: true } }, cliente: { columns: { nome: true } } },
  });
  if (!projeto) voltar({ erro: "Projeto não encontrado." });

  const [jaTem] = await db
    .select({ id: schema.ordemServico.id, numero: schema.ordemServico.numero })
    .from(schema.ordemServico)
    .where(
      and(
        eq(schema.ordemServico.empresaId, ator.empresaId),
        eq(schema.ordemServico.projetoId, projeto.id),
        eq(schema.ordemServico.tipo, "instalacao"),
        inArray(schema.ordemServico.status, [...ABERTAS]),
      ),
    )
    .limit(1);

  let os = jaTem;
  if (!os) {
    const entradas = await db.query.energisaProjeto.findMany({
      where: and(eq(schema.energisaProjeto.empresaId, ator.empresaId), eq(schema.energisaProjeto.projetoId, projeto.id)),
    });
    const v = vigente(entradas.map((e) => ({ ...e, fase: e.fase as FaseEnergisa })));
    os = await criarOs(ator, {
      clienteId: projeto.clienteId,
      usinaId: projeto.usinaId,
      projetoId: projeto.id,
      tipo: "instalacao",
      prioridade: "normal",
      responsavelId,
      agendadaPara,
      descricao: v
        ? `Instalação do sistema: a Energisa aprovou o projeto ${v.numero} (${v.descricaoSituacao ?? "aprovado"}).`
        : "Instalação do sistema: projeto aprovado pela Energisa.",
    });
  }

  let andou = false;
  if (projeto.etapa.slug === "aprovacao_concessionaria") {
    const nova = await moverNaEsteira({
      empresaId: ator.empresaId,
      projetoId: projeto.id,
      direcao: "avancar",
      usuarioId: ator.id,
      observacao: `${numeroOs(os.numero)} de instalação agendada para ${formatarRelogio(agendadaPara)}: projeto aprovado pela Energisa.`,
    });
    andou = Boolean(nova);
  }

  revalidatePath("/esteira");
  revalidatePath("/os");
  revalidatePath("/os/agenda");
  voltar({
    ok: jaTem
      ? `${projeto.cliente.nome}: já havia a ${numeroOs(os.numero)} de instalação aberta.${andou ? " O projeto foi para Execução." : ""}`
      : `${numeroOs(os.numero)} de instalação agendada para ${formatarRelogio(agendadaPara)}. ${projeto.cliente.nome} foi para Execução, e o técnico recebe o aviso no app.`,
    os: os.id,
  });
}
