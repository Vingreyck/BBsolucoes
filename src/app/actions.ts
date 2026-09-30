"use server";

import { revalidatePath } from "next/cache";

import { exigirUsuario } from "@/auth/sessao";
import { moverNaEsteira } from "@/projeto/esteira";

/**
 * A seta da esteira: move o projeto para a etapa vizinha.
 *
 * A regra mora em `@/projeto/esteira`, porque a conclusão de uma OS também
 * anda o projeto. Aqui fica o que é da tela: conferir quem está logado — a
 * primeira versão não conferia, e ação de servidor sem essa checagem responde
 * a qualquer um que tenha um cookie, válido ou não — e registrar quem moveu.
 */
export async function moverProjeto(
  projetoId: string,
  direcao: "avancar" | "voltar",
): Promise<void> {
  const usuario = await exigirUsuario();
  await moverNaEsteira({
    empresaId: usuario.empresaId,
    projetoId,
    direcao,
    usuarioId: usuario.id,
  });
  revalidatePath("/");
}
