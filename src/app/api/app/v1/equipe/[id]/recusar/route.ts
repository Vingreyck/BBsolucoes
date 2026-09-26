import { exigirApp } from "@/app-movel/autenticacao";
import { recusarCadastro } from "@/app-movel/equipe";
import { ehUuid, falha, semConteudo } from "@/app-movel/http";

/** Recusa (e apaga) um cadastro que ainda não foi aprovado. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adm = await exigirApp(req, { permissao: "equipe.gerir" });
  if (adm instanceof Response) return adm;

  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrado", "Cadastro não encontrado.");

  const resultado = await recusarCadastro(adm, id);
  if (!resultado.ok) return falha(resultado.status, resultado.erro, resultado.mensagem);
  return semConteudo();
}
