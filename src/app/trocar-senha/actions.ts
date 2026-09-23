"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { conferirSenha, gerarHash } from "@/auth/senha";
import { usuarioAtual } from "@/auth/sessao";
import { db } from "@/db";
import { sessao as sessaoTable, usuario as usuarioTable } from "@/db/schema";

/**
 * Tamanho mínimo da senha.
 *
 * Oito é o piso das recomendações e é o que dá para pedir a uma equipe que vai
 * digitar isso no celular, em cima de um telhado. Comprimento importa mais que
 * exigir símbolo: regra de complexidade produz `Senha@123` em todo mundo.
 */
const MINIMO = 8;

/** Senhas que já estiveram num repositório público não voltam. */
const PROIBIDAS = new Set(["bbsolucoes", "12345678", "senha123", "bbsolucoes1"]);

export async function trocarSenha(
  _anterior: { erro?: string },
  dados: FormData,
): Promise<{ erro?: string }> {
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  const atual = String(dados.get("atual") ?? "");
  const nova = String(dados.get("nova") ?? "");
  const repetida = String(dados.get("repetida") ?? "");

  if (nova.length < MINIMO) {
    return { erro: `A senha nova precisa de pelo menos ${MINIMO} caracteres.` };
  }
  if (nova !== repetida) {
    return { erro: "As duas senhas novas não são iguais." };
  }
  if (PROIBIDAS.has(nova.toLowerCase())) {
    return {
      erro: "Essa senha já foi usada por todo mundo e está publicada. Escolha outra.",
    };
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
