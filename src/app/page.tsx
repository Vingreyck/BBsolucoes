import { and, asc, count, desc, eq, ne, sum } from "drizzle-orm";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarClock,
  ClipboardList,
  KanbanSquare,
  MapPinned,
  Sun,
  UserX,
} from "lucide-react";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { atorDaWeb } from "@/os/acesso";
import { listarOs, type OsDaLista } from "@/os/consultas";
import { formatarRelogio, relogioAgora } from "@/os/relogio";
import { numeroOs, STATUS_ROTULO, TIPO_ROTULO } from "@/os/tipos";

import { kWp } from "./formatar";

/**
 * A primeira tela depois do login: o dia da empresa em um olhar.
 *
 * É o "Home" dos hubs — números grandes no topo, e embaixo só o que pede ação:
 * OS atrasadas ou sem dono, projeto parado, usina com alerta. Cada cartão leva
 * para a tela onde o problema se resolve; nada se edita daqui.
 */
export const dynamic = "force-dynamic";

/** O mesmo limite da esteira para dizer que um projeto parou. */
const DIAS_PARADO = 15;

const TIPO_ALERTA: Record<string, string> = {
  offline: "Sem geração",
  sem_comunicacao: "Sem comunicação",
  geracao_baixa: "Geração abaixo do esperado",
  alarme_inversor: "Alarme do inversor",
};

function saudacao(): string {
  const h = relogioAgora().getUTCHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function dataPorExtenso(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Maceio",
  }).format(new Date());
}

function diasDesde(data: Date): number {
  return Math.floor((Date.now() - data.getTime()) / 86_400_000);
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/** Atrasada: passou da hora marcada sem sair para o local, ou estourou o prazo. */
function atrasada(o: OsDaLista, agora: Date): boolean {
  if (o.agendadaPara) return o.agendadaPara < agora && !["em_andamento", "em_deslocamento"].includes(o.status);
  return !!o.prazoSla && o.prazoSla < agora;
}

export default async function Inicio() {
  const usuario = await exigirUsuario();
  const temOs = usuario.papel !== "estoque";
  const ator = atorDaWeb(usuario);
  const agora = relogioAgora();

  const [ordens, etapas, projetos, alertas, [usinas]] = await Promise.all([
    temOs ? listarOs(ator, { aba: "abertas" }) : Promise.resolve([] as OsDaLista[]),
    db.query.etapa.findMany({ where: eq(schema.etapa.empresaId, usuario.empresaId), orderBy: asc(schema.etapa.ordem) }),
    db.query.projeto.findMany({
      where: and(eq(schema.projeto.empresaId, usuario.empresaId), ne(schema.projeto.situacao, "concluido")),
      columns: { id: true, titulo: true, etapaId: true, etapaDesde: true, situacao: true },
      with: { cliente: { columns: { nome: true, cidade: true } } },
    }),
    db.query.alerta.findMany({
      where: and(eq(schema.alerta.empresaId, usuario.empresaId), ne(schema.alerta.status, "resolvido")),
      with: { usina: { columns: { id: true, nome: true, cidade: true } } },
      orderBy: desc(schema.alerta.abertoEm),
    }),
    db
      .select({ n: count(), potencia: sum(schema.usina.potenciaKwp) })
      .from(schema.usina)
      .where(eq(schema.usina.empresaId, usuario.empresaId)),
  ]);

  const atrasadas = ordens.filter((o) => atrasada(o, agora));
  const hoje = ordens.filter((o) => o.agendadaPara && mesmoDia(o.agendadaPara, agora));
  const emCampo = ordens.filter((o) => o.status === "em_deslocamento" || o.status === "em_andamento");
  const semResponsavel = ordens.filter((o) => !o.responsavelId);

  const emAndamento = projetos.filter((p) => p.situacao === "em_andamento");
  const parados = emAndamento
    .filter((p) => diasDesde(p.etapaDesde) >= DIAS_PARADO)
    .sort((a, b) => a.etapaDesde.getTime() - b.etapaDesde.getTime());

  const porEtapa = new Map<string, number>();
  for (const p of projetos) porEtapa.set(p.etapaId, (porEtapa.get(p.etapaId) ?? 0) + 1);
  const maiorEtapa = Math.max(1, ...porEtapa.values());

  const criticos = alertas.filter((a) => a.severidade === "critico").length;
  // Um card por usina: cinco dias parada na mesma usina é um problema, não cinco.
  const usinasComAlerta = new Map<string, (typeof alertas)[number]>();
  for (const a of alertas) if (!usinasComAlerta.has(a.usinaId)) usinasComAlerta.set(a.usinaId, a);

  // O que pede ação primeiro: atrasada, depois sem dono, depois o resto por urgência.
  const fila = [
    ...atrasadas,
    ...semResponsavel.filter((o) => !atrasadas.includes(o)),
    ...ordens.filter((o) => !atrasadas.includes(o) && o.responsavelId),
  ].slice(0, 6);

  const primeiroNome = usuario.nome.split(" ")[0];

  return (
    <main className="inicio">
      <header className="inicio-topo">
        <div>
          <h1>
            {saudacao()}, {primeiroNome}
          </h1>
          <p className="inicio-data">{dataPorExtenso()}</p>
        </div>
      </header>

      <section className="indicadores" aria-label="Resumo">
        {temOs && (
          <>
            <Indicador
              href="/os"
              icone={<ClipboardList size={18} />}
              valor={ordens.length}
              rotulo="OS em aberto"
              detalhe={`${hoje.length} para hoje`}
            />
            <Indicador
              href="/os"
              icone={<AlertTriangle size={18} />}
              valor={atrasadas.length}
              rotulo="OS atrasadas"
              detalhe={semResponsavel.length ? `${semResponsavel.length} sem responsável` : "todas com responsável"}
              tom={atrasadas.length ? "perigo" : undefined}
            />
            <Indicador
              href="/os/acompanhamento"
              icone={<MapPinned size={18} />}
              valor={emCampo.length}
              rotulo="Em campo agora"
              detalhe="a caminho ou atendendo"
              tom={emCampo.length ? "ok" : undefined}
            />
          </>
        )}
        <Indicador
          href="/esteira"
          icone={<KanbanSquare size={18} />}
          valor={projetos.length}
          rotulo="Projetos em aberto"
          detalhe={`${parados.length} parados há ${DIAS_PARADO}+ dias`}
          tom={parados.length ? "atencao" : undefined}
        />
        <Indicador
          href="/alertas"
          icone={<BellRing size={18} />}
          valor={usinasComAlerta.size}
          rotulo="Usinas com alerta"
          detalhe={criticos ? `${criticos} alertas críticos` : "nenhum crítico"}
          tom={criticos ? "perigo" : usinasComAlerta.size ? "atencao" : undefined}
        />
        <Indicador
          href="/usinas"
          icone={<Sun size={18} />}
          valor={Number(usinas?.n ?? 0)}
          rotulo="Usinas monitoradas"
          detalhe={kWp(usinas?.potencia) ?? "—"}
        />
      </section>

      <div className="inicio-grade">
        {temOs && (
          <Painel titulo="Ordens que pedem atenção" href="/os" link="Ver todas as OS">
            {fila.length === 0 ? (
              <p className="painel-vazio">Nenhuma OS em aberto.</p>
            ) : (
              <ul className="lista-limpa">
                {fila.map((o) => {
                  const vencida = atrasadas.includes(o);
                  return (
                    <li key={o.id}>
                      <a href={`/os/${o.id}`} className="linha-os">
                        <span className="linha-os-num">{numeroOs(o.numero)}</span>
                        <span className="linha-os-corpo">
                          <strong>{o.cliente?.nome ?? "Sem cliente"}</strong>
                          <small>
                            {TIPO_ROTULO[o.tipo] ?? o.tipo}
                            {o.cliente?.cidade ? ` · ${o.cliente.cidade}` : ""}
                            {" · "}
                            {o.responsavel?.nome ?? <span className="texto-perigo">sem responsável</span>}
                          </small>
                        </span>
                        <span className="linha-os-lado">
                          <span className={`pilula st-${o.status}`}>{STATUS_ROTULO[o.status] ?? o.status}</span>
                          <small className={vencida ? "texto-perigo" : ""}>
                            {o.agendadaPara ? formatarRelogio(o.agendadaPara, false) : o.prazoSla ? `prazo ${formatarRelogio(o.prazoSla, false)}` : "sem data"}
                            {vencida ? " · atrasada" : ""}
                          </small>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Painel>
        )}

        <Painel titulo="Usinas com alerta" href="/alertas" link="Ver alertas">
          {usinasComAlerta.size === 0 ? (
            <p className="painel-vazio">Nenhuma usina com alerta aberto.</p>
          ) : (
            <ul className="lista-limpa">
              {[...usinasComAlerta.values()].slice(0, 6).map((a) => (
                <li key={a.id}>
                  <a href="/alertas" className="linha-alerta">
                    <span className={`ponto sev-${a.severidade}`} aria-hidden />
                    <span className="linha-os-corpo">
                      <strong>{a.usina?.nome ?? "Usina"}</strong>
                      <small>
                        {TIPO_ALERTA[a.tipo] ?? a.tipo}
                        {a.usina?.cidade ? ` · ${a.usina.cidade}` : ""}
                      </small>
                    </span>
                    <small className="linha-alerta-dias">
                      {diasDesde(a.abertoEm) === 0 ? "hoje" : `há ${diasDesde(a.abertoEm)} d`}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Painel>

        <Painel titulo="Esteira de projetos" href="/esteira" link="Abrir esteira">
          <ul className="funil">
            {etapas
              .filter((e) => porEtapa.get(e.id))
              .map((e) => {
                const n = porEtapa.get(e.id) ?? 0;
                return (
                  <li key={e.id}>
                    <span className="funil-rotulo">{e.nome}</span>
                    <span className="funil-barra">
                      <span style={{ width: `${Math.max(4, (n / maiorEtapa) * 100)}%` }} />
                    </span>
                    <span className="funil-num">{n}</span>
                  </li>
                );
              })}
          </ul>
        </Painel>

        <Painel titulo="Projetos parados" href="/esteira" link="Ver na esteira">
          {parados.length === 0 ? (
            <p className="painel-vazio">Nenhum projeto parado há mais de {DIAS_PARADO} dias.</p>
          ) : (
            <ul className="lista-limpa">
              {parados.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <a href={`/projeto/${p.id}`} className="linha-alerta">
                    <span className="icone-redondo" aria-hidden>
                      <CalendarClock size={15} />
                    </span>
                    <span className="linha-os-corpo">
                      <strong>{p.cliente?.nome ?? p.titulo}</strong>
                      <small>
                        {etapas.find((e) => e.id === p.etapaId)?.nome ?? "—"}
                        {p.cliente?.cidade ? ` · ${p.cliente.cidade}` : ""}
                      </small>
                    </span>
                    <small className="linha-alerta-dias texto-atencao">{diasDesde(p.etapaDesde)} dias</small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Painel>
      </div>

      {temOs && semResponsavel.length > 0 && (
        <a href="/os" className="faixa-aviso">
          <UserX size={18} aria-hidden />
          <span>
            <strong>{semResponsavel.length} OS sem responsável.</strong> Ninguém vai atender até alguém ser
            escolhido.
          </span>
          <ArrowRight size={16} aria-hidden />
        </a>
      )}
    </main>
  );
}

function Indicador({
  href,
  icone,
  valor,
  rotulo,
  detalhe,
  tom,
}: {
  href: string;
  icone: React.ReactNode;
  valor: number;
  rotulo: string;
  detalhe: string;
  tom?: "perigo" | "atencao" | "ok";
}) {
  return (
    <a href={href} className={`indicador${tom ? ` tom-${tom}` : ""}`}>
      <span className="indicador-icone" aria-hidden>
        {icone}
      </span>
      <span className="indicador-valor">{valor.toLocaleString("pt-BR")}</span>
      <span className="indicador-rotulo">{rotulo}</span>
      <span className="indicador-detalhe">{detalhe}</span>
    </a>
  );
}

function Painel({
  titulo,
  href,
  link,
  children,
}: {
  titulo: string;
  href: string;
  link: string;
  children: React.ReactNode;
}) {
  return (
    <section className="painel">
      <header className="painel-topo">
        <h2>{titulo}</h2>
        <a href={href}>
          {link} <ArrowRight size={14} aria-hidden />
        </a>
      </header>
      {children}
    </section>
  );
}
