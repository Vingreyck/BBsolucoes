"use client";

import { useActionState } from "react";

import { CampoSenha } from "../_acesso/campo-senha";
import { trocarSenha } from "./actions";

export function Formulario() {
  const [estado, acao, enviando] = useActionState(trocarSenha, {});

  return (
    <form action={acao} className="acesso-form">
      <label className="entrada">
        <span className="entrada-rotulo">Senha atual</span>
        <CampoSenha name="atual" autoComplete="current-password" autoFocus />
      </label>

      <label className="entrada">
        <span className="entrada-rotulo">Senha nova</span>
        <CampoSenha name="nova" autoComplete="new-password" minLength={8} descricao="ajuda-nova" />
        <span className="entrada-ajuda" id="ajuda-nova">
          Pelo menos 8 caracteres. Não use o seu CPF nem senhas óbvias.
        </span>
      </label>

      <label className="entrada">
        <span className="entrada-rotulo">Repita a senha nova</span>
        <CampoSenha name="repetida" autoComplete="new-password" minLength={8} />
      </label>

      {estado.erro && (
        <p className="acesso-mensagem erro" role="alert">
          {estado.erro}
        </p>
      )}

      <button type="submit" className="botao-grande" disabled={enviando}>
        {enviando ? "Trocando…" : "Trocar senha"}
      </button>
    </form>
  );
}
