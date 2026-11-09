import { and, asc, count, desc, eq, ne, sum } from "drizzle-orm";
import {
  AlarmClock,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Hourglass,
  Info,
  PlugZap,
  Sun,
  UserX,
} from "lucide-react";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { geracaoDoParque, type GeracaoDoParque } from "@/geracao/parque";
import { atorDaWeb } from "@/os/acesso";
import { listarOs, type OsDaLista } from "@/os/consultas";
import { formatarRelogio, relogioAgora } from "@/os/relogio";
import { numeroOs, STATUS_ROTULO, TIPO_ROTULO } from "@/os/tipos";

import { GraficoGeracao } from "./_inicio/grafico-geracao";
import { Vazio } from "./_ui";
import { energia, energiaTexto, iniciais, kWp } from "./formatar";

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

  const [ordens, etapas, projetos, alertas, [usinas], geracao] = await Promise.all([
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
    geracaoDoParque(usuario.empresaId),
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
        <SeloColeta ultima={geracao.ultimaColeta} />
      </header>

      <Geracao g={geracao} />

      <section className="indicadores" aria-label="Resumo">
        {temOs && (
          <>
            <Indicador
              href="/os"
              valor={ordens.length}
              rotulo="OS em aberto"
              detalhe={`${hoje.length} para hoje`}
            />
            <Indicador
              href="/os"
              valor={atrasadas.length}
              rotulo="OS atrasadas"
              detalhe={semResponsavel.length ? `${semResponsavel.length} sem responsável` : "todas com responsável"}
              tom={atrasadas.length ? "perigo" : undefined}
            />
            <Indicador
              href="/os/acompanhamento"
              valor={emCampo.length}
              rotulo="Em campo agora"
              detalhe="a caminho ou atendendo"
              tom={emCampo.length ? "ok" : undefined}
            />
          </>
        )}
        <Indicador
          href="/esteira"
          valor={projetos.length}
          rotulo="Projetos em aberto"
          detalhe={`${parados.length} parados há ${DIAS_PARADO}+ dias`}
          tom={parados.length ? "atencao" : undefined}
        />
        <Indicador
          href="/alertas"
          valor={usinasComAlerta.size}
          rotulo="Usinas com alerta"
          detalhe={criticos ? `${criticos} alertas críticos` : "nenhum crítico"}
          tom={criticos ? "perigo" : usinasComAlerta.size ? "atencao" : undefined}
        />
        <Indicador
          href="/usinas"
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
                  // Por que está aqui: atrasada pesa mais que sem dono, que pesa mais que só "na agenda".
                  const motivo = vencida ? "atrasada" : !o.responsavelId ? "sem-dono" : "agenda";
                  const Icone = { atrasada: AlarmClock, "sem-dono": UserX, agenda: CalendarDays }[motivo];
                  return (
                    <li key={o.id}>
                      <a href={`/os/${o.id}`} className="linha-os">
                        <span className={`linha-icone m-${motivo}`} title={{ atrasada: "Atrasada", "sem-dono": "Sem responsável", agenda: "Na agenda" }[motivo]}>
                          <Icone size={15} aria-hidden />
                        </span>
                        <span className="linha-os-corpo">
                          <strong>{o.cliente?.nome ?? "Sem cliente"}</strong>
                          <small>
                            {numeroOs(o.numero)} · {TIPO_ROTULO[o.tipo] ?? o.tipo}
                            {o.cliente?.cidade ? ` · ${o.cliente.cidade}` : ""}
                          </small>
                        </span>
                        {o.responsavel ? (
                          <span className="avatar-mini" title={o.responsavel.nome}>
                            {iniciais(o.responsavel.nome)}
                          </span>
                        ) : (
                          <span className="avatar-mini sem-dono" title="Sem responsável">
                            ?
                          </span>
                        )}
                        <span className="linha-os-status">
                          <span className={`pilula st-${o.status}`}>{STATUS_ROTULO[o.status] ?? o.status}</span>
                        </span>
                        <span className={`linha-quando${vencida ? " atrasada" : ""}`}>
                          {o.agendadaPara
                            ? formatarRelogio(o.agendadaPara, false).replace(" às ", " · ")
                            : o.prazoSla
                              ? `até ${formatarRelogio(o.prazoSla, false).split(" às ")[0]}`
                              : "sem data"}
                          {vencida && <span className="sr-only"> (atrasada)</span>}
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
                    <span className={`linha-icone s-${a.severidade}`} title={{ critico: "Crítico", atencao: "Atenção", info: "Aviso" }[a.severidade]}>
                      {a.severidade === "critico" ? (
                        <AlertOctagon size={15} aria-hidden />
                      ) : a.severidade === "atencao" ? (
                        <AlertTriangle size={15} aria-hidden />
                      ) : (
                        <Info size={15} aria-hidden />
                      )}
                    </span>
                    <span className="linha-os-corpo">
                      <strong>{a.usina?.nome ?? "Usina"}</strong>
                      <small>
                        {TIPO_ALERTA[a.tipo] ?? a.tipo}
                        {a.usina?.cidade ? ` · ${a.usina.cidade}` : ""}
                      </small>
                    </span>
                    <span className="linha-quando">
                      {diasDesde(a.abertoEm) === 0 ? "hoje" : `há ${diasDesde(a.abertoEm)} d`}
                    </span>
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
                    <span className="linha-icone m-parado" aria-hidden>
                      <Hourglass size={15} />
                    </span>
                    <span className="linha-os-corpo">
                      <strong>{p.cliente?.nome ?? p.titulo}</strong>
                      <small>
                        {etapas.find((e) => e.id === p.etapaId)?.nome ?? "—"}
                        {p.cliente?.cidade ? ` · ${p.cliente.cidade}` : ""}
                      </small>
                    </span>
                    <span className="linha-quando parado">{diasDesde(p.etapaDesde)} dias</span>
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
  valor,
  rotulo,
  detalhe,
  tom,
}: {
  href: string;
  valor: number;
  rotulo: string;
  detalhe: string;
  tom?: "perigo" | "atencao" | "ok";
}) {
  return (
    <a href={href} className={`indicador${tom ? ` tom-${tom}` : ""}`}>
      <span className="indicador-rotulo">{rotulo}</span>
      <span className="indicador-valor">{valor.toLocaleString("pt-BR")}</span>
      <span className="indicador-detalhe">{detalhe}</span>
    </a>
  );
}

const DIA_CURTO = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const UMA_CASA = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * O pulso do parque: quanto as usinas geraram nos últimos 30 dias, dia a dia.
 * É o dado que a empresa vende, e o Início é o lugar de vê-lo antes de tudo.
 */
function Geracao({ g }: { g: GeracaoDoParque }) {
  if (!g.dias.some((d) => d.kwh !== null)) {
    return (
      <section className="geracao geracao-vazia" aria-label="Geração do parque">
        <Vazio
          icone={<PlugZap size={20} />}
          titulo={g.usinas ? "Ainda sem leituras de geração" : "Nenhuma usina no parque ainda"}
          acao={
            <a className="botao" href={g.usinas ? "/coleta" : "/cadastro"}>
              {g.usinas ? "Ver a coleta" : "Cadastrar usina"}
            </a>
          }
        >
          {g.usinas
            ? "Assim que os portais mandarem as primeiras leituras, a geração dos últimos 30 dias aparece aqui."
            : "Cadastre uma usina e ligue o portal do fabricante para acompanhar a geração aqui."}
        </Vazio>
      </section>
    );
  }

  const total = energia(g.total);
  const melhor = g.melhorDia?.kwh ? g.melhorDia : null;
  return (
    <section className="geracao" aria-labelledby="geracao-titulo">
      <header className="geracao-topo">
        <h2 id="geracao-titulo">
          <Sun size={16} aria-hidden /> Geração do parque
        </h2>
        <a href="/usinas" className="link-acao">
          Ver usinas <ArrowRight size={14} aria-hidden />
        </a>
      </header>

      <div className="geracao-numeros">
        <p className="geracao-total">
          <span className="geracao-valor">
            {total.numero}
            <small>{total.unidade}</small>
          </span>
          <span className="geracao-rotulo">
            nos últimos {g.dias.length} dias · {g.usinas} {g.usinas === 1 ? "usina" : "usinas"}
          </span>
        </p>
        <dl className="geracao-dados">
          <div>
            <dt>Hoje até agora</dt>
            <dd>{g.hoje === null ? "—" : energiaTexto(g.hoje)}</dd>
          </div>
          <div>
            <dt>Média por dia</dt>
            <dd>{g.mediaDia === null ? "—" : energiaTexto(g.mediaDia)}</dd>
          </div>
          <div>
            <dt>Melhor dia</dt>
            <dd>
              {melhor ? (
                <>
                  {energiaTexto(melhor.kwh!)} <small>{DIA_CURTO.format(new Date(`${melhor.dia}T12:00:00Z`))}</small>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt title="Quanto cada kWp instalado gerou por dia, em média, nos dias com leitura">Rendimento</dt>
            <dd>
              {g.rendimento === null ? (
                "—"
              ) : (
                <>
                  {UMA_CASA.format(g.rendimento)} <small>kWh/kWp·dia</small>
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <GraficoGeracao dias={g.dias} media={g.mediaDia} />
    </section>
  );
}

/**
 * Está coletando? A resposta curta da tela Coleta, no canto do Início.
 * Atrasada é passar de duas horas (duas vezes a cadência mais longa, a da
 * Growatt) e parada, de seis, como lá. À noite ninguém consulta portal
 * (`src/atualizar.ts`), então o silêncio é esperado e o selo fica neutro.
 */
function SeloColeta({ ultima }: { ultima: Date | null }) {
  const hora = relogioAgora().getUTCHours();
  const noite = hora < 6 || hora >= 20;
  if (!ultima) {
    return (
      <a href="/coleta" className="selo-coleta parada">
        <span aria-hidden /> Nenhuma coleta ainda
      </a>
    );
  }
  const minutos = Math.max(0, Math.round((Date.now() - ultima.getTime()) / 60_000));
  const ha =
    minutos < 1 ? "agora" : minutos < 60 ? `há ${minutos} min` : minutos < 48 * 60 ? `há ${Math.round(minutos / 60)} h` : `há ${Math.round(minutos / 1440)} dias`;
  const estado = minutos <= 120 ? "ok" : noite ? "noite" : minutos <= 360 ? "atrasada" : "parada";
  const texto = { ok: "Coletando", noite: "Coleta pausada à noite", atrasada: "Coleta atrasada", parada: "Coleta parada" }[estado];
  return (
    <a
      href="/coleta"
      className={`selo-coleta ${estado}`}
      title={`Última coleta: ${ultima.toLocaleString("pt-BR", { timeZone: "America/Maceio" })}`}
    >
      <span aria-hidden /> {texto} · {ha}
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
