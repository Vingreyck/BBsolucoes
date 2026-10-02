import { redirect } from "next/navigation";

import { usuarioAtual } from "@/auth/sessao";

import { CascaAcesso } from "../_acesso/casca";
import { FormularioPedido } from "./formulario";

export const dynamic = "force-dynamic";

/**
 * Pedido de acesso pelo site — o mesmo cadastro que o app faz no celular.
 *
 * A conta nasce esperando aprovação: quem libera e escolhe o papel é o
 * administrador, em Usuários.
 */
export default async function SolicitarAcesso() {
  if (await usuarioAtual()) redirect("/");

  return (
    <CascaAcesso
      titulo="Solicitar acesso"
      subtitulo="Preencha os seus dados. Um administrador da empresa libera o seu acesso."
      rodape={
        <span>
          Já tem conta? <a href="/login">Entrar</a>
        </span>
      }
    >
      <FormularioPedido />
    </CascaAcesso>
  );
}
