import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { atorDaWebOuNulo, podeVer } from "@/os/acesso";
import { trilhaDaOs } from "@/rastreamento/acompanhamento";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O trajeto da OS para o mapa da tela da OS — quem vê a OS vê o trajeto dela. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ator = await atorDaWebOuNulo();
  if (!ator) return Response.json({ erro: "nao_autenticado" }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ erro: "nao_encontrado" }, { status: 404 });

  const os = await db.query.ordemServico.findFirst({
    where: and(eq(schema.ordemServico.id, id), eq(schema.ordemServico.empresaId, ator.empresaId)),
    columns: { responsavelId: true },
  });
  if (!os || !podeVer(ator, os)) return Response.json({ erro: "nao_encontrado" }, { status: 404 });

  const trilha = await trilhaDaOs(ator.empresaId, id);
  return Response.json(trilha, { headers: { "cache-control": "no-store" } });
}
