"use client";

import { useActionState } from "react";

import { trocarSenha } from "./actions";

export function Formulario() {
  const [estado, acao, enviando] = useActionState(trocarSenha, {});

  return (
    <form action={acao} className="form-login">
      <label>
        Senha atual
        <input
          type="password"
          name="atual"
          required
          autoComplete="current-password"
          autoFocus
        />
      </label>

      <label>
        Senha nova
        <input
          type="password"
          name="nova"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </label>

      <label>
        Repita a senha nova
        <input
          type="password"
          name="repetida"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </label>

      {estado.erro && <p className="erro">{estado.erro}</p>}

      <button type="submit" disabled={enviando}>
        {enviando ? "Trocando…" : "Trocar senha"}
      </button>
    </form>
  );
}
