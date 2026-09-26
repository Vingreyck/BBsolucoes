import { exigirApp } from "@/app-movel/autenticacao";
import { redefinirSenha } from "@/app-movel/equipe";
import { ehUuid, falha, json } from "@/app-movel/http";

/**
 * "Esqueci a senha", resolvido pelo administrador.
 *
 * Sem e-mail obrigatório não há link de recuperação — e é assim de propósito:
 * o técnico fala com o administrador, que sorteia uma senha provisória. Ela
 * aparece uma vez no celular do administrador e obriga a troca no primeiro
 * login.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const adm = await exigirApp(req, { permissao: "equipe.gerir" });
  if (adm instanceof Response) return adm;

  const { id } = await params;
  if (!ehUuid(id)) return falha(404, "nao_encontrado", "Pessoa não encontrada.");

  const resultado = await redefinirSenha(adm, id);
  if (!resultado.ok) return falha(resultado.status, resultado.erro, resultado.mensagem);
  return json({ senhaProvisoria: resultado.senhaProvisoria });
}
