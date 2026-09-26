import { exigirApp } from "@/app-movel/autenticacao";
import { alterarMembro } from "@/app-movel/equipe";
import { ehUuid, falha, json, lerJson } from "@/app-movel/http";

/** Trocar o papel ou ativar/desativar alguém da equipe. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adm = await exigirApp(req, { permissao: "equipe.gerir" });
  if (adm instanceof Response) return adm;

  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrado", "Pessoa não encontrada.");

  const corpo = await lerJson(req);
  const mudanca: { papel?: string; ativo?: boolean } = {};
  if (typeof corpo?.papel === "string") mudanca.papel = corpo.papel;
  if (typeof corpo?.ativo === "boolean") mudanca.ativo = corpo.ativo;

  const resultado = await alterarMembro(adm, id, mudanca);
  if (!resultado.ok) return falha(resultado.status, resultado.erro, resultado.mensagem);
  return json({ ok: true });
}
