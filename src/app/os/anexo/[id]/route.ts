import { usuarioAtual } from "@/auth/sessao";
import { atorDaWeb, ErroOs } from "@/os/acesso";
import { abrirAnexo } from "@/os/anexos";

/**
 * A foto de uma OS, vinda do Drive pelo próprio Selebi.
 *
 * Quem abre não precisa de conta no Google — é a decisão do Drive como
 * depósito invisível — e só vê se pode ver a OS: o técnico, as dele; a gestão,
 * todas. O navegador guarda por uma hora, só para esta pessoa.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await usuarioAtual();
  if (!usuario) return new Response("Entre no Selebi para ver esta foto.", { status: 401 });
  const { id } = await params;
  try {
    const arquivo = await abrirAnexo(atorDaWeb(usuario), id);
    return new Response(arquivo.corpo, {
      headers: {
        "content-type": arquivo.tipo,
        "content-disposition": `inline; filename="${encodeURIComponent(arquivo.nome)}"`,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ErroOs) return new Response(e.message, { status: e.status });
    console.error("anexo da OS:", e);
    return new Response("Não foi possível buscar o arquivo no Drive.", { status: 502 });
  }
}
