"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import {
  cliente as clienteTable,
  comentario,
  etapa as etapaTable,
  projeto as projetoTable,
  projetoEvento,
  serialInstalado,
} from "@/db/schema";
import { reconciliarSeriais } from "@/collectors/reconciliar";

const texto = (d: FormData, campo: string) => {
  const v = String(d.get(campo) ?? "").trim();
  return v === "" ? null : v;
};

const numero = (d: FormData, campo: string) => {
  const v = texto(d, campo);
  if (v === null) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? String(n) : null;
};

/**
 * Cria um projeto na primeira etapa da esteira.
 *
 * Até agora a esteira só tinha os projetos do seed, e um cliente novo não tinha
 * onde entrar — a tela era bonita e não aceitava trabalho. Este é o começo da
 * esteira de verdade.
 *
 * O cliente pode ser um já cadastrado ou um nome novo. Como o cadastro veio dos
 * portais, quase todo mundo que já tem usina já está lá; quem chega para
 * orçamento ainda não, e obrigar a cadastrar antes só faria o vendedor desistir
 * e voltar para o WhatsApp.
 */
export async function criarProjeto(dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();

  const clienteExistente = texto(dados, "clienteId");
  const nomeNovo = texto(dados, "clienteNovo");

  if (!clienteExistente && !nomeNovo) {
    redirect("/projeto/novo?erro=cliente");
  }

  const primeira = await db.query.etapa.findFirst({
    where: and(
      eq(etapaTable.empresaId, usuario.empresaId),
      eq(etapaTable.ativa, true),
    ),
    orderBy: asc(etapaTable.ordem),
  });
  if (!primeira) {
    redirect("/projeto/novo?erro=etapa");
  }

  let clienteId = clienteExistente;

  if (!clienteId && nomeNovo) {
    // Nome repetido vira o mesmo cliente: a planilha dos portais não traz CPF,
    // então é o melhor critério que existe hoje.
    const jaTem = await db.query.cliente.findFirst({
      where: and(
        eq(clienteTable.empresaId, usuario.empresaId),
        eq(clienteTable.nome, nomeNovo),
      ),
    });
    if (jaTem) {
      clienteId = jaTem.id;
    } else {
      const [criado] = await db
        .insert(clienteTable)
        .values({
          empresaId: usuario.empresaId,
          nome: nomeNovo,
          cidade: texto(dados, "cidade"),
          telefone: texto(dados, "telefone"),
        })
        .returning();
      clienteId = criado.id;
    }
  }

  const agora = new Date();
  const titulo = texto(dados, "titulo") ?? "Projeto novo";

  const [projeto] = await db
    .insert(projetoTable)
    .values({
      empresaId: usuario.empresaId,
      clienteId: clienteId as string,
      titulo,
      etapaId: primeira.id,
      responsavelId: usuario.id,
      etapaDesde: agora,
      prazoEtapa: primeira.prazoPadraoDias
        ? new Date(agora.getTime() + primeira.prazoPadraoDias * 86_400_000)
        : null,
      consumoMedioKwh: numero(dados, "consumoMedioKwh"),
      observacoes: texto(dados, "observacoes"),
    })
    .returning();

  /**
   * A entrada na esteira também é um evento. Sem ele, o primeiro trecho do
   * caminho ficaria invisível no histórico, e o tempo até sair da primeira
   * etapa nunca teria de onde ser calculado.
   */
  await db.insert(projetoEvento).values({
    empresaId: usuario.empresaId,
    projetoId: projeto.id,
    etapaParaId: primeira.id,
    usuarioId: usuario.id,
    observacao: "Projeto criado",
    ocorridoEm: agora,
  });

  revalidatePath("/");
  redirect(`/projeto/${projeto.id}`);
}

/** Etapa 2: o que o cliente contou e quanto ele consome. */
export async function salvarInformacoes(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  await exigirUsuario();
  await db
    .update(projetoTable)
    .set({
      consumoMedioKwh: numero(dados, "consumoMedioKwh"),
      concessionaria: texto(dados, "concessionaria"),
      observacoes: texto(dados, "observacoes"),
      atualizadoEm: new Date(),
    })
    .where(eq(projetoTable.id, projetoId));
  revalidatePath(`/projeto/${projetoId}`);
}

/**
 * Etapa 5: o que o técnico encontrou no local.
 *
 * Quem registra fica gravado junto, e não só a data: quando alguém precisar
 * entender uma vistoria estranha meses depois, a pergunta é para uma pessoa,
 * não para o sistema.
 */
export async function salvarVistoria(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  const usuario = await exigirUsuario();
  const data = texto(dados, "vistoriaEm");
  await db
    .update(projetoTable)
    .set({
      vistoriaEm: data ? new Date(`${data}T12:00:00`) : null,
      vistoriaPorId: usuario.id,
      vistoriaObservacoes: texto(dados, "vistoriaObservacoes"),
      atualizadoEm: new Date(),
    })
    .where(eq(projetoTable.id, projetoId));
  revalidatePath(`/projeto/${projetoId}`);
}

/** Etapa 8: ART, memorial e o protocolo do parecer de acesso. */
export async function salvarProjetoTecnico(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  await exigirUsuario();
  await db
    .update(projetoTable)
    .set({
      numeroArt: texto(dados, "numeroArt"),
      protocoloConcessionaria: texto(dados, "protocoloConcessionaria"),
      potenciaKwp: numero(dados, "potenciaKwp"),
      valor: numero(dados, "valor"),
      atualizadoEm: new Date(),
    })
    .where(eq(projetoTable.id, projetoId));
  revalidatePath(`/projeto/${projetoId}`);
}

/**
 * Comentário preso ao projeto.
 *
 * É o que substitui a comunidade do WhatsApp sem virar chat: a conversa fica
 * junto do objeto de que se fala, e continua pesquisável seis meses depois.
 */
export async function comentar(projetoId: string, dados: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const conteudo = texto(dados, "texto");
  if (!conteudo) {
    redirect(`/projeto/${projetoId}`);
  }
  await db.insert(comentario).values({
    empresaId: usuario.empresaId,
    entidade: "projeto",
    entidadeId: projetoId,
    autorId: usuario.id,
    texto: conteudo,
  });
  revalidatePath(`/projeto/${projetoId}`);
}

/**
 * Anota o número de série do inversor no dia da instalação.
 *
 * É o passo que cura o cadastro duplicado. Até aqui, o sistema só descobria
 * uma usina quando ela aparecia no portal do fabricante, dias depois, com o
 * nome que o técnico digitou lá — "José Fernando7", "micaely 03" — e sem nada
 * que a ligasse a este cliente, que já está no Selebi desde a venda.
 *
 * O serial é a única coisa que os dois lados têm em comum: está na etiqueta do
 * aparelho, é único e não muda.
 *
 * Reconcilia na hora, e não só na próxima coleta, porque a usina pode já estar
 * no banco esperando dono — e ver o vínculo acontecer no mesmo clique é o que
 * ensina para que serve digitar isso.
 */
export async function anotarSerial(
  projetoId: string,
  dados: FormData,
): Promise<void> {
  const usuario = await exigirUsuario();

  const bruto = texto(dados, "numeroSerie");
  if (!bruto) redirect(`/projeto/${projetoId}?serial=vazio`);

  // Etiqueta lida à mão erra em caixa e em espaço; o serial do portal é maiúsculo.
  const serie = bruto.toUpperCase().replace(/\s+/g, "");

  const projeto = await db.query.projeto.findFirst({
    where: and(
      eq(projetoTable.id, projetoId),
      eq(projetoTable.empresaId, usuario.empresaId),
    ),
    columns: { id: true },
  });
  if (!projeto) redirect("/");

  try {
    await db.insert(serialInstalado).values({
      empresaId: usuario.empresaId,
      projetoId,
      numeroSerie: serie,
      observacao: texto(dados, "observacao"),
      registradoPor: usuario.id,
    });
  } catch {
    /**
     * O índice único barrou: este serial já está em outro projeto.
     *
     * É digitação errada ou inversor remanejado de um cliente para outro, e
     * nos dois casos quem decide é gente. Gravar aqui levaria a geração de uma
     * pessoa para o dossiê de outra.
     */
    redirect(`/projeto/${projetoId}?serial=repetido`);
  }

  await reconciliarSeriais(usuario.empresaId);

  revalidatePath(`/projeto/${projetoId}`);
  revalidatePath("/usinas/sem-dono");
  redirect(`/projeto/${projetoId}?serial=ok`);
}

/** Remove um serial anotado por engano. */
export async function removerSerial(
  projetoId: string,
  serialId: string,
): Promise<void> {
  const usuario = await exigirUsuario();
  await db
    .delete(serialInstalado)
    .where(
      and(
        eq(serialInstalado.id, serialId),
        eq(serialInstalado.empresaId, usuario.empresaId),
      ),
    );
  revalidatePath(`/projeto/${projetoId}`);
}
