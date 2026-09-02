import { Fragment } from "react";

import { asc } from "drizzle-orm";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { etapa as etapaTable } from "@/db/schema";

import { moverProjeto } from "./actions";
import { kWp } from "./formatar";

/** Lê do banco a cada request — nada aqui é estático. */
export const dynamic = "force-dynamic";

const PAPEL_ROTULO: Record<string, string> = {
  adm: "ADM",
  vendedor: "Vendedor",
  engenheiro: "Engenheiro",
  tecnico: "Técnico",
  estoque: "Estoque",
};

/** Acima disto o cartão acende. Provisório: o número certo sai do histórico real. */
const DIAS_ATENCAO = 15;

function diasDesde(data: Date): number {
  return Math.floor((Date.now() - data.getTime()) / 86_400_000);
}

export default async function Esteira() {
  await exigirUsuario();

  const etapas = await db.query.etapa.findMany({
    orderBy: asc(etapaTable.ordem),
  });

  const projetos = await db.query.projeto.findMany({
    with: { cliente: true, responsavel: true },
  });

  if (etapas.length === 0) {
    return (
      <main>
        <header className="topo">
          <h1>Esteira de projetos</h1>
        </header>
        <div className="vazio">
          <p>
            Nenhuma etapa cadastrada ainda. Rode <code>npm run db:seed</code> para
            criar a empresa, as 12 etapas do fluxo e alguns projetos de exemplo.
          </p>
        </div>
      </main>
    );
  }

  const porEtapa = new Map<string, typeof projetos>();
  for (const p of projetos) {
    const lista = porEtapa.get(p.etapaId) ?? [];
    lista.push(p);
    porEtapa.set(p.etapaId, lista);
  }

  const parados = projetos.filter(
    (p) => diasDesde(p.etapaDesde) >= DIAS_ATENCAO && p.situacao === "em_andamento",
  );

  return (
    <main>
      <header className="topo">
        <h1>Esteira de projetos</h1>
        <span className="sub">
          {projetos.length} projetos em {etapas.length} etapas
        </span>
        {parados.length > 0 && (
          <span className="alerta">
            {parados.length} parados há {DIAS_ATENCAO} dias ou mais
          </span>
        )}
      </header>

      <p className="aviso">
        As 13 etapas do fluxo, confirmadas com o cliente. Os projetos são fictícios,
        só para a tela ter o que mostrar. A <strong>Execução</strong> é a etapa que
        mais gera retrabalho, e para onde o projeto volta quando a concessionária
        reprova — use a seta para trás.
      </p>

      <div className="esteira">
        {etapas.map((e) => {
          const lista = porEtapa.get(e.id) ?? [];
          return (
            <Fragment key={e.id}>
              <section className={lista.length ? "coluna" : "coluna vazia"}>
                <div className="coluna-topo">
                  <span className="ordem">
                    {String(Math.round(e.ordem / 10)).padStart(2, "0")}
                    {e.papelResponsavel
                      ? ` · ${PAPEL_ROTULO[e.papelResponsavel] ?? e.papelResponsavel}`
                      : ""}
                    {e.prazoPadraoDias ? ` · ${e.prazoPadraoDias}d` : ""}
                  </span>
                  <div className="linha">
                    <span className="nome">{e.nome}</span>
                    <span className="qtd">{lista.length}</span>
                  </div>
                  {e.descricao && <span className="desc">{e.descricao}</span>}
                </div>

                {lista.length > 0 && (
                  <div className="cartoes">
                    {lista.map((p) => {
                      const dias = diasDesde(p.etapaDesde);
                      const estourou =
                        p.prazoEtapa !== null && p.prazoEtapa.getTime() < Date.now();
                      const nivel = estourou
                        ? "critico"
                        : dias >= DIAS_ATENCAO
                          ? "atencao"
                          : "normal";
                      return (
                        <article className={`cartao n-${nivel}`} key={p.id}>
                          <span className="cliente">{p.cliente.nome}</span>
                          <span className="meta">
                            {kWp(p.potenciaKwp) ?? "—"}
                            {p.cliente.cidade ? ` · ${p.cliente.cidade}` : ""}
                          </span>
                          <span className={`dias d-${nivel}`}>
                            {dias === 0
                              ? "hoje"
                              : `${dias} ${dias === 1 ? "dia" : "dias"} nesta etapa`}
                            {estourou ? " · prazo estourado" : ""}
                          </span>
                          {p.responsavel && (
                            <span className="dono">{p.responsavel.nome}</span>
                          )}
                          <div className="mover">
                            <form action={moverProjeto.bind(null, p.id, "voltar")}>
                              <button
                                type="submit"
                                title="Voltar uma etapa"
                                aria-label={`Voltar ${p.cliente.nome} uma etapa`}
                              >
                                ←
                              </button>
                            </form>
                            <form action={moverProjeto.bind(null, p.id, "avancar")}>
                              <button
                                type="submit"
                                title="Avançar uma etapa"
                                aria-label={`Avançar ${p.cliente.nome} uma etapa`}
                              >
                                →
                              </button>
                            </form>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </Fragment>
          );
        })}
      </div>
    </main>
  );
}
