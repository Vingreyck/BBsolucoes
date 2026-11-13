import { and, eq } from "drizzle-orm";

import { ehUuid } from "@/app-movel/http";
import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { baixarArquivo, driveConfigurado, idDoLink } from "@/documentos/drive";

/**
 * O datasheet ou o Inmetro de um modelo do catálogo, para conferir antes de
 * usar. Busca no Drive com a credencial da empresa, como o download do dossiê:
 * a equipe não precisa de conta Google.
 *
 *   /administracao/equipamentos/arquivo/<id>?qual=datasheet|inmetro
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirUsuario();
  if (usuario.papel !== "adm" && usuario.papel !== "engenheiro") {
    return new Response("Sem acesso.", { status: 403 });
  }
  const { id } = await params;
  if (!ehUuid(id)) return new Response("Modelo não encontrado.", { status: 404 });
  const qual = new URL(req.url).searchParams.get("qual") === "inmetro" ? "inmetro" : "datasheet";

  const m = await db.query.modeloEquipamento.findFirst({
    where: and(eq(schema.modeloEquipamento.id, id), eq(schema.modeloEquipamento.empresaId, usuario.empresaId)),
  });
  if (!m) return new Response("Modelo não encontrado.", { status: 404 });
  const link = qual === "inmetro" ? m.inmetroLink : m.datasheetLink;
  const nome = (qual === "inmetro" ? m.inmetroNome : m.datasheetNome) ?? `${qual}.pdf`;
  const fileId = idDoLink(link);
  if (!fileId) return new Response("Este modelo ainda não tem esse arquivo.", { status: 404 });
  if (!driveConfigurado()) return new Response("O Drive não está conectado neste servidor.", { status: 503 });

  try {
    const { corpo, tipo, tamanho } = await baixarArquivo(fileId);
    const cabecalhos = new Headers({
      "content-type": tipo,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "cache-control": "private, no-store",
    });
    if (tamanho) cabecalhos.set("content-length", tamanho);
    return new Response(corpo, { headers: cabecalhos });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Falhou ao buscar o arquivo no Drive.", { status: 502 });
  }
}
