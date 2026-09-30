import { atorDaWebOuNulo } from "@/os/acesso";
import { fluxoDoCampo } from "@/rastreamento/sse";

export const dynamic = "force-dynamic";

/** As posições ao vivo para o mapa do site. Só a gestão, só da própria empresa. */
export async function GET(req: Request) {
  const ator = await atorDaWebOuNulo();
  if (!ator) return new Response("Sessão terminou.", { status: 401 });
  if (!ator.gestao) return new Response("Sem permissão.", { status: 403 });
  return fluxoDoCampo(req, ator.empresaId);
}
