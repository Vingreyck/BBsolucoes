"use server";

import { revalidatePath } from "next/cache";

import { exigirGestaoWeb } from "@/os/acesso";
import { avancarPorDocumentos } from "@/projeto/automatico";
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
  // Só a gestão (adm, engenheiro, vendedor) mexe na esteira de vendas: técnico e
  // estoque veem o projeto, mas as setas não são deles.
  const usuario = await exigirGestaoWeb();
  await moverNaEsteira({
    empresaId: usuario.empresaId,
    projetoId,
    direcao,
    usuarioId: usuario.id,
  });
  // Avançou para uma etapa de documentos que já está completa: segue sozinho.
  if (direcao === "avancar") {
    await avancarPorDocumentos(usuario.empresaId, projetoId, usuario.id).catch(() => null);
  }
  revalidatePath("/");
  revalidatePath("/esteira");
}
