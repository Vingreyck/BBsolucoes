import { desc, ne } from "drizzle-orm";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { alerta as alertaTable } from "@/db/schema";

import { abrirOsDoAlerta } from "../os/actions";
import { kWp } from "../formatar";
import { reconhecerAlerta, resolverAlerta } from "./actions";

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

export default async function Alertas() {
  await exigirUsuario();

  const abertos = await db.query.alerta.findMany({
    where: ne(alertaTable.status, "resolvido"),
    with: { usina: { with: { cliente: true } } },
    orderBy: desc(alertaTable.abertoEm),
  });

  if (abertos.length === 0) {
    return (
      <main>
        <Cabecalho total={0} criticos={0} />
        <div className="vazio">
          <p>
            Nenhum alerta aberto. Se ainda não rodou a detecção, use{" "}
            <code>npm run detectar</code> — ela varre a série de geração e abre
            alerta para usina parada ou rendendo abaixo do normal.
          </p>
        </div>
      </main>
    );
  }

  // Agrupa por usina: cinco dias parados na mesma usina é um problema, não cinco.
  const porUsina = new Map<string, typeof abertos>();
  for (const a of abertos) {
    const lista = porUsina.get(a.usinaId) ?? [];
    lista.push(a);
    porUsina.set(a.usinaId, lista);
  }

  const grupos = [...porUsina.values()].sort((a, b) => {
    const severidade = PESO[a[0].severidade] - PESO[b[0].severidade];
    if (severidade !== 0) return severidade;
    return b.length - a.length;
  });

  const criticos = abertos.filter((a) => a.severidade === "critico").length;

  return (
    <main>
      <Cabecalho total={abertos.length} criticos={criticos} />

      <div className="lista-alertas">
        {grupos.map((grupo) => {
          const primeiro = grupo[0];
          const pior = grupo.reduce((p, a) =>
            PESO[a.severidade] < PESO[p.severidade] ? a : p,
          );
          return (
            <section className={`grupo s-${pior.severidade}`} key={primeiro.usinaId}>
              <header className="grupo-topo">
                <div>
                  <h2>{primeiro.usina.cliente.nome}</h2>
                  <p className="usina">
                    {primeiro.usina.nome}
                    {primeiro.usina.cidade ? ` · ${primeiro.usina.cidade}` : ""}
                    {kWp(primeiro.usina.potenciaKwp)
                      ? ` · ${kWp(primeiro.usina.potenciaKwp)}`
                      : ""}
                  </p>
                </div>
                <span className={`selo s-${pior.severidade}`}>
                  {SEVERIDADE_ROTULO[pior.severidade]}
                </span>
              </header>

              <ul className="ocorrencias">
                {grupo.map((a) => {
                  const dias = diasAtras(a.abertoEm);
                  return (
                    <li key={a.id}>
                      <div className="oc-texto">
                        <span className="oc-tipo">
                          {TIPO_ROTULO[a.tipo] ?? a.tipo}
                          {a.codigoFabricante ? ` · código ${a.codigoFabricante}` : ""}
                        </span>
                        <span className="oc-msg">{a.mensagem}</span>
                        <span className="oc-quando">
                          {a.abertoEm.toLocaleDateString("pt-BR")}
                          {dias > 0 ? ` · há ${dias} ${dias === 1 ? "dia" : "dias"}` : ""}
                          {a.status === "reconhecido" ? " · reconhecido" : ""}
                        </span>
                      </div>
                      <div className="oc-acoes">
                        {a.ordemServicoId ? (
                          <a className="botao-link" href={`/os/${a.ordemServicoId}`}>
                            Ver OS
                          </a>
                        ) : (
                          <form action={abrirOsDoAlerta.bind(null, a.id)}>
                            <button type="submit" className="primario">Abrir OS</button>
                          </form>
                        )}
                        {a.status !== "reconhecido" && (
                          <form action={reconhecerAlerta.bind(null, a.id)}>
                            <button type="submit">Reconhecer</button>
                          </form>
                        )}
                        <form action={resolverAlerta.bind(null, a.id)}>
                          <button type="submit">Resolver</button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function Cabecalho({ total, criticos }: { total: number; criticos: number }) {
  return (
    <header className="topo">
      <h1>Alertas</h1>
      <span className="sub">
        {total === 0
          ? "nenhum aberto"
          : `${total} ${total === 1 ? "aberto" : "abertos"}`}
      </span>
      {criticos > 0 && <span className="alerta">{criticos} crítico(s)</span>}
    </header>
  );
}
