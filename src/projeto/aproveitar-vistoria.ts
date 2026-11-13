import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { db, schema } from "@/db";

import { distribuidoraDaCidade, lerDadosTecnicos, lerVistoria, type DadosDaVistoria, type DadosTecnicos } from "./da-vistoria";

/**
 * Aproveita o que o técnico respondeu na vistoria: leva o tipo de telhado para
 * o projeto e a UC (número e titular da conta) para o cadastro do cliente.
 *
 * Chamada quando a vistoria é concluída. Regra de ouro: **só preenche o que
 * está vazio**. O que o comercial ou o engenheiro já digitaram vale mais que a
 * resposta de campo, e nunca é sobrescrito. Rodar de novo não muda nada.
 */

export interface Aproveitado {
  telhado: boolean;
  /** "criada" (UC nova no cadastro), "completada" (titular preenchido na UC que já existia) ou nada. */
  uc: "criada" | "completada" | null;
}

export async function aproveitarVistoria(empresaId: string, projetoId: string): Promise<Aproveitado> {
  const nada: Aproveitado = { telhado: false, uc: null };

  const projeto = await db.query.projeto.findFirst({
    where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, empresaId)),
    columns: { id: true, clienteId: true, concessionaria: true, telhadoTipo: true },
    with: { cliente: { columns: { cidade: true } } },
  });
  if (!projeto) return nada;

  // A vistoria concluída mais recente do projeto. A que ainda está em campo
  // pode mudar de resposta: só vale depois de concluída.
  const vistoria = await db.query.ordemServico.findFirst({
    where: and(
      eq(schema.ordemServico.empresaId, empresaId),
      eq(schema.ordemServico.projetoId, projeto.id),
      eq(schema.ordemServico.tipo, "vistoria"),
      eq(schema.ordemServico.status, "concluida"),
    ),
    orderBy: desc(schema.ordemServico.concluidaEm),
    columns: { id: true },
    with: { checklist: { columns: { chave: true, valor: true } } },
  });
  if (!vistoria) return nada;
  const dados: DadosDaVistoria = lerVistoria(vistoria.checklist);

  const feito: Aproveitado = { telhado: false, uc: null };

  if (dados.telhado && !projeto.telhadoTipo) {
    await db
      .update(schema.projeto)
      .set({ telhadoTipo: dados.telhado, atualizadoEm: new Date() })
      .where(eq(schema.projeto.id, projeto.id));
    feito.telhado = true;
  }

  if (dados.ucNumero) {
    // Sem concessionária no projeto, ela sai da cidade do cliente: Sergipe tem
    // duas distribuidoras (Energisa e, em 12 cidades do sul, a Sulgipe).
    const concessionaria = projeto.concessionaria?.trim() || distribuidoraDaCidade(projeto.cliente.cidade);
    const jaTem = await db.query.unidadeConsumidora.findFirst({
      where: and(
        eq(schema.unidadeConsumidora.empresaId, empresaId),
        eq(schema.unidadeConsumidora.concessionaria, concessionaria),
        eq(schema.unidadeConsumidora.numeroInstalacao, dados.ucNumero),
      ),
      columns: { id: true, clienteId: true, titular: true },
    });
    if (!jaTem) {
      await db
        .insert(schema.unidadeConsumidora)
        .values({
          empresaId,
          clienteId: projeto.clienteId,
          numeroInstalacao: dados.ucNumero,
          concessionaria,
          titular: dados.titular,
        })
        .onConflictDoNothing();
      feito.uc = "criada";
    } else if (jaTem.clienteId === projeto.clienteId && !jaTem.titular && dados.titular) {
      await db
        .update(schema.unidadeConsumidora)
        .set({ titular: dados.titular })
        .where(eq(schema.unidadeConsumidora.id, jaTem.id));
      feito.uc = "completada";
    }
    // UC que já é de outro cliente: não mexe. Dois cadastros para a mesma UC é
    // erro de digitação ou imóvel que mudou de dono, e quem decide é gente.
  }

  return feito;
}

/**
 * Os dados técnicos da vistoria de cada projeto, para o engenheiro e para a
 * esteira.
 *
 * Junta as respostas de **todas** as vistorias do projeto: a "visita de volta"
 * é outra OS de vistoria só com os itens que ficaram (sombra, área útil…), e
 * ler só a mais nova perderia o que a primeira respondeu. Item a item, vale a
 * resposta mais recente que não está em branco. `concluida` diz se alguma
 * vistoria já foi concluída (senão são respostas ainda em campo, que podem
 * mudar); `osId` e `osNumero` são os da vistoria original.
 */
export async function dadosTecnicosDosProjetos(
  empresaId: string,
  projetoIds: string[],
): Promise<Map<string, { dados: DadosTecnicos; concluida: boolean; osId: string; osNumero: number }>> {
  const resultado = new Map<string, { dados: DadosTecnicos; concluida: boolean; osId: string; osNumero: number }>();
  if (!projetoIds.length) return resultado;
  const vistorias = await db.query.ordemServico.findMany({
    where: and(
      eq(schema.ordemServico.empresaId, empresaId),
      inArray(schema.ordemServico.projetoId, projetoIds),
      eq(schema.ordemServico.tipo, "vistoria"),
      ne(schema.ordemServico.status, "cancelada"),
    ),
    orderBy: desc(schema.ordemServico.numero),
    columns: { id: true, numero: true, status: true, projetoId: true },
    with: { checklist: { columns: { chave: true, valor: true } } },
  });
  const porProjeto = new Map<string, typeof vistorias>();
  for (const v of vistorias) {
    if (!v.projetoId) continue;
    porProjeto.set(v.projetoId, [...(porProjeto.get(v.projetoId) ?? []), v]);
  }
  for (const [projetoId, lista] of porProjeto) {
    // `lista` vem da mais nova para a mais antiga.
    const juntas = new Map<string, unknown>();
    for (const v of lista) {
      for (const i of v.checklist) {
        if (i.chave && i.valor !== null && !juntas.has(i.chave)) juntas.set(i.chave, i.valor);
      }
    }
    const original = lista[lista.length - 1];
    resultado.set(projetoId, {
      dados: lerDadosTecnicos([...juntas].map(([chave, valor]) => ({ chave, valor }))),
      concluida: lista.some((v) => v.status === "concluida"),
      osId: original.id,
      osNumero: original.numero,
    });
  }
  return resultado;
}
