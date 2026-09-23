"use client";

import { useState, useTransition } from "react";

import { ligarAoCliente } from "./actions";

interface Cliente {
  id: string;
  nome: string;
  docs: number;
}

/**
 * Escolher o dono de uma usina.
 *
 * Os parecidos vêm como botão, porque é o caso comum e merece um clique só. A
 * lista inteira fica atrás de um `select`, para quando a sugestão errar — e ela
 * erra, porque nome de portal não segue regra.
 */
export function Ligar({
  usinaId,
  sugestoes,
  clientes,
}: {
  usinaId: string;
  sugestoes: Cliente[];
  clientes: Cliente[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState<string | null>(null);
  const [pendente, comecar] = useTransition();

  function ligar(cliente: Cliente) {
    setErro(null);
    comecar(async () => {
      const r = await ligarAoCliente(usinaId, cliente.id);
      if (r.erro) setErro(r.erro);
      else setPronto(cliente.nome);
    });
  }

  if (pronto) {
    return <p className="ok">Ligada a {pronto}.</p>;
  }

  return (
    <div className="ligar">
      {sugestoes.length > 0 && (
        <div className="sugestoes">
          {sugestoes.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={pendente}
              onClick={() => ligar(c)}
              title={`${c.docs} documentos`}
            >
              {c.nome}
              {c.docs > 0 && <span className="conta">{c.docs} docs</span>}
            </button>
          ))}
        </div>
      )}

      <select
        disabled={pendente}
        defaultValue=""
        aria-label="Escolher outro cliente"
        onChange={(e) => {
          const c = clientes.find((x) => x.id === e.target.value);
          if (c) ligar(c);
        }}
      >
        <option value="" disabled>
          {sugestoes.length ? "outro cliente…" : "escolher cliente…"}
        </option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
            {c.docs > 0 ? ` (${c.docs} docs)` : ""}
          </option>
        ))}
      </select>

      {erro && <p className="erro">{erro}</p>}
    </div>
  );
}
