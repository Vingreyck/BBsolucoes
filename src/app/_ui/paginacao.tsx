import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/**
 * Paginação com números, para toda lista longa do sistema.
 *
 * Número, e não rolagem infinita, porque as listas daqui são de trabalho:
 * quem cobra o 40º cliente precisa voltar ao mesmo lugar depois, e a página
 * "3 de 5" é um endereço. Isso segue o NN/g, o Baymard e o padrão do GOV.UK:
 * - mostrar sempre a primeira e a última página, mais a atual e as vizinhas;
 * - trocar o resto por reticências;
 * - esconder "anterior" e "próxima" quando não há para onde ir;
 * - não mostrar nada quando tudo cabe numa página.
 * O resumo "26–50 de 190" diz o tamanho da lista.
 */

export const POR_PAGINA = 25;

export interface Pagina<T> {
  itens: T[];
  pagina: number;
  paginas: number;
  total: number;
  /** Posição do primeiro e do último item mostrados (1-based); 0 quando vazia. */
  de: number;
  ate: number;
}

/** Corta a lista na página pedida. Página fora do alcance cai na mais próxima que existe. */
export function paginar<T>(itens: T[], pedida: string | number | undefined, porPagina = POR_PAGINA): Pagina<T> {
  const total = itens.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const n = Number.parseInt(String(pedida ?? ""), 10);
  const pagina = Math.min(Math.max(1, Number.isFinite(n) ? n : 1), paginas);
  const inicio = (pagina - 1) * porPagina;
  return {
    itens: itens.slice(inicio, inicio + porPagina),
    pagina,
    paginas,
    total,
    de: total ? inicio + 1 : 0,
    ate: Math.min(total, inicio + porPagina),
  };
}

/**
 * Monta o endereço trocando só os parâmetros dados e mantendo os outros
 * (busca, filtro, aba). Valor vazio, nulo ou a página 1 saem da URL.
 */
export function endereco(
  caminho: string,
  atuais: Record<string, string | undefined>,
  novos: Record<string, string | number | null | undefined> = {},
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...atuais, ...novos })) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "pagina" && String(v) === "1") continue;
    p.set(k, String(v));
  }
  const q = p.toString();
  return q ? `${caminho}?${q}` : caminho;
}

/** As páginas que aparecem: primeira, última, a atual com uma de cada lado; o resto vira "…". */
function numeros(atual: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  // Perto das pontas, mostra cinco seguidas para a barra não pular de tamanho.
  const meio =
    atual <= 4 ? [2, 3, 4, 5] : atual >= total - 3 ? [total - 4, total - 3, total - 2, total - 1] : [atual - 1, atual, atual + 1];
  const lista: (number | null)[] = [1];
  if (meio[0] > 2) lista.push(null);
  lista.push(...meio);
  if (meio[meio.length - 1] < total - 1) lista.push(null);
  lista.push(total);
  return lista;
}

export function Paginacao({
  pagina,
  paginas,
  total,
  de,
  ate,
  href: montar,
  rotulo = "itens",
  ancora = "lista",
}: Omit<Pagina<unknown>, "itens"> & {
  href: (n: number) => string;
  /** O que está sendo contado, no plural: "dossiês", "clientes". */
  rotulo?: string;
  /**
   * Para onde a página nova rola: o começo da lista, e não o topo da tela.
   * Quem estava no fim da página 1 cai direto na primeira linha da página 2.
   */
  ancora?: string | null;
}) {
  if (total === 0) return null;
  const href = (n: number) => (ancora ? `${montar(n)}#${ancora}` : montar(n));
  return (
    <nav className="paginacao" aria-label="Paginação">
      <p className="paginacao-resumo">
        {paginas > 1 ? (
          <>
            <strong>
              {de}–{ate}
            </strong>{" "}
            de {total.toLocaleString("pt-BR")} {rotulo}
          </>
        ) : (
          <>
            {total.toLocaleString("pt-BR")} {rotulo}
          </>
        )}
      </p>
      {paginas > 1 && (
        <ul className="paginacao-lista">
          <li>
            {pagina > 1 ? (
              <Link href={href(pagina - 1)} className="paginacao-seta" rel="prev">
                <ChevronLeft size={16} aria-hidden /> <span>Anterior</span>
              </Link>
            ) : (
              <span className="paginacao-seta desligada" aria-hidden>
                <ChevronLeft size={16} /> <span>Anterior</span>
              </span>
            )}
          </li>
          {numeros(pagina, paginas).map((n, i) =>
            n === null ? (
              <li key={`r${i}`} className="paginacao-reticencias" aria-hidden>
                …
              </li>
            ) : (
              <li key={n}>
                <Link
                  href={href(n)}
                  className="paginacao-numero"
                  aria-current={n === pagina ? "page" : undefined}
                  aria-label={n === pagina ? `Página ${n}, a atual` : `Página ${n}`}
                >
                  {n}
                </Link>
              </li>
            ),
          )}
          <li>
            {pagina < paginas ? (
              <Link href={href(pagina + 1)} className="paginacao-seta" rel="next">
                <span>Próxima</span> <ChevronRight size={16} aria-hidden />
              </Link>
            ) : (
              <span className="paginacao-seta desligada" aria-hidden>
                <span>Próxima</span> <ChevronRight size={16} />
              </span>
            )}
          </li>
        </ul>
      )}
    </nav>
  );
}
