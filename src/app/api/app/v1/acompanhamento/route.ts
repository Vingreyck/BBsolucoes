import { exigirApp } from "@/app-movel/autenticacao";
import { json } from "@/app-movel/http";
import { emCampo } from "@/rastreamento/acompanhamento";

export const dynamic = "force-dynamic";

/**
 * Quem está em campo agora, com a última posição — a lista do "Acompanhar"
 * para quem é da gestão no app. O que muda a cada segundo chega pelo
 * `/acompanhamento/stream`; esta lista é a foto e o plano B.
 */
export async function GET(req: Request) {
  const usuario = await exigirApp(req, { permissao: "os.ver_todas" });
  if (usuario instanceof Response) return usuario;
  return json({ tecnicos: await emCampo(usuario.empresaId), geradoEm: new Date().toISOString() });
}
