import { usuarioAtual } from "@/auth/sessao";
import { atorDaWeb, ErroOs } from "@/os/acesso";
import { carregarOs } from "@/os/consultas";
import { gerarRelatorio, nomeDoRelatorio } from "@/os/relatorio";

/** O relatório da OS em PDF, para a equipe. Gerado na hora, nunca guardado. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await usuarioAtual();
  if (!usuario) return Response.redirect(new URL("/login", _req.url), 303);
  const { id } = await params;
  try {
    const os = await carregarOs(atorDaWeb(usuario), id);
    const pdf = await gerarRelatorio(os);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${nomeDoRelatorio(os)}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ErroOs) return new Response(e.message, { status: e.status });
    throw e;
  }
}
