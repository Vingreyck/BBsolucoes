import { atorDaWebOuNulo } from "@/os/acesso";
import { emCampo } from "@/rastreamento/acompanhamento";

export const dynamic = "force-dynamic";

/** A lista de quem está em campo, para o mapa do site recarregar sem recarregar a página. */
export async function GET() {
  const ator = await atorDaWebOuNulo();
  if (!ator) return Response.json({ erro: "nao_autenticado" }, { status: 401 });
  if (!ator.gestao) return Response.json({ erro: "sem_permissao" }, { status: 403 });
  return Response.json(
    { tecnicos: await emCampo(ator.empresaId), geradoEm: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
