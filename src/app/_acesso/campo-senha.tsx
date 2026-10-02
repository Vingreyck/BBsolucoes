"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Campo de senha com o botão de mostrar.
 *
 * Sem JavaScript continua sendo um `<input type="password">` comum — o botão
 * só aparece depois que o React assume, então o login nunca depende dele.
 */
export function CampoSenha({
  name,
  autoComplete,
  minLength,
  required = true,
  autoFocus,
  invalido,
  descricao,
}: {
  name: string;
  autoComplete: string;
  minLength?: number;
  required?: boolean;
  autoFocus?: boolean;
  invalido?: boolean;
  descricao?: string;
}) {
  const [visivel, setVisivel] = useState(false);
  const [hidratado, setHidratado] = useState(false);
  useEffect(() => setHidratado(true), []);

  return (
    <span className="entrada-senha">
      <input
        type={visivel ? "text" : "password"}
        name={name}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        autoFocus={autoFocus}
        aria-invalid={invalido || undefined}
        aria-describedby={descricao}
      />
      {hidratado && (
        <button
          type="button"
          className="entrada-senha-olho"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? "Esconder senha" : "Mostrar senha"}
          aria-pressed={visivel}
        >
          {visivel ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      )}
    </span>
  );
}
