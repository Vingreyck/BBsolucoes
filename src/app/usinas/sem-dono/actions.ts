"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";

/**
 * Liga uma usina órfã ao cliente certo.
 *
 * É o outro lado da decisão de não inventar dono: o coletor deixa a usina sem
 * cliente, e aqui uma pessoa diz de quem ela é. Um clique, e o alerta daquela
 * usina passa a encontrar o contrato, o telefone e a ART do dossiê.
 */
export async function ligarAoCliente(
  usinaId: string,
  clienteId: string,
): Promise<{ erro?: string }> {
  const usuario = await exigirUsuario();

  const usina = await db.query.usina.findFirst({
    where: and(
      eq(schema.usina.id, usinaId),
      eq(schema.usina.empresaId, usuario.empresaId),
    ),
    columns: { id: true, clienteId: true, nome: true },
  });
  if (!usina) return { erro: "Usina não encontrada." };

  /**
   * Não sobrescreve dono já definido.
   *
   * Esta tela lista só usinas sem cliente, mas duas pessoas com a mesma aba
   * aberta chegariam aqui com a mesma usina. Quem clicar depois estaria
   * mudando o dono que o primeiro acabou de escolher, sem saber — e trocar o
   * dono de uma usina é o erro que justamente estamos tentando evitar.
   */
  if (usina.clienteId) {
    return { erro: "Esta usina já foi ligada a um cliente. Recarregue a tela." };
  }

  const cliente = await db.query.cliente.findFirst({
    where: and(
      eq(schema.cliente.id, clienteId),
      eq(schema.cliente.empresaId, usuario.empresaId),
    ),
    columns: { id: true },
  });
  if (!cliente) return { erro: "Cliente não encontrado." };

  await db
    .update(schema.usina)
    .set({ clienteId })
    .where(eq(schema.usina.id, usinaId));

  revalidatePath("/usinas/sem-dono");
  revalidatePath("/usinas");
  revalidatePath("/alertas");
  return {};
}

/**
 * Liga uma usina órfã a uma venda já instalada: a usina ganha o cliente da venda
 * e a venda ganha a usina — o mesmo elo que o serial do inversor faria sozinho.
 *
 * É o botão da sugestão (nome parecido, mesma cidade, instalação na mesma
 * época). Nunca sobrescreve: se a usina já tem dono ou a venda já tem usina,
 * alguém chegou antes, e trocar calado leva a geração de um cliente para o
 * dossiê de outro.
 */
export async function ligarAoProjeto(usinaId: string, projetoId: string): Promise<{ erro?: string }> {
  const usuario = await exigirUsuario();

  const [usina, projeto] = await Promise.all([
    db.query.usina.findFirst({
      where: and(eq(schema.usina.id, usinaId), eq(schema.usina.empresaId, usuario.empresaId)),
      columns: { id: true, clienteId: true },
    }),
    db.query.projeto.findFirst({
      where: and(eq(schema.projeto.id, projetoId), eq(schema.projeto.empresaId, usuario.empresaId)),
      columns: { id: true, clienteId: true, usinaId: true },
    }),
  ]);
  if (!usina) return { erro: "Usina não encontrada." };
  if (!projeto) return { erro: "Venda não encontrada." };
  if (usina.clienteId) return { erro: "Esta usina já foi ligada a um cliente. Recarregue a tela." };
  if (projeto.usinaId) return { erro: "Esta venda já tem uma usina. Recarregue a tela." };

  await db.transaction(async (tx) => {
    await tx.update(schema.usina).set({ clienteId: projeto.clienteId }).where(eq(schema.usina.id, usina.id));
    await tx.update(schema.projeto).set({ usinaId: usina.id, atualizadoEm: new Date() }).where(eq(schema.projeto.id, projeto.id));
  });

  revalidatePath("/usinas/sem-dono");
  revalidatePath("/usinas");
  revalidatePath("/alertas");
  revalidatePath(`/projeto/${projeto.id}`);
  revalidatePath("/esteira");
  return {};
}
