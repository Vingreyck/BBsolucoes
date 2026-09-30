import { and, eq } from "drizzle-orm";

import { exigirApp } from "@/app-movel/autenticacao";
import { ehUuid, falha, json } from "@/app-movel/http";
import { pode } from "@/app-movel/permissoes";
import { db, schema } from "@/db";
import { trilhaDaOs } from "@/rastreamento/acompanhamento";

export const dynamic = "force-dynamic";

/**
 * O trajeto de uma OS: trechos colados nas ruas, onde cada ação foi feita e a
 * posição de agora. A gestão vê de qualquer OS; o técnico, só das dele.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;
  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrado", "Ordem de serviço não encontrada.");

  if (!pode(usuario, "os.ver_todas")) {
    const os = await db.query.ordemServico.findFirst({
      where: and(eq(schema.ordemServico.id, id), eq(schema.ordemServico.empresaId, usuario.empresaId)),
      columns: { responsavelId: true },
    });
    if (!os || os.responsavelId !== usuario.id) return falha(404, "nao_encontrado", "Ordem de serviço não encontrada.");
  }

  const trilha = await trilhaDaOs(usuario.empresaId, id);
  if (!trilha) return falha(404, "nao_encontrado", "Ordem de serviço não encontrada.");
  return json(trilha);
}
