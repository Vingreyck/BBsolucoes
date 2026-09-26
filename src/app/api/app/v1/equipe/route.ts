import { exigirApp } from "@/app-movel/autenticacao";
import { equipeDaEmpresa } from "@/app-movel/equipe";
import { json } from "@/app-movel/http";

export const dynamic = "force-dynamic";

/** Cadastros esperando aprovação e a equipe da empresa. Só administrador. */
export async function GET(req: Request) {
  const adm = await exigirApp(req, { permissao: "equipe.gerir" });
  if (adm instanceof Response) return adm;
  return json(await equipeDaEmpresa(adm.empresaId));
}
