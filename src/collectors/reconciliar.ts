import { and, eq, isNull, sql } from "drizzle-orm";

import { db, schema } from "../db";

/**
 * Liga usina órfã ao cliente certo pelo número de série do inversor.
 *
 * É a cura do cadastro duplicado, e funciona porque o serial é a única coisa
 * que os dois lados têm em comum. O técnico anota na instalação; o portal
 * mostra a usina dias depois, com um nome que não diz nada ("José Fernando7",
 * "micaely 03"); aqui os dois se encontram.
 *
 * Roda como passo do `npm run atualizar`, depois das coletas, e também logo
 * que alguém digita um serial na tela do projeto. Ser uma varredura, e não um
 * pedaço dentro de cada coletor, resolve os dois sentidos de uma vez:
 *
 * - serial anotado **antes** de a usina aparecer no portal (o normal)
 * - usina que já estava órfã e ganha um serial **depois**
 *
 * E vale para os quatro portais sem tocar em nenhum deles, porque trabalha
 * sobre `equipamento`, que todos já preenchem.
 */

export interface ResultadoReconciliacao {
  ligadas: number;
  /** Serial anotado que o portal ainda não confirmou. */
  aguardando: number;
  /** Serial que bate com usina de **outro** cliente — para alguém olhar. */
  conflitos: { serie: string; projeto: string; usina: string }[];
}

/** Maiúsculo e sem espaço: etiqueta lida à mão erra em caixa e em espaço. */
function comparavel(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, "");
}

export async function reconciliarSeriais(
  empresaId: string,
): Promise<ResultadoReconciliacao> {
  const pendentes = await db.query.serialInstalado.findMany({
    where: and(
      eq(schema.serialInstalado.empresaId, empresaId),
      isNull(schema.serialInstalado.usinaId),
    ),
    with: { projeto: { with: { cliente: { columns: { nome: true } } } } },
  });

  const resultado: ResultadoReconciliacao = {
    ligadas: 0,
    aguardando: 0,
    conflitos: [],
  };
  if (pendentes.length === 0) return resultado;

  /**
   * Os seriais que os portais já trouxeram, indexados para comparação.
   *
   * Carregado de uma vez: são algumas centenas de equipamentos, e uma consulta
   * por serial pendente seria uma consulta por instalação nova.
   */
  const equipamentos = await db
    .select({
      usinaId: schema.equipamento.usinaId,
      serie: schema.equipamento.numeroSerie,
    })
    .from(schema.equipamento)
    .where(
      and(
        eq(schema.equipamento.empresaId, empresaId),
        sql`${schema.equipamento.numeroSerie} is not null`,
      ),
    );

  const usinaPorSerie = new Map<string, string>();
  for (const e of equipamentos) {
    if (e.serie) usinaPorSerie.set(comparavel(e.serie), e.usinaId);
  }

  for (const pendente of pendentes) {
    const usinaId = usinaPorSerie.get(comparavel(pendente.numeroSerie));
    if (!usinaId) {
      resultado.aguardando++;
      continue;
    }

    const usina = await db.query.usina.findFirst({
      where: eq(schema.usina.id, usinaId),
      columns: { id: true, nome: true, clienteId: true },
    });
    if (!usina) {
      resultado.aguardando++;
      continue;
    }

    /**
     * Usina já tem dono, e é outro. Não mexe.
     *
     * Acontece quando o serial foi digitado errado e caiu na usina de outro
     * cliente, ou quando um inversor foi remanejado. Trocar o dono sozinho
     * levaria a geração de uma pessoa para o dossiê de outra, calado — e é
     * justamente o tipo de erro que esta mudança inteira existe para evitar.
     */
    if (usina.clienteId && usina.clienteId !== pendente.projeto.clienteId) {
      resultado.conflitos.push({
        serie: pendente.numeroSerie,
        projeto: pendente.projeto.cliente?.nome ?? pendente.projeto.titulo,
        usina: usina.nome,
      });
      continue;
    }

    const agora = new Date();
    await db.transaction(async (tx) => {
      // A usina ganha o dono do projeto.
      if (!usina.clienteId) {
        await tx
          .update(schema.usina)
          .set({ clienteId: pendente.projeto.clienteId })
          .where(eq(schema.usina.id, usina.id));
      }

      // O projeto ganha a usina, fechando o elo dos dois lados.
      await tx
        .update(schema.projeto)
        .set({ usinaId: usina.id })
        .where(eq(schema.projeto.id, pendente.projetoId));

      await tx
        .update(schema.serialInstalado)
        .set({ usinaId: usina.id, confirmadoEm: agora })
        .where(eq(schema.serialInstalado.id, pendente.id));
    });

    resultado.ligadas++;
  }

  return resultado;
}
