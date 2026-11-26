import { and, eq } from "drizzle-orm";

import { ehUuid } from "@/app-movel/http";
import { usuarioAtual } from "@/auth/sessao";
import { db, schema } from "@/db";
import { baixarArquivo, driveConfigurado } from "@/documentos/drive";
import { podeVerEstoque } from "@/estoque/estoque";

/**
 * A nota ou o pedido de uma entrada, buscado no Drive com a credencial da
 * empresa (como o download do dossiê): a equipe não precisa de conta Google.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; arquivoId: string }> }) {
  const usuario = await usuarioAtual();
  if (!usuario || usuario.deveTrocarSenha) return new Response("Entre no Selebi.", { status: 401 });
  if (!podeVerEstoque(usuario.papel)) return new Response("Sem acesso.", { status: 403 });
  const { id, arquivoId } = await params;
  if (!ehUuid(id) || !ehUuid(arquivoId)) return new Response("Arquivo não encontrado.", { status: 404 });

  const arquivo = await db.query.entradaEstoqueArquivo.findFirst({
    where: and(
      eq(schema.entradaEstoqueArquivo.id, arquivoId),
      eq(schema.entradaEstoqueArquivo.entradaId, id),
      eq(schema.entradaEstoqueArquivo.empresaId, usuario.empresaId),
    ),
  });
  if (!arquivo?.driveId) return new Response("Este arquivo não ficou guardado no Drive.", { status: 404 });
  if (!driveConfigurado()) return new Response("O Drive não está conectado neste servidor.", { status: 503 });

  try {
    const { corpo, tamanho } = await baixarArquivo(arquivo.driveId);
    // O tipo é o reconhecido no envio, nunca o que o Drive disser. O XML vai
    // para baixar, não para o navegador interpretar.
    const xml = arquivo.mime === "application/xml";
    const cabecalhos = new Headers({
      "content-type": xml ? "application/octet-stream" : arquivo.mime,
      "content-disposition": `${xml ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(arquivo.nome)}`,
      "cache-control": "private, no-store",
    });
    if (tamanho) cabecalhos.set("content-length", tamanho);
    return new Response(corpo, { headers: cabecalhos });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Falhou ao buscar o arquivo no Drive.", { status: 502 });
  }
}
