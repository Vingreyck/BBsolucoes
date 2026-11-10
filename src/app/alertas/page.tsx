import { and, desc, eq, ne, sql } from "drizzle-orm";
import { BellOff, Repeat, Sun } from "lucide-react";
import Link from "next/link";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { alerta as alertaTable } from "@/db/schema";

import { Cabecalho, Vazio } from "../_ui";
import { endereco, paginar, Paginacao } from "../_ui/paginacao";
import { kWp } from "../formatar";
import { abrirOsDoGrupo, reconhecerAlertas, resolverAlertas } from "./actions";

export const dynamic = "force-dynamic";

const SEVERIDADE_ROTULO: Record<string, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  info: "Informativo",
};

const TIPO_ROTULO: Record<string, string> = {
  offline: "Sem geração",
  sem_comunicacao: "Sem comunicação",
  geracao_baixa: "Geração abaixo do esperado",
  alarme_inversor: "Alarme do inversor",
};

/** Crítico primeiro: é o que decide o que a equipe olha antes. */
const PESO: Record<string, number> = { critico: 0, atencao: 1, info: 2 };

function diasAtras(data: Date): number {
  return Math.floor((Date.now() - data.getTime()) / 86_400_000);
}

function quando(d: Date): string {
  const dias = diasAtras(d);
  return dias === 0 ? "hoje" : dias === 1 ? "ontem" : `há ${dias} dias`;
}

/** Os ids viajam no formulário como campos repetidos: a ação vale para o grupo. */
function Ids({ lista }: { lista: string[] }) {
  return (
    <>
      {lista.map((id) => (
        <input key={id} type="hidden" name="alertaId" value={id} />
      ))}
    </>
  );
}

/** Usinas por página: cada uma é um cartão com as suas ocorrências, então menos que numa tabela. */
const USINAS_POR_PAGINA = 12;

export default async function Alertas({ searchParams }: { searchParams: Promise<{ sev?: string; pagina?: string }> }) {
  const usuario = await exigirUsuario();
  const { sev: sevPedida = "", pagina: paginaPedida } = await searchParams;
  const sev = sevPedida in PESO ? sevPedida : "";

  const abertos = await db.query.alerta.findMany({
    where: and(
      eq(alertaTable.empresaId, usuario.empresaId),
      ne(alertaTable.status, "resolvido"),
      // usina arquivada no recomeço não aparece aqui
      sql`${alertaTable.usinaId} in (select id from usina where arquivada_em is null)`,
    ),
    with: { usina: { with: { cliente: true } } },
    orderBy: desc(alertaTable.abertoEm),
  });

  const criticos = abertos.filter((a) => a.severidade === "critico").length;

  // Agrupa por usina: cinco dias parados na mesma usina é um problema, não cinco.
  const porUsina = new Map<string, typeof abertos>();
  for (const a of abertos) {
    const lista = porUsina.get(a.usinaId) ?? [];
    lista.push(a);
    porUsina.set(a.usinaId, lista);
  }

  const grupos = [...porUsina.values()].sort((a, b) => {
    const pa = Math.min(...a.map((x) => PESO[x.severidade]));
    const pb = Math.min(...b.map((x) => PESO[x.severidade]));
    return pa - pb || b.length - a.length;
  });

  // A pior ocorrência decide a cor do cartão e o filtro em que a usina aparece.
  const piorDe = (g: (typeof grupos)[number]) => g.reduce((p, a) => (PESO[a.severidade] < PESO[p.severidade] ? a : p)).severidade;
  const contagem = { critico: 0, atencao: 0, info: 0 } as Record<string, number>;
  for (const g of grupos) contagem[piorDe(g)]++;
  const doFiltro = sev ? grupos.filter((g) => piorDe(g) === sev) : grupos;
  const pagina = paginar(doFiltro, paginaPedida, USINAS_POR_PAGINA);

  return (
    <main>
      <Cabecalho
        titulo="Alertas"
        selos={
          criticos > 0 ? <span className="pilula sev-critico">{criticos} críticos</span> : undefined
        }
        meta={
          abertos.length === 0 ? (
            "nenhum aberto"
          ) : (
            <>
              <span>
                {grupos.length} {grupos.length === 1 ? "usina" : "usinas"} com problema
              </span>
              <span>
                {abertos.length} {abertos.length === 1 ? "ocorrência aberta" : "ocorrências abertas"}
              </span>
            </>
          )
        }
      />

      {abertos.length === 0 ? (
        <div className="pagina-corpo">
          <Vazio icone={<BellOff size={20} />} titulo="Nenhum alerta aberto">
            A detecção roda todo dia: quando uma usina para ou gera abaixo do normal, o alerta aparece aqui.
          </Vazio>
        </div>
      ) : (
        <div className="pagina-corpo pilha lista-alertas" id="lista">
          <nav className="filtros" aria-label="Gravidade">
            {[
              ["", "Todas", grupos.length],
              ["critico", "Críticas", contagem.critico],
              ["atencao", "Atenção", contagem.atencao],
              ["info", "Informativas", contagem.info],
            ].map(([valor, rotulo, n]) => (
              <Link
                key={valor}
                href={endereco("/alertas", {}, { sev: valor as string })}
                className={`filtro${sev === valor ? " ativo" : ""}${valor === "critico" ? " perigo" : ""}`}
                aria-current={sev === valor ? "page" : undefined}
              >
                {rotulo} <span className="filtro-n">{n}</span>
              </Link>
            ))}
          </nav>

          {doFiltro.length === 0 && <Vazio icone={<BellOff size={20} />} titulo="Nenhuma usina com alerta dessa gravidade" />}

          {pagina.itens.map((grupo) => {
            const primeiro = grupo[0];
            const pior = grupo.reduce((p, a) => (PESO[a.severidade] < PESO[p.severidade] ? a : p));

            /**
             * Dentro da usina, junta o que é a mesma falha: o detector abre um
             * alerta a cada rodada enquanto a usina segue parada, com o mesmo texto.
             */
            const porFalha = new Map<string, typeof grupo>();
            for (const a of grupo) {
              const chave = `${a.tipo}|${a.codigoFabricante ?? ""}|${a.mensagem}`;
              const lista = porFalha.get(chave) ?? [];
              lista.push(a);
              porFalha.set(chave, lista);
            }

            return (
              <section className={`grupo s-${pior.severidade}`} key={primeiro.usinaId}>
                <header className="grupo-topo">
                  <span className={`grupo-icone s-${pior.severidade}`} aria-hidden>
                    <Sun size={18} />
                  </span>
                  <div className="grupo-quem">
                    <h2>{primeiro.usina.cliente?.nome ?? "Usina sem dono"}</h2>
                    <p className="usina">
                      <Link href={`/usinas?busca=${encodeURIComponent(primeiro.usina.nome)}`}>{primeiro.usina.nome}</Link>
                      {primeiro.usina.cidade ? ` · ${primeiro.usina.cidade}` : ""}
                      {kWp(primeiro.usina.potenciaKwp) ? ` · ${kWp(primeiro.usina.potenciaKwp)}` : ""}
                    </p>
                  </div>
                  <span className={`pilula sev-${pior.severidade}`}>{SEVERIDADE_ROTULO[pior.severidade]}</span>
                </header>

                <ul className="ocorrencias">
                  {[...porFalha.values()].map((falha) => {
                    // A lista já vem do mais recente para o mais antigo.
                    const recente = falha[0];
                    const antiga = falha[falha.length - 1];
                    const lista = falha.map((a) => a.id);
                    const osId = falha.find((a) => a.ordemServicoId)?.ordemServicoId;
                    const todosReconhecidos = falha.every((a) => a.status === "reconhecido");
                    return (
                      <li key={recente.id}>
                        <div className="oc-texto">
                          <span className="oc-tipo">
                            {TIPO_ROTULO[recente.tipo] ?? recente.tipo}
                            {recente.codigoFabricante ? ` · código ${recente.codigoFabricante}` : ""}
                          </span>
                          <span className="oc-msg">{recente.mensagem}</span>
                          <span className="oc-quando">
                            {falha.length > 1 ? (
                              <span className="oc-repete">
                                <Repeat size={12} aria-hidden /> repetiu {falha.length} vezes
                              </span>
                            ) : null}
                            {falha.length > 1
                              ? `desde ${antiga.abertoEm.toLocaleDateString("pt-BR")} · último ${quando(recente.abertoEm)}`
                              : `${recente.abertoEm.toLocaleDateString("pt-BR")} · ${quando(recente.abertoEm)}`}
                            {todosReconhecidos ? " · reconhecido" : ""}
                          </span>
                        </div>
                        <div className="oc-acoes">
                          {osId ? (
                            <Link className="botao secundario" href={`/os/${osId}`}>
                              Ver OS
                            </Link>
                          ) : (
                            <form action={abrirOsDoGrupo}>
                              <Ids lista={lista} />
                              <button type="submit" className="botao">
                                Abrir OS
                              </button>
                            </form>
                          )}
                          {!todosReconhecidos && (
                            <form action={reconhecerAlertas}>
                              <Ids lista={lista} />
                              <button type="submit" className="botao secundario">
                                Reconhecer
                              </button>
                            </form>
                          )}
                          <form action={resolverAlertas}>
                            <Ids lista={lista} />
                            <button type="submit" className="botao secundario">
                              Resolver
                            </button>
                          </form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <Paginacao
            {...pagina}
            rotulo="usinas com alerta"
            href={(n) => endereco("/alertas", { sev }, { pagina: n })}
          />
        </div>
      )}
    </main>
  );
}
