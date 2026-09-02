import { PASSOS, TOTAL_PASSOS } from "./passos";

/**
 * A régua de progresso da ficha.
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
    <div className="trilha">
      <p className="trilha-topo">
        Passo {atual} de {TOTAL_PASSOS} — <strong>{passo?.titulo}</strong>
      </p>
      <ol className="trilha-marcas">
        {PASSOS.map((p) => {
          const estado =
            p.numero === atual ? "atual" : p.numero <= concluidos ? "feito" : "futuro";
          const podeIr = usinaId && p.numero <= concluidos && p.numero !== atual;
          return (
            <li key={p.numero} className={estado}>
              {podeIr ? (
                <a href={`/cadastro/${usinaId}/${p.numero}`}>{p.titulo}</a>
              ) : (
                <span>{p.titulo}</span>
              )}
            </li>
          );
        })}
      </ol>
      {passo && <p className="trilha-resumo">{passo.resumo}</p>}
    </div>
  );
}
