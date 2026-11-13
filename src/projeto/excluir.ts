import { and, count, eq, inArray, like, ne, notInArray, or, sql } from "drizzle-orm";

import { ehUuid } from "@/app-movel/http";
import { db, schema } from "@/db";
import { driveConfigurado, idDoLink, infoDoItem, moverParaLixeira } from "@/documentos/drive";

/**
 * Exclusão de um projeto, e, se pedido, dos documentos dele e do cliente, com os
 * arquivos indo **para a lixeira do Drive**.
 *
 * Lixeira e não exclusão definitiva, e é de propósito (ver `moverParaLixeira`):
 * o Drive guarda por 30 dias e dá para restaurar com dois cliques. O papel de um
 * cliente apagado por engano não volta de outro jeito.
 *
 * Ordem: primeiro o Drive, depois o banco. Mandar para a lixeira de novo um
 * arquivo que já está lá não faz mal, então uma falha no meio deixa o banco
 * intacto e basta repetir. O contrário (banco primeiro) perderia os ids dos
 * arquivos e deixaria lixo no Drive sem dono.
 */

export interface OpcoesDeExclusao {
  /** Apaga os documentos deste projeto (e manda os arquivos para a lixeira). */
  documentos: boolean;
  /** Apaga também o cliente: todos os documentos dele e a pasta dele no Drive. */
  cliente: boolean;
}

export type ResultadoDaExclusao = { ok: string } | { erro: string };

/** O Drive responde 404 para o que já foi apagado: para quem exclui, isso é sucesso. */
async function paraALixeira(id: string): Promise<void> {
  try {
    await moverParaLixeira(id);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Drive respondeu 404")) return;
    throw e;
  }
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O que ainda prende o cliente, e por isso impede de apagar o cadastro dele. */
async function oQueSeguraOCliente(empresaId: string, clienteId: string, projetoId: string): Promise<string[]> {
  const contar = async (tabela: "usina" | "ordemServico" | "unidadeConsumidora") => {
    const t = schema[tabela];
    const [linha] = await db
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.empresaId, empresaId), eq(t.clienteId, clienteId)));
    return Number(linha?.n ?? 0);
  };
  const [outros] = await db
    .select({ n: count() })
    .from(schema.projeto)
    .where(and(eq(schema.projeto.empresaId, empresaId), eq(schema.projeto.clienteId, clienteId), ne(schema.projeto.id, projetoId)));
  const [usinas, ordens, ucs] = await Promise.all([contar("usina"), contar("ordemServico"), contar("unidadeConsumidora")]);
  const preso: string[] = [];
  if (Number(outros?.n ?? 0)) preso.push(plural(Number(outros.n), "outro projeto", "outros projetos"));
  if (usinas) preso.push(plural(usinas, "usina", "usinas"));
  if (ordens) preso.push(plural(ordens, "ordem de serviço", "ordens de serviço"));
  if (ucs) preso.push(plural(ucs, "unidade consumidora", "unidades consumidoras"));
  return preso;
}

export async function excluirProjeto(
  ator: { empresaId: string; id: string },
  projetoId: string,
  opcoes: OpcoesDeExclusao,
): Promise<ResultadoDaExclusao> {
  if (!ehUuid(projetoId)) return { erro: "Projeto não encontrado." };
  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, ator.empresaId)),
    with: { cliente: { columns: { id: true, nome: true } } },
  });
  if (!projeto) return { erro: "Projeto não encontrado." };
  const cliente = projeto.cliente;

  if (opcoes.cliente) {
    const preso = await oQueSeguraOCliente(ator.empresaId, cliente.id, projeto.id);
    if (preso.length) {
      return {
        erro: `O cadastro de ${cliente.nome} não pode ser apagado: ainda tem ${preso.join(", ")}. Desmarque “excluir o cliente” (o projeto e os documentos dele saem do mesmo jeito), ou resolva isso antes.`,
      };
    }
  }

  // Os documentos que saem: todos os do cliente, ou só os deste projeto.
  const quais = opcoes.cliente
    ? eq(schema.documento.clienteId, cliente.id)
    : opcoes.documentos
      ? eq(schema.documento.projetoId, projeto.id)
      : null;
  const docs = quais
    ? await db
        .select({
          id: schema.documento.id,
          nomeArquivo: schema.documento.nomeArquivo,
          linkDrive: schema.documento.linkDrive,
          pastaExterna: schema.documento.pastaExterna,
          modeloEquipamentoId: schema.documento.modeloEquipamentoId,
        })
        .from(schema.documento)
        .where(and(eq(schema.documento.empresaId, ator.empresaId), quais))
    : [];

  // --- o que vai para a lixeira do Drive ---------------------------------------
  const avisos: string[] = [];
  // Datasheet e Inmetro são do catálogo e valem para outros projetos: só a linha sai.
  const candidatos = [
    ...new Set(docs.filter((d) => !d.modeloEquipamentoId).map((d) => idDoLink(d.linkDrive)).filter((i): i is string => Boolean(i))),
  ];
  let arquivos = candidatos;
  if (candidatos.length && docs.length) {
    // O mesmo arquivo em outro documento que fica: não vai para a lixeira.
    const usados = await db
      .select({ link: schema.documento.linkDrive })
      .from(schema.documento)
      .where(
        and(
          eq(schema.documento.empresaId, ator.empresaId),
          notInArray(schema.documento.id, docs.map((d) => d.id)),
          or(...candidatos.map((i) => like(schema.documento.linkDrive, `%${i}%`)))!,
        ),
      );
    const emUso = new Set(usados.map((u) => idDoLink(u.link)).filter((i): i is string => Boolean(i)));
    const mantidos = candidatos.filter((i) => emUso.has(i));
    if (mantidos.length) avisos.push(`${plural(mantidos.length, "arquivo continua", "arquivos continuam")} no Drive porque outro documento usa o mesmo`);
    arquivos = candidatos.filter((i) => !emUso.has(i));
  }

  // A pasta do cliente inteira, só ao excluir o cliente, e só se for mesmo dele.
  const pastas: string[] = [];
  if (opcoes.cliente) {
    for (const pasta of new Set(docs.map((d) => d.pastaExterna).filter((p): p is string => Boolean(p)))) {
      const [dividida] = await db
        .select({ id: schema.documento.id })
        .from(schema.documento)
        .where(and(eq(schema.documento.pastaExterna, pasta), ne(schema.documento.clienteId, cliente.id)))
        .limit(1);
      if (dividida) {
        avisos.push("uma pasta do Drive é usada por outro cliente e não foi mexida");
        continue;
      }
      pastas.push(pasta);
    }
  }

  if ((arquivos.length || pastas.length) && !driveConfigurado()) {
    return {
      erro: "O Drive não está configurado neste ambiente, então não dá para mandar os arquivos para a lixeira. Desmarque a exclusão dos documentos ou configure o Drive.",
    };
  }

  let pastasNaLixeira = 0;
  try {
    for (const pasta of pastas) {
      // Trava de segurança: só vai para a lixeira uma pasta que está sob "CLIENTES <ano>",
      // como o Drive da BB organiza. Um id errado no banco não pode levar a raiz junto.
      const info = await infoDoItem(pasta);
      if (!info) continue; // já não existe
      const mae = info.parents?.[0] ? await infoDoItem(info.parents[0]) : null;
      if (info.mimeType !== "application/vnd.google-apps.folder" || !mae || !/^CLIENTES\b/i.test(mae.name)) {
        avisos.push(`a pasta “${info.name}” não está sob CLIENTES <ano> e não foi mexida (apague à mão, se quiser)`);
        continue;
      }
      await paraALixeira(pasta);
      pastasNaLixeira++;
    }
    for (const arquivo of arquivos) await paraALixeira(arquivo);
  } catch (e) {
    console.error("[excluir-projeto] Drive falhou:", e);
    return {
      erro: `O Drive não respondeu direito (${e instanceof Error ? e.message.slice(0, 160) : "erro"}). Nada foi apagado do Selebi; tente de novo.`,
    };
  }

  // --- o banco -------------------------------------------------------------------
  await db.transaction(async (tx) => {
    // A trilha da LGPD sobrevive ao documento (documento_id fica nulo, a descrição é texto).
    const quando = new Date();
    for (const d of docs) {
      await tx.insert(schema.documentoAcesso).values({
        empresaId: ator.empresaId,
        documentoId: null,
        descricao: `${d.nomeArquivo} (${cliente.nome} · projeto ${projeto.titulo}) — excluído${opcoes.cliente ? " com o cliente" : " com o projeto"}`,
        usuarioId: ator.id,
        acao: "removeu",
        ocorridoEm: quando,
      });
    }
    if (docs.length) {
      await tx.delete(schema.documento).where(inArray(schema.documento.id, docs.map((d) => d.id)));
    }
    await tx
      .delete(schema.comentario)
      .where(and(eq(schema.comentario.empresaId, ator.empresaId), eq(schema.comentario.entidade, "projeto"), eq(schema.comentario.entidadeId, projeto.id)));
    // Eventos, propostas, contratos, cobranças e seriais caem em cascata; as OS ficam, sem projeto.
    await tx.delete(schema.projeto).where(eq(schema.projeto.id, projeto.id));
    if (opcoes.cliente) {
      await tx
        .delete(schema.comentario)
        .where(and(eq(schema.comentario.empresaId, ator.empresaId), eq(schema.comentario.entidade, "cliente"), eq(schema.comentario.entidadeId, cliente.id)));
      await tx.delete(schema.cliente).where(and(eq(schema.cliente.id, cliente.id), eq(schema.cliente.empresaId, ator.empresaId)));
    }
  });

  let texto = `O projeto de ${cliente.nome} foi excluído${opcoes.cliente ? ", junto com o cadastro do cliente" : ""}.`;
  if (docs.length) texto += ` ${plural(docs.length, "documento saiu", "documentos saíram")} do Selebi.`;
  if (arquivos.length || pastasNaLixeira) {
    const dr = [
      pastasNaLixeira ? plural(pastasNaLixeira, "pasta", "pastas") : null,
      arquivos.length ? plural(arquivos.length, "arquivo", "arquivos") : null,
    ].filter(Boolean);
    texto += ` ${dr.join(" e ")} ${pastasNaLixeira + arquivos.length === 1 ? "foi" : "foram"} para a lixeira do Drive (ficam lá 30 dias).`;
  }
  if (avisos.length) texto += ` Atenção: ${avisos.join("; ")}.`;
  return { ok: texto };
}
