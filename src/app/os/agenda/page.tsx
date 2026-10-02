import { CalendarCheck, CalendarClock, ChevronLeft, ChevronRight, List } from "lucide-react";
import Link from "next/link";

import { exigirAtorWeb } from "@/os/acesso";
import { agendaDaSemana } from "@/os/consultas";
import { formatarRelogio, inicioDaSemana, relogioAgora, relogioDoCampo } from "@/os/relogio";
import { numeroOs, PRIORIDADE_ROTULO, STATUS_ROTULO, TIPO_ROTULO } from "@/os/tipos";

import { Cabecalho, Vazio } from "../../_ui";

export const dynamic = "force-dynamic";

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function dm(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function hora(d: Date | null): string {
  return d ? `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : "";
}

/**
 * A agenda da semana, por pessoa — o quadro do agendamento do IXC.
 *
 * À esquerda, a fila do que ainda não tem data, por prioridade e prazo; à
 * direita, a semana, uma linha por responsável. Agendar é abrir a OS e escolher
 * o dia — arrastar e soltar fica para quando fizer falta.
 */
export default async function Agenda({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const ator = await exigirAtorWeb();
  const { semana } = await searchParams;
  const hoje = relogioAgora();
  const segunda = inicioDaSemana(relogioDoCampo(semana ? `${semana}T12:00` : null) ?? hoje);
  const dias = Array.from({ length: 7 }, (_, i) => new Date(segunda.getTime() + i * 86_400_000));
  const { marcadas, aAgendar, pessoas } = await agendaDaSemana(ator, segunda);

  // Linhas: quem tem OS na semana, mais os técnicos (mesmo sem nada marcado —
  // a linha vazia mostra quem está livre), mais "sem responsável".
  const linhas = new Map<string, string>();
  for (const p of pessoas) if (p.papel === "tecnico") linhas.set(p.id, p.nome);
  for (const o of marcadas) if (o.responsavel) linhas.set(o.responsavel.id, o.responsavel.nome);
  if (!ator.gestao) linhas.set(ator.id, ator.nome);
  const ordenadas = [...linhas.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const semDono = marcadas.filter((o) => !o.responsavel);
  if (semDono.length) ordenadas.push(["", "Sem responsável"]);

  const doDia = (pessoa: string, dia: Date) =>
    marcadas.filter(
      (o) =>
        (o.responsavel?.id ?? "") === pessoa &&
        o.agendadaPara &&
        iso(o.agendadaPara) === iso(dia),
    );

  const anterior = iso(new Date(segunda.getTime() - 7 * 86_400_000));
  const proxima = iso(new Date(segunda.getTime() + 7 * 86_400_000));

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/os", rotulo: "Ordens de serviço" }]}
        titulo="Agenda"
        meta={
          <>
            <span>
              Semana de {dm(dias[0])} a {dm(dias[6])}
            </span>
            <span>
              {marcadas.length} {marcadas.length === 1 ? "OS marcada" : "OS marcadas"}
            </span>
          </>
        }
        acoes={
          <>
            <span className="grupo-segmentado" role="group" aria-label="Trocar de semana">
              <Link href={`/os/agenda?semana=${anterior}`} title="Semana anterior" aria-label="Semana anterior">
                <ChevronLeft size={16} aria-hidden />
              </Link>
              <Link href="/os/agenda">Hoje</Link>
              <Link href={`/os/agenda?semana=${proxima}`} title="Próxima semana" aria-label="Próxima semana">
                <ChevronRight size={16} aria-hidden />
              </Link>
            </span>
            <Link href="/os" className="botao secundario">
              <List size={15} aria-hidden /> Lista
            </Link>
          </>
        }
      />

      <div className="agenda">
        <aside className="fila-agendar">
          <h2>
            <CalendarClock size={16} aria-hidden /> A agendar <span className="contador-cinza">{aAgendar.length}</span>
          </h2>
          {aAgendar.length === 0 ? (
            <Vazio icone={<CalendarCheck size={20} />} titulo="Nada esperando data">
              Toda OS aberta já tem dia marcado.
            </Vazio>
          ) : (
            <ul>
              {aAgendar.map((o) => (
                <li key={o.id}>
                  <Link href={`/os/${o.id}`} className={`cartao-os pr-${o.prioridade}`}>
                    <span className="linha1">
                      <strong>{numeroOs(o.numero)}</strong> {TIPO_ROTULO[o.tipo] ?? o.tipo}
                      {o.prioridade === "urgente" || o.prioridade === "alta" ? (
                        <span className={`pilula pr-${o.prioridade}`}>{PRIORIDADE_ROTULO[o.prioridade]}</span>
                      ) : null}
                    </span>
                    <span className="linha2">{o.cliente.nome}</span>
                    <span className="linha3">
                      {o.cliente.cidade ?? ""}
                      {o.prazoSla ? ` · prazo ${formatarRelogio(o.prazoSla, false)}` : ""}
                      {o.responsavel ? ` · ${o.responsavel.nome.split(" ")[0]}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="grade-wrap">
          <table className="grade-semana">
            <thead>
              <tr>
                <th className="pessoa">Responsável</th>
                {dias.map((d, i) => (
                  <th key={i} className={iso(d) === iso(hoje) ? "hoje" : ""}>
                    <span className="dia-semana">{DIAS[i]}</span>
                    <span className="dia-numero">{dm(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenadas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="vazio-grade">
                    Nenhum técnico cadastrado e nenhuma OS marcada nesta semana.
                  </td>
                </tr>
              ) : (
                ordenadas.map(([pessoa, nome]) => (
                  <tr key={pessoa || "ninguem"}>
                    <th className="pessoa">
                      <span className="meta-pessoa">
                        <span className="avatar-mini" aria-hidden>
                          {pessoa ? iniciais(nome) : "?"}
                        </span>
                        {nome}
                      </span>
                    </th>
                    {dias.map((d, i) => (
                      <td key={i} className={iso(d) === iso(hoje) ? "hoje" : ""}>
                        {doDia(pessoa, d).map((o) => (
                          <Link key={o.id} href={`/os/${o.id}`} className={`cartao-os st-${o.status} pr-${o.prioridade}`}>
                            <span className="linha1">
                              <strong>{hora(o.agendadaPara)}</strong> {numeroOs(o.numero)}
                            </span>
                            <span className="linha2">{o.cliente.nome}</span>
                            <span className="linha3">
                              {TIPO_ROTULO[o.tipo] ?? o.tipo}
                              {o.cliente.cidade ? ` · ${o.cliente.cidade}` : ""}
                              {o.status !== "agendada" ? ` · ${STATUS_ROTULO[o.status]?.toLowerCase()}` : ""}
                            </span>
                          </Link>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
