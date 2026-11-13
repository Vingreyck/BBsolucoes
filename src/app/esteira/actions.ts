"use server";

import { randomBytes } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, schema } from "@/db";
import { vigente, type FaseEnergisa } from "@/energisa/situacoes";
import { exigirGestaoWeb } from "@/os/acesso";
import { criarOs } from "@/os/fluxo";
import { formatarRelogio, relogioDoCampo } from "@/os/relogio";
import { numeroOs } from "@/os/tipos";
import { faltaParaContrato, montarContrato } from "@/projeto/contrato";
import { entradaDe, representantesDaEmpresa } from "@/projeto/contrato-dados";
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

/**
 * "Gerar contrato", na etapa Contrato e procuração.
 *
 * Quem clica escolhe quem assina pela empresa (adm ou engenheiro) e confere o
 * kit. O contrato só nasce com todos os dados: faltando qualquer um, a resposta
 * diz qual — o PDF nunca sai com campo em branco para o cliente assinar.
 *
 * Gerar de novo (depois de corrigir um dado) cria outro contrato com outro
 * link; vale o último.
 */
export async function gerarContrato(projetoId: string, origem: Origem, form: FormData): Promise<void> {
  const ator = await exigirGestaoWeb();
  const para = origem === "projeto" ? `/projeto/${projetoId}` : "/esteira";
  const representanteId = String(form.get("representanteId") ?? "").trim();
  const equipamentos = String(form.get("equipamentos") ?? "").trim().slice(0, 1000);

  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, ator.empresaId)),
    with: { cliente: true },
  });
  if (!projeto) voltar({ erro: "Projeto não encontrado." }, para);

  if (equipamentos && equipamentos !== projeto.equipamentos) {
    await db
      .update(schema.projeto)
      .set({ equipamentos, atualizadoEm: new Date() })
      .where(eq(schema.projeto.id, projeto.id));
    projeto.equipamentos = equipamentos;
  }

  const representante = (await representantesDaEmpresa(ator.empresaId)).find((r) => r.id === representanteId) ?? null;
  const empresa = await db.query.empresa.findFirst({
    where: eq(schema.empresa.id, ator.empresaId),
    columns: { nome: true, razaoSocial: true, cnpj: true, endereco: true, email: true },
  });
  if (!empresa) voltar({ erro: "Empresa não encontrada." }, para);

  const entrada = entradaDe(projeto.cliente, projeto, empresa, representante);
  const falta = faltaParaContrato(entrada);
  if (falta.length) {
    voltar({ erro: `Não dá para gerar o contrato de ${projeto.cliente.nome}: falta ${falta.join(", ")}.` }, para);
  }

  await db.insert(schema.contrato).values({
    empresaId: ator.empresaId,
    projetoId: projeto.id,
    token: randomBytes(24).toString("base64url"),
    dados: montarContrato(entrada),
    representanteId: representante!.id,
    criadoPorId: ator.id,
  });

  revalidatePath("/esteira");
  revalidatePath(`/projeto/${projeto.id}`);
  voltar(
    { ok: `Contrato de ${projeto.cliente.nome} gerado. Agora é enviar pelo WhatsApp: quando a via assinada subir no dossiê, o projeto anda sozinho.` },
    para,
  );
}

/** Anota que o contrato foi mandado ao cliente (o botão abre o WhatsApp e chama isto). */
export async function marcarContratoEnviado(contratoId: string): Promise<void> {
  const ator = await exigirGestaoWeb();
  await db
    .update(schema.contrato)
    .set({ enviadoEm: new Date() })
    .where(and(eq(schema.contrato.id, contratoId), eq(schema.contrato.empresaId, ator.empresaId)));
  revalidatePath("/esteira");
}
