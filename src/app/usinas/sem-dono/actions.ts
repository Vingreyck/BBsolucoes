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
