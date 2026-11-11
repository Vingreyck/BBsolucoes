import { criarSessaoApp } from "@/auth/sessao-app";

import { perfilDoUsuario } from "./autenticacao";
import { json } from "./http";
import type { PapelApp } from "./permissoes";

/**
 * A resposta de um login do app que deu certo: o token da sessão e o perfil.
 *
 * Mora aqui porque dois caminhos chegam nela — a senha, quando o segundo fator
 * não é pedido (aparelho conhecido ou 2FA desligado no app), e o código, que
 * fecha o desafio — e os dois têm de responder igual, senão o app teria de
 * entender dois formatos.
 */
export async function respostaDeEntrada(
  u: {
    id: string;
    nome: string;
    cpf: string;
    email: string | null;
    papel: PapelApp;
    deveTrocarSenha: boolean;
    empresa: { id: string; nome: string };
  },
  dispositivo: string | null,
  mfaValidaAte?: Date,
  /** O token que o app guarda para ser reconhecido por 30 dias, quando a pessoa confiou no aparelho. */
  aparelho?: { token: string; expiraEm: Date },
): Promise<Response> {
  const { token, expiraEm } = await criarSessaoApp(u.id, dispositivo, mfaValidaAte);
  return json({
    token,
    expiraEm: expiraEm.toISOString(),
    ...(aparelho ? { dispositivoToken: aparelho.token, dispositivoExpiraEm: aparelho.expiraEm.toISOString() } : {}),
    usuario: perfilDoUsuario({
      id: u.id,
      nome: u.nome,
      cpf: u.cpf,
      email: u.email,
      papel: u.papel,
      empresaId: u.empresa.id,
      empresaNome: u.empresa.nome,
      deveTrocarSenha: u.deveTrocarSenha,
      sessaoId: "",
    }),
  });
}
