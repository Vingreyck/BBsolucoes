import { exigirApp } from "@/app-movel/autenticacao";
import { ehUuid, falha, json } from "@/app-movel/http";
import { respostaDoErro } from "@/app-movel/os-api";
import { ordemDoUsuario } from "@/app-movel/ordens";
import { atorDoApp } from "@/os/acesso";
import { abrirAnexo, removerAnexo } from "@/os/anexos";

export const dynamic = "force-dynamic";

/** A imagem de um anexo, vinda do Drive, para o app mostrar a foto já enviada. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; anexoId: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;
  const { anexoId } = await params;
  if (!ehUuid(anexoId)) return falha(404, "nao_encontrado", "Anexo não encontrado.");
  try {
    const arquivo = await abrirAnexo(atorDoApp(usuario), anexoId);
    return new Response(arquivo.corpo, {
      headers: { "content-type": arquivo.tipo, "cache-control": "private, max-age=86400" },
    });
  } catch (e) {
    return respostaDoErro(e);
  }
}

/** Tira uma foto enviada por engano — o arquivo vai para a lixeira do Drive. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; anexoId: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;
  const { id, anexoId } = await params;
  if (!ehUuid(id) || !ehUuid(anexoId)) return falha(404, "nao_encontrado", "Anexo não encontrado.");
  try {
    await removerAnexo(atorDoApp(usuario), id, anexoId);
    return json({ ordem: await ordemDoUsuario(usuario, id) });
  } catch (e) {
    return respostaDoErro(e);
  }
}
