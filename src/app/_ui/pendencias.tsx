/**
 * O que falta, em etiquetas curtas, para listas e tabelas.
 *
 * Um ponto colorido diz o peso (vermelho falta, âmbar é meio caminho, como
 * "falta assinar") e o texto diz o quê. Cor nunca sozinha, e a etiqueta fica
 * neutra: uma tabela de 25 linhas toda pintada de vermelho deixa de avisar.
 * Passou de três, as outras viram "+2", com a lista inteira no título.
 */
export interface Pendencia {
  rotulo: string;
  peso?: "falta" | "meio";
}

export function Pendencias({ itens, maximo = 3, vazio }: { itens: Pendencia[]; maximo?: number; vazio?: React.ReactNode }) {
  if (itens.length === 0) return <>{vazio ?? null}</>;
  const mostrar = itens.length > maximo ? itens.slice(0, maximo - 1) : itens;
  const resto = itens.slice(mostrar.length);
  return (
    <span className="pendencias">
      {mostrar.map((p) => (
        <span key={p.rotulo} className={`pendencia ${p.peso ?? "falta"}`}>
          {p.rotulo}
        </span>
      ))}
      {resto.length > 0 && (
        <span className="pendencia mais" title={resto.map((p) => p.rotulo).join(", ")}>
          +{resto.length}
          <span className="sr-only">: {resto.map((p) => p.rotulo).join(", ")}</span>
        </span>
      )}
    </span>
  );
}
