"use client";

import { useRouter } from "next/navigation";

/**
 * Um filtro de muitas opções num select, no lugar de uma fileira de botões.
 *
 * As 13 etapas viravam duas linhas de etiquetas que empurravam a tabela para
 * baixo. Cada opção já traz o endereço pronto (com busca e página), e trocar
 * leva direto para ele.
 */
export function SeletorFiltro({
  rotulo,
  atual,
  opcoes,
}: {
  rotulo: string;
  atual: string;
  opcoes: { valor: string; rotulo: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <label className={`seletor-filtro${atual ? " ativo" : ""}`}>
      <span>{rotulo}</span>
      <select
        value={atual}
        onChange={(e) => {
          const escolhida = opcoes.find((o) => o.valor === e.target.value);
          if (escolhida) router.push(escolhida.href);
        }}
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}
