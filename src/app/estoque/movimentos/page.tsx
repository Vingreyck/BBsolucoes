import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";

import { exigirEstoque } from "@/estoque/acesso";
import { itensComSaldo, movimentos } from "@/estoque/estoque";
import { quantidadeLegivel } from "@/estoque/regras";
import { formatarInstante } from "@/os/relogio";
import { numeroOs } from "@/os/tipos";

import { Cabecalho, Vazio } from "../../_ui";
import { endereco, paginar, Paginacao } from "../../_ui/paginacao";

export const dynamic = "force-dynamic";

const MOTIVO: Record<string, string> = {
  entrada: "Entrada",
  os: "Usado em OS",
  estorno: "Estorno",
  ajuste: "Ajuste",
};

const ORIGEM: Record<string, string> = { web: "site", app: "app", sistema: "automático" };

/**
 * O livro do estoque: cada entrada, saída pela OS, ajuste de contagem e
 * estorno, do mais novo para o mais antigo. Nada se apaga — a correção de uma
 * OS aparece como estorno logo acima da saída.
 */
export default async function Movimentos({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; motivo?: string; pagina?: string }>;
}) {
  const usuario = await exigirEstoque();
  const sp = await searchParams;
  const itens = await itensComSaldo(usuario.empresaId);
  const item = sp.item && itens.some((i) => i.id === sp.item) ? itens.find((i) => i.id === sp.item)! : null;
  const motivo = sp.motivo && sp.motivo in MOTIVO ? sp.motivo : "";

  const todos = (await movimentos(usuario.empresaId, { itemId: item?.id })).filter((m) => !motivo || m.motivo === motivo);
  const pagina = paginar(todos, sp.pagina, 50);
  const atuais = { item: item?.id, motivo: motivo || undefined };

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/estoque", rotulo: "Estoque" }]}
        titulo={item ? `Movimentos · ${item.nome}` : "Movimentos"}
        meta={
          item ? (
            <>
              Saldo agora:{" "}
              <strong className={item.saldo < 0 ? "ruim" : ""}>
                {quantidadeLegivel(item.saldo)} {item.unidade}
              </strong>
            </>
          ) : (
            "Cada entrada, saída pela OS, ajuste e estorno. O saldo de cada item é a soma destas linhas."
          )
        }
      />
      <div className="pagina-corpo pilha">
        <section className="lista" id="lista" aria-label="Histórico de movimentos">
        <form className="lista-barra" method="get" action="/estoque/movimentos">
          <select name="item" defaultValue={item?.id ?? ""} aria-label="Item">
            <option value="">Todos os itens</option>
            {itens.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nome}
              </option>
            ))}
          </select>
          <select name="motivo" defaultValue={motivo} aria-label="Tipo de movimento">
            <option value="">Todos os tipos</option>
            {Object.entries(MOTIVO).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
          <button type="submit" className="botao secundario">
            Filtrar
          </button>
          {(item || motivo) && (
            <Link href="/estoque/movimentos" className="link-acao">
              Limpar filtros
            </Link>
          )}
        </form>

          {todos.length === 0 ? (
            <Vazio icone={<ArrowLeftRight size={22} />} titulo="Nenhum movimento">
              Lance uma entrada ou registre material numa OS.
            </Vazio>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Item</th>
                    <th>O que foi</th>
                    <th className="num">Quantidade</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.itens.map((m) => {
                    const q = Number(m.quantidade);
                    const ref = m.ordemServico ? (
                      <Link href={`/os/${m.ordemServico.id}`}>OS {numeroOs(m.ordemServico.numero)}</Link>
                    ) : m.entrada ? (
                      <Link href={`/estoque/entradas/${m.entrada.id}`} title={m.entrada.fornecedor ?? undefined}>
                        {m.entrada.numero ? `Nº ${m.entrada.numero}` : "à mão"}
                      </Link>
                    ) : null;
                    return (
                      <tr key={m.id}>
                        <td className="fraco">{formatarInstante(m.criadoEm, false)}</td>
                        <td>
                          <div className="es-item">
                            <Link href={endereco("/estoque/movimentos", { item: m.item.id })} className="es-item-link">
                              {m.item.nome}
                            </Link>
                            <span className="es-item-meta">
                              <span>{m.usuario?.nome ?? "Selebi"}</span>
                              <span>{ORIGEM[m.origem] ?? m.origem}</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="es-item">
                            <span>
                              <span className={`es-origem es-tipo ${m.motivo}`}>{MOTIVO[m.motivo] ?? m.motivo}</span> {ref}
                            </span>
                            {/* A observação da entrada e da saída repete a referência; a do ajuste e do estorno explica. */}
                            {m.observacao && (m.motivo === "ajuste" || m.motivo === "estorno") && (
                              <span className="es-item-meta">{m.observacao}</span>
                            )}
                          </div>
                        </td>
                        <td className="num">
                          <span className={`es-saldo-linha es-saldo${q < 0 ? " negativo" : ""}`}>
                            <span className="es-saldo-valor">
                              {q > 0 ? "+" : ""}
                              {quantidadeLegivel(q)}
                            </span>
                            <span className="es-saldo-un">{m.item.unidade}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Paginacao {...pagina} href={(n) => endereco("/estoque/movimentos", atuais, { pagina: n })} rotulo="movimentos" />
        </section>
      </div>
    </main>
  );
}
