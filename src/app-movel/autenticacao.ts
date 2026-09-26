import { autenticarApp, type UsuarioApp } from "@/auth/sessao-app";
import { formatarCpf } from "@/auth/cpf";

import { falha } from "./http";
import { pode, permissoesDe, type Permissao } from "./permissoes";

/**
 * Porteiro das rotas do app que exigem login.
 *
 * Devolve o usuário, ou a resposta de erro pronta para a rota devolver:
 *
 *   const u = await exigirApp(req);
 *   if (u instanceof Response) return u;
 *
 * Senha provisória barra tudo menos ver o próprio perfil, trocar a senha e
 * sair — igual ao navegador.
 */
export async function exigirApp(
  req: Request,
  opcoes: { permissao?: Permissao; permitirSenhaProvisoria?: boolean } = {},
): Promise<UsuarioApp | Response> {
  const usuario = await autenticarApp(req);
  if (!usuario) {
    return falha(401, "nao_autenticado", "Sua sessão terminou. Entre de novo.");
  }
  if (usuario.deveTrocarSenha && !opcoes.permitirSenhaProvisoria) {
    return falha(403, "trocar_senha", "Troque a senha provisória para continuar.");
  }
  if (opcoes.permissao && !pode(usuario, opcoes.permissao)) {
    return falha(403, "sem_permissao", "Seu perfil não tem acesso a isto.");
  }
  return usuario;
}

/** O que o app guarda sobre quem entrou. */
export function perfilDoUsuario(u: UsuarioApp) {
  return {
    id: u.id,
    nome: u.nome,
    cpf: formatarCpf(u.cpf),
    email: u.email,
    papel: u.papel,
    deveTrocarSenha: u.deveTrocarSenha,
    empresa: { id: u.empresaId, nome: u.empresaNome },
    permissoes: permissoesDe(u.papel),
  };
}
