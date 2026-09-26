import { exigirApp } from "@/app-movel/autenticacao";
import { ehUuid, falha, json } from "@/app-movel/http";
import { ordemDoUsuario } from "@/app-movel/ordens";

export const dynamic = "force-dynamic";

/**
 * Uma OS atualizada, para a tela de detalhe conferir se nada mudou desde a
 * última sincronização. OS fora do escopo de quem pede responde 404, e não
 * 403: dizer "existe, mas não é sua" já é contar alguma coisa.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrado", "Ordem de serviço não encontrada.");

  const ordem = await ordemDoUsuario(usuario, id);
  if (!ordem) return falha(404, "nao_encontrado", "Ordem de serviço não encontrada.");
  return json({ ordem });
}
