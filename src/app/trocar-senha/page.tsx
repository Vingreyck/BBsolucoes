import { redirect } from "next/navigation";

import { usuarioAtual } from "@/auth/sessao";

import { CascaAcesso } from "../_acesso/casca";
import { Formulario } from "./formulario";

export const dynamic = "force-dynamic";

/**
 * Troca de senha — obrigatória quando a conta ainda está com a provisória.
 *
 * Usa `usuarioAtual()` e não `exigirUsuario()` de propósito: `exigirUsuario`
 * redireciona para cá quem precisa trocar, e chamá-la aqui faria a tela
 * mandar para si mesma sem parar.
 */
export default async function TrocarSenha() {
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");

  return (
    <CascaAcesso
      titulo={usuario.deveTrocarSenha ? "Crie a sua senha" : "Trocar senha"}
      subtitulo={
        usuario.deveTrocarSenha ? (
          <>
            Sua conta está com uma <strong>senha provisória</strong>, que outra pessoa conhece.
            Escolha uma senha sua antes de continuar — é ela que faz o seu nome nos registros do
            sistema significar alguma coisa.
          </>
        ) : (
          "Escolha uma senha nova para a sua conta."
        )
      }
    >
      <Formulario />

      <p className="acesso-nota">
        Ao trocar, todas as sessões abertas com a senha antiga são encerradas, inclusive esta. Você
        entra de novo com a senha nova.
      </p>
    </CascaAcesso>
  );
}
