import { exigirApp, perfilDoUsuario } from "@/app-movel/autenticacao";
import { json } from "@/app-movel/http";

export const dynamic = "force-dynamic";

/**
 * Quem sou eu, segundo o servidor.
 *
 * O app chama isto ao abrir, **depois** de já ter entrado com o que tinha
 * guardado — nunca antes. O SeeNet aprendeu isso do jeito difícil: esperar a
 * rede para decidir se o técnico está logado faz o app pedir login toda vez
 * que falta sinal. Aqui a resposta só serve para atualizar nome, papel e
 * permissões, e um 401 é o único motivo para mandar de volta ao login.
 */
export async function GET(req: Request) {
  const usuario = await exigirApp(req, { permitirSenhaProvisoria: true });
  if (usuario instanceof Response) return usuario;
  return json({ usuario: perfilDoUsuario(usuario) });
}
