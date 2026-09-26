import { exigirApp } from "@/app-movel/autenticacao";
import { aprovarCadastro } from "@/app-movel/equipe";
import { ehUuid, falha, json, lerJson, texto } from "@/app-movel/http";

/** Libera um cadastro vindo do app, já com o papel que o administrador escolheu. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adm = await exigirApp(req, { permissao: "equipe.gerir" });
  if (adm instanceof Response) return adm;

  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrado", "Cadastro não encontrado.");

  const corpo = await lerJson(req);
  const resultado = await aprovarCadastro(adm, id, texto(corpo?.papel, 20));
  if (!resultado.ok) return falha(resultado.status, resultado.erro, resultado.mensagem);
  return json({ ok: true });
}
