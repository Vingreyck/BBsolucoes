"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { problemaNaSenha } from "@/auth/politica-senha";
import { conferirSenha, gerarHash } from "@/auth/senha";
import { usuarioAtual } from "@/auth/sessao";
import { db } from "@/db";
import { sessao as sessaoTable, usuario as usuarioTable } from "@/db/schema";

export async function trocarSenha(
  _anterior: { erro?: string },
  dados: FormData,
): Promise<{ erro?: string }> {
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  const atual = String(dados.get("atual") ?? "");
  const nova = String(dados.get("nova") ?? "");
  const repetida = String(dados.get("repetida") ?? "");

  // A regra é a mesma do app: `@/auth/politica-senha`.
  const problema = problemaNaSenha(nova);
  if (problema) return { erro: problema };
  if (nova !== repetida) {
    return { erro: "As duas senhas novas não são iguais." };
  }
  if (nova === atual) {
    return { erro: "A senha nova precisa ser diferente da atual." };
  }

  const registro = await db.query.usuario.findFirst({
    where: eq(usuarioTable.id, usuario.id),
    columns: { senhaHash: true },
  });
  if (!registro || !(await conferirSenha(atual, registro.senhaHash))) {
    return { erro: "A senha atual não confere." };
  }

  await db
    .update(usuarioTable)
    .set({ senhaHash: await gerarHash(nova), deveTrocarSenha: false })
    .where(eq(usuarioTable.id, usuario.id));

  /**
   * Derruba as outras sessões desta pessoa, menos a atual.
   *
   * Trocar senha por suspeita de que alguém sabe a antiga não adianta nada se
   * a sessão desse alguém continuar aberta — e a senha antiga aqui **era
   * pública**, num repositório no GitHub. Quem tiver entrado com ela cai agora.
   */
  await db.delete(sessaoTable).where(eq(sessaoTable.usuarioId, usuario.id));

  redirect("/login?trocada=1");
}
