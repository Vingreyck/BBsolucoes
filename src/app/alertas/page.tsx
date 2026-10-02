import { and, desc, eq, ne } from "drizzle-orm";
import { BellOff, Repeat, Sun } from "lucide-react";
import Link from "next/link";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { alerta as alertaTable } from "@/db/schema";

import { Cabecalho, Vazio } from "../_ui";
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

export default async function Alertas() {
  const usuario = await exigirUsuario();

  const abertos = await db.query.alerta.findMany({
    where: and(eq(alertaTable.empresaId, usuario.empresaId), ne(alertaTable.status, "resolvido")),
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
        <div className="lista-alertas">
          {grupos.map((grupo) => {
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
        </div>
      )}
    </main>
  );
}
