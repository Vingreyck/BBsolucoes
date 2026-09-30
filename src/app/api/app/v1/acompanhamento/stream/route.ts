import { exigirApp } from "@/app-movel/autenticacao";
import { fluxoDoCampo } from "@/rastreamento/sse";

export const dynamic = "force-dynamic";

/**
 * As posições ao vivo para o app de quem é da gestão (Server-Sent Events).
 * Só da própria empresa: a assinatura é por empresa, e a empresa vem da
 * sessão, nunca do que o celular pede.
 */
export async function GET(req: Request) {
  const usuario = await exigirApp(req, { permissao: "os.ver_todas" });
  if (usuario instanceof Response) return usuario;
  return fluxoDoCampo(req, usuario.empresaId);
}
