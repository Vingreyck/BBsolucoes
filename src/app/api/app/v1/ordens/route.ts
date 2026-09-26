import { exigirApp } from "@/app-movel/autenticacao";
import { json } from "@/app-movel/http";
import { ordensDoUsuario } from "@/app-movel/ordens";

export const dynamic = "force-dynamic";

/**
 * Todas as OS que o app deve ter no celular, de uma vez.
 *
 * O app substitui a cópia local inteira por esta lista a cada sincronização.
 * Simples de propósito enquanto são dezenas de OS; quando forem milhares, o
 * próximo passo é mandar só o que mudou desde `geradoEm`.
 */
export async function GET(req: Request) {
  const usuario = await exigirApp(req);
  if (usuario instanceof Response) return usuario;

  const ordens = await ordensDoUsuario(usuario);
  return json({ ordens, geradoEm: new Date().toISOString() });
}
