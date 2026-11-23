import { and, desc, eq, ilike, isNotNull, or } from "drizzle-orm";
import { Eye, FilePlus2, FileText, PenLine, Search, Send } from "lucide-react";
import Link from "next/link";

import { db, schema } from "@/db";
import { exigirGestaoWeb } from "@/os/acesso";
import { kwpTexto, moeda } from "@/proposta/calculo";

import { Cabecalho, Cartao, Vazio } from "../_ui";
import { endereco, Paginacao, paginar } from "../_ui/paginacao";
import { origemDoSite } from "../origem";

export const dynamic = "force-dynamic";

function data(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Sao_Paulo" });
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1][0] ?? "") : "")).toUpperCase();
}

/**
 * As propostas comerciais, cada uma de um cliente: o número, o valor, se foi
 * enviada e quantas vezes o cliente abriu. Em cima, as que estão sendo montadas
 * (rascunho no assistente); "Nova proposta" começa escolhendo o cliente.
 */
export default async function Propostas({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; nova?: string }>;
}) {
  const ator = await exigirGestaoWeb();
  const { q, pagina: paginaPedida, nova } = await searchParams;
  const busca = (q ?? "").trim().slice(0, 60);
  const origem = await origemDoSite();

  const propostas = await db
    .select({
      id: schema.proposta.id,
      numero: schema.proposta.numero,
      token: schema.proposta.token,
      dados: schema.proposta.dados,
      criadoEm: schema.proposta.criadoEm,
      enviadoEm: schema.proposta.enviadoEm,
      visualizacoes: schema.proposta.visualizacoes,
      ultimaVisualizacaoEm: schema.proposta.ultimaVisualizacaoEm,
      projetoId: schema.projeto.id,
      cliente: schema.cliente.nome,
      cidade: schema.cliente.cidade,
    })
    .from(schema.proposta)
    .innerJoin(schema.projeto, eq(schema.projeto.id, schema.proposta.projetoId))
    .innerJoin(schema.cliente, eq(schema.cliente.id, schema.projeto.clienteId))
    .where(
      and(
        eq(schema.proposta.empresaId, ator.empresaId),
        busca ? or(ilike(schema.cliente.nome, `%${busca}%`), ilike(schema.cliente.cidade, `%${busca}%`)) : undefined,
      ),
    )
    .orderBy(desc(schema.proposta.criadoEm));

  const rascunhos = await db
    .select({ projetoId: schema.projeto.id, cliente: schema.cliente.nome, cidade: schema.cliente.cidade, atualizadoEm: schema.projeto.atualizadoEm })
    .from(schema.projeto)
    .innerJoin(schema.cliente, eq(schema.cliente.id, schema.projeto.clienteId))
    .where(and(eq(schema.projeto.empresaId, ator.empresaId), isNotNull(schema.projeto.propostaRascunho), eq(schema.projeto.situacao, "em_andamento")))
    .orderBy(desc(schema.projeto.atualizadoEm))
    .limit(60);
  const comProposta = new Set(propostas.map((p) => p.projetoId));
  const emAndamento = rascunhos.filter((r) => !comProposta.has(r.projetoId)).slice(0, 8);

  // "Nova proposta": escolher o cliente (os projetos em andamento, com busca).
  const clientes = nova
    ? await db
        .select({ projetoId: schema.projeto.id, cliente: schema.cliente.nome, cidade: schema.cliente.cidade, titulo: schema.projeto.titulo, etapa: schema.etapa.nome })
        .from(schema.projeto)
        .innerJoin(schema.cliente, eq(schema.cliente.id, schema.projeto.clienteId))
        .innerJoin(schema.etapa, eq(schema.etapa.id, schema.projeto.etapaId))
        .where(
          and(
            eq(schema.projeto.empresaId, ator.empresaId),
            eq(schema.projeto.situacao, "em_andamento"),
            busca ? or(ilike(schema.cliente.nome, `%${busca}%`), ilike(schema.cliente.cidade, `%${busca}%`)) : undefined,
          ),
        )
        .orderBy(desc(schema.projeto.atualizadoEm))
        .limit(30)
    : [];

  const pagina = paginar(propostas, paginaPedida);
  const abertas = propostas.filter((p) => p.visualizacoes > 0).length;
  const enviadas = propostas.filter((p) => p.enviadoEm).length;

  return (
    <main>
      <Cabecalho
        titulo="Propostas"
        meta="Cada proposta é de um cliente: monte no assistente, mande pelo WhatsApp e veja quando ele abriu."
        acoes={
          <Link href={endereco("/propostas", { q: busca || undefined }, { nova: "1" })} className="botao">
            <FilePlus2 size={15} aria-hidden /> Nova proposta
          </Link>
        }
      />

      <div className="pagina-corpo pilha">
        <div className="pp-resumo">
          <div>
            <span>Propostas</span>
            <strong>{propostas.length.toLocaleString("pt-BR")}</strong>
          </div>
          <div>
            <span>Enviadas</span>
            <strong>{enviadas.toLocaleString("pt-BR")}</strong>
          </div>
          <div>
            <span>Abertas pelo cliente</span>
            <strong>{abertas.toLocaleString("pt-BR")}</strong>
          </div>
          <div>
            <span>Sendo montadas</span>
            <strong>{emAndamento.length.toLocaleString("pt-BR")}</strong>
          </div>
        </div>

        <form className="pp-busca" method="get">
          {nova && <input type="hidden" name="nova" value="1" />}
          <Search size={16} aria-hidden />
          <input name="q" defaultValue={busca} placeholder="Procurar pelo nome do cliente ou pela cidade" aria-label="Procurar" />
        </form>

        {nova && (
          <Cartao titulo="Para qual cliente?" icone={<FilePlus2 size={16} />} ajuda="A proposta é montada em cima do projeto do cliente: consumo, vistoria, conta de luz e dossiê já entram sozinhos. Cliente novo: crie o projeto primeiro.">
            {clientes.length ? (
              <ul className="pp-clientes">
                {clientes.map((c) => (
                  <li key={c.projetoId}>
                    <Link href={`/projeto/${c.projetoId}/proposta`} className="pp-cliente">
                      <span className="pp-avatar" aria-hidden>
                        {iniciais(c.cliente)}
                      </span>
                      <span className="pp-cliente-texto">
                        <strong>{c.cliente}</strong>
                        <small>
                          {[c.cidade, c.etapa].filter(Boolean).join(" · ")}
                        </small>
                      </span>
                      <span className="pp-cliente-acao">Montar a proposta →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Vazio icone={<Search size={20} />} titulo="Nenhum cliente com esse nome" />
            )}
            <p className="nota">
              Cliente que ainda não tem projeto: <Link href="/projeto/novo">criar o projeto</Link>.
            </p>
          </Cartao>
        )}

        {emAndamento.length > 0 && !busca && (
          <Cartao titulo="Sendo montadas" icone={<PenLine size={16} />} contador={emAndamento.length}>
            <ul className="pp-clientes">
              {emAndamento.map((r) => (
                <li key={r.projetoId}>
                  <Link href={`/projeto/${r.projetoId}/proposta`} className="pp-cliente">
                    <span className="pp-avatar" aria-hidden>
                      {iniciais(r.cliente)}
                    </span>
                    <span className="pp-cliente-texto">
                      <strong>{r.cliente}</strong>
                      <small>{[r.cidade, `mexida em ${data(r.atualizadoEm)}`].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="pp-cliente-acao">Continuar →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Cartao>
        )}

        <Cartao titulo="Geradas" icone={<FileText size={16} />} contador={propostas.length}>
          {pagina.itens.length ? (
            <div className="tabela-wrap tabela-no-cartao" id="lista">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Nº</th>
                    <th>Sistema</th>
                    <th className="num">Valor</th>
                    <th>Situação</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.itens.map((p) => {
                    const d = p.dados as { sistema?: { kwp?: number }; financeiro?: { investimento?: number; economiaMes?: number }; validaAte?: string };
                    return (
                      <tr key={p.id}>
                        <td>
                          <span className="pp-cliente pp-cliente-linha">
                            <span className="pp-avatar pp-avatar-p" aria-hidden>
                              {iniciais(p.cliente)}
                            </span>
                            <span className="pp-cliente-texto">
                              <Link href={`/projeto/${p.projetoId}`}>
                                <strong>{p.cliente}</strong>
                              </Link>
                              <small>
                                {[p.cidade, `gerada em ${data(p.criadoEm)}`, d.validaAte ? `válida até ${d.validaAte.slice(0, 5)}` : null].filter(Boolean).join(" · ")}
                              </small>
                            </span>
                          </span>
                        </td>
                        <td>{p.numero}</td>
                        <td>
                          {d.sistema?.kwp ? kwpTexto(d.sistema.kwp) : "—"}
                          {d.financeiro?.economiaMes ? <small className="fraco"> · economia {moeda(d.financeiro.economiaMes)}/mês</small> : null}
                        </td>
                        <td className="num">{d.financeiro?.investimento ? moeda(d.financeiro.investimento) : "—"}</td>
                        <td>
                          {p.visualizacoes > 0 ? (
                            <span className="pp-estado pp-estado-aberta">
                              <Eye size={13} aria-hidden /> Aberta {p.visualizacoes}× {p.ultimaVisualizacaoEm ? `· ${data(p.ultimaVisualizacaoEm)}` : ""}
                            </span>
                          ) : p.enviadoEm ? (
                            <span className="pp-estado pp-estado-enviada">
                              <Send size={13} aria-hidden /> Enviada {data(p.enviadoEm)}
                            </span>
                          ) : (
                            <span className="pp-estado">Não enviada</span>
                          )}
                        </td>
                        <td className="pp-acoes">
                          <a href={`${origem}/r/p/${p.token}?v=equipe`} target="_blank" rel="noreferrer" className="link-acao">
                            PDF
                          </a>
                          <Link href={`/projeto/${p.projetoId}/proposta`} className="link-acao">
                            Refazer
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Paginacao {...pagina} rotulo="propostas" href={(n) => endereco("/propostas", { q: busca || undefined }, { pagina: n })} />
            </div>
          ) : (
            <Vazio icone={<FileText size={20} />} titulo={busca ? "Nenhuma proposta com esse nome" : "Nenhuma proposta ainda"}>
              Clique em Nova proposta e escolha o cliente.
            </Vazio>
          )}
        </Cartao>
      </div>
    </main>
  );
}
