import { exigirApp } from "@/app-movel/autenticacao";
import { ehUuid, falha, json, lerJson, texto } from "@/app-movel/http";
import { respostaDoErro } from "@/app-movel/os-api";
import { ordemDoUsuario } from "@/app-movel/ordens";
import { corrigirMaterial, OBSERVACAO_MAXIMO, removerMaterial } from "@/estoque/baixa";
import { atorDoApp } from "@/os/acesso";

export const dynamic = "force-dynamic";

/**
 * Corrige a quantidade de um material registrado — o estoque acompanha pela
 * diferença.
 *
 *   PATCH { quantidade?, observacao? }
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;
  const { id, materialId } = await params;
  if (!ehUuid(id) || !ehUuid(materialId)) return falha(404, "nao_encontrado", "Material não encontrado.");

  const corpo = await lerJson(req, 8_192);
  if (!corpo) return falha(400, "requisicao_invalida", "Não entendi o que foi enviado.");

  try {
    await corrigirMaterial(atorDoApp(usuario), id, materialId, {
      quantidade: corpo.quantidade === undefined ? undefined : corpo.quantidade,
      observacao: corpo.observacao === undefined ? undefined : typeof corpo.observacao === "string" ? texto(corpo.observacao, OBSERVACAO_MAXIMO) : null,
    });
    return json({ ordem: await ordemDoUsuario(usuario, id) });
  } catch (e) {
    return respostaDoErro(e);
  }
}

/** Tira o material registrado por engano: o que tinha saído volta para o estoque. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;
  const { id, materialId } = await params;
  if (!ehUuid(id) || !ehUuid(materialId)) return falha(404, "nao_encontrado", "Material não encontrado.");
  try {
    await removerMaterial(atorDoApp(usuario), id, materialId);
    return json({ ordem: await ordemDoUsuario(usuario, id) });
  } catch (e) {
    return respostaDoErro(e);
  }
}
