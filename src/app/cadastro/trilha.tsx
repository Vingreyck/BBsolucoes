import { Check } from "lucide-react";

import { PASSOS, TOTAL_PASSOS } from "./passos";

/**
 * A régua de progresso da ficha, no mesmo desenho do caminho do projeto e da OS.
 *
 * Mostra onde a pessoa está e quanto falta — é o que faz um formulário longo
 * parar de assustar. Passos já preenchidos viram link, para voltar e corrigir
 * sem perder o resto; os que ainda não chegaram ficam inertes.
 */
export function Trilha({
  atual,
  usinaId,
  concluidos = 0,
}: {
  atual: number;
  usinaId?: string;
  concluidos?: number;
}) {
  const passo = PASSOS.find((p) => p.numero === atual);

  return (
    <div className="trilha-ficha">
      <ol className="caminho" aria-label={`Passo ${atual} de ${TOTAL_PASSOS}`}>
        {PASSOS.map((p) => {
          const estado = p.numero === atual ? "atual" : p.numero <= concluidos ? "feita" : "proxima";
          const podeIr = usinaId && p.numero <= concluidos && p.numero !== atual;
          const conteudo = (
            <>
              <span className="caminho-marca" aria-hidden>
                {estado === "feita" ? <Check size={12} strokeWidth={3} /> : p.numero}
              </span>
              <span className="caminho-nome">{p.titulo}</span>
            </>
          );
          return (
            <li
              key={p.numero}
              className={`caminho-passo ${estado}`}
              aria-current={estado === "atual" ? "step" : undefined}
              title={p.titulo}
            >
              {podeIr ? (
                <a href={`/cadastro/${usinaId}/${p.numero}`} className="caminho-link">
                  {conteudo}
                </a>
              ) : (
                conteudo
              )}
            </li>
          );
        })}
      </ol>
      {passo && <p className="trilha-resumo">{passo.resumo}</p>}
    </div>
  );
}
