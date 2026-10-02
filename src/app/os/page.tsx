import { CalendarDays, ClipboardList, MapPinned, Plus, Search } from "lucide-react";
import Link from "next/link";

import { exigirAtorWeb } from "@/os/acesso";
import { ABAS, contarPorStatus, ehAba, listarOs, responsaveisPossiveis, type OsDaLista } from "@/os/consultas";
import { formatarInstante, formatarRelogio, relogioAgora } from "@/os/relogio";
import { encerrada, numeroOs, PRIORIDADE_ROTULO, STATUS_ROTULO, TIPO_ROTULO, type TipoOs } from "@/os/tipos";

import { Cabecalho, Vazio } from "../_ui";

export const dynamic = "force-dynamic";

/** O que a coluna "Quando" diz, e se está vencido. */
function quando(o: OsDaLista, agora: Date): { texto: string; atrasado: boolean } {
  if (o.status === "concluida") return { texto: o.concluidaEm ? `concluída ${formatarInstante(o.concluidaEm).slice(0, 10)}` : "concluída", atrasado: false };
  if (o.status === "cancelada") return { texto: "cancelada", atrasado: false };
  if (o.agendadaPara) {
    const passou = o.agendadaPara < agora && !["em_andamento", "em_deslocamento"].includes(o.status);
    return { texto: formatarRelogio(o.agendadaPara), atrasado: passou };
  }
  if (o.prazoSla) return { texto: `prazo ${formatarRelogio(o.prazoSla, false)}`, atrasado: o.prazoSla < agora };
  return { texto: "sem data", atrasado: false };
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export default async function ListaOs({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; tipo?: string; tecnico?: string; q?: string; ok?: string; erro?: string }>;
}) {
  const ator = await exigirAtorWeb();
  const p = await searchParams;
  const aba = ehAba(p.aba) ? p.aba : "abertas";
  const tipo = p.tipo && p.tipo in TIPO_ROTULO ? (p.tipo as TipoOs) : undefined;

  const [ordens, contagem, pessoas] = await Promise.all([
    listarOs(ator, { aba, tipo, responsavelId: p.tecnico || undefined, busca: p.q }),
    contarPorStatus(ator),
    ator.gestao ? responsaveisPossiveis(ator.empresaId) : Promise.resolve([]),
  ]);
  const agora = relogioAgora();

  const quantos = (status: readonly string[] | null) =>
    status ? status.reduce((soma, s) => soma + (contagem[s] ?? 0), 0) : Object.values(contagem).reduce((a, b) => a + b, 0);

  const link = (mudanca: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const atual = { aba, tipo, tecnico: p.tecnico, q: p.q, ...mudanca };
    for (const [k, v] of Object.entries(atual)) if (v) q.set(k, v);
    return `/os?${q.toString()}`;
  };

  const filtrando = Boolean(p.q || tipo || p.tecnico);

  return (
    <main>
      <Cabecalho
        titulo="Ordens de serviço"
        meta={
          <>
            <span>{ator.gestao ? "Todas da empresa" : "As suas"}</span>
            <span>{quantos(ABAS.abertas.status)} em aberto</span>
          </>
        }
        acoes={
          <>
            <Link href="/os/agenda" className="botao secundario">
              <CalendarDays size={15} aria-hidden /> Agenda
            </Link>
            {ator.gestao && (
              <Link href="/os/acompanhamento" className="botao secundario">
                <MapPinned size={15} aria-hidden /> Em campo
              </Link>
            )}
            {ator.gestao && (
              <Link href="/os/nova" className="botao">
                <Plus size={15} aria-hidden /> Nova OS
              </Link>
            )}
          </>
        }
      />

      {p.ok && <p className="aviso ok">{p.ok}</p>}
      {p.erro && (
        <p className="aviso erro" role="alert">
          {p.erro}
        </p>
      )}

      <nav className="abas" aria-label="Situação">
        {Object.entries(ABAS).map(([chave, a]) => (
          <Link
            key={chave}
            href={link({ aba: chave })}
            className={`aba${chave === aba ? " ativa" : ""}`}
            aria-current={chave === aba ? "page" : undefined}
          >
            {a.rotulo}
            <span className="contagem">{quantos(a.status)}</span>
          </Link>
        ))}
      </nav>

      <form className="barra-filtros" method="get" action="/os">
        <input type="hidden" name="aba" value={aba} />
        <label className="campo-busca">
          <Search size={15} aria-hidden />
          <input type="search" name="q" defaultValue={p.q ?? ""} placeholder="Cliente, cidade, CPF ou nº da OS" aria-label="Buscar" />
        </label>
        <select name="tipo" defaultValue={tipo ?? ""} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {Object.entries(TIPO_ROTULO).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
        {ator.gestao && (
          <select name="tecnico" defaultValue={p.tecnico ?? ""} aria-label="Responsável">
            <option value="">Todos os responsáveis</option>
            <option value="ninguem">Sem responsável</option>
            {pessoas.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="botao secundario">
          Filtrar
        </button>
        {filtrando && (
          <Link href={`/os?aba=${aba}`} className="link-acao">
            Limpar filtros
          </Link>
        )}
      </form>

      {ordens.length === 0 ? (
        <div className="pagina-corpo">
          <Vazio
            icone={<ClipboardList size={20} />}
            titulo={
              filtrando
                ? "Nenhuma OS com esses filtros"
                : aba === "abertas"
                  ? "Nenhuma OS em aberto"
                  : `Nenhuma OS em “${ABAS[aba].rotulo}”`
            }
            acao={
              ator.gestao && aba === "abertas" && !filtrando ? (
                <Link href="/os/nova" className="botao">
                  <Plus size={15} aria-hidden /> Nova OS
                </Link>
              ) : filtrando ? (
                <Link href={`/os?aba=${aba}`} className="botao secundario">
                  Limpar filtros
                </Link>
              ) : null
            }
          >
            {ator.gestao && aba === "abertas" && !filtrando ? (
              <>
                Também dá para abrir pela tela do projeto ou a partir de um <Link href="/alertas">alerta de usina</Link>.
              </>
            ) : null}
          </Vazio>
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela tabela-os">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Situação</th>
                <th>Quando</th>
                <th>Responsável</th>
                <th>Checklist</th>
                <th>Venda</th>
              </tr>
            </thead>
            <tbody>
              {ordens.map((o) => {
                const q = quando(o, agora);
                const obrigatorios = o.checklist.filter((i) => i.obrigatorio);
                const feitos = obrigatorios.filter((i) => i.concluido).length;
                const vencida = q.atrasado && !encerrada(o.status);
                return (
                  <tr key={o.id}>
                    <td className="forte">
                      <Link href={`/os/${o.id}`} className="numero-os">
                        {numeroOs(o.numero)}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/os/${o.id}`} className="celula-dupla">
                        <strong>{o.cliente.nome}</strong>
                        <small>{o.cliente.cidade ?? "—"}</small>
                      </Link>
                    </td>
                    <td>
                      {TIPO_ROTULO[o.tipo] ?? o.tipo}
                      {(o.prioridade === "alta" || o.prioridade === "urgente") && (
                        <>
                          {" "}
                          <span className={`pilula pr-${o.prioridade}`}>{PRIORIDADE_ROTULO[o.prioridade]}</span>
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`pilula st-${o.status}`}>{STATUS_ROTULO[o.status] ?? o.status}</span>
                    </td>
                    <td className={vencida ? "ruim" : ""}>
                      {q.texto}
                      {vencida ? " · atrasada" : ""}
                    </td>
                    <td>
                      {o.responsavel ? (
                        <span className="meta-pessoa">
                          <span className="avatar-mini" aria-hidden>
                            {iniciais(o.responsavel.nome)}
                          </span>
                          {o.responsavel.nome}
                        </span>
                      ) : (
                        <span className="texto-perigo">sem responsável</span>
                      )}
                    </td>
                    <td>
                      {obrigatorios.length ? (
                        <span className="mini-progresso" title={`${feitos} de ${obrigatorios.length} obrigatórios`}>
                          <span className="progresso">
                            <span style={{ width: `${Math.round((feitos / obrigatorios.length) * 100)}%` }} />
                          </span>
                          <small>
                            {feitos}/{obrigatorios.length}
                          </small>
                        </span>
                      ) : (
                        <span className="fraco">—</span>
                      )}
                    </td>
                    <td className={o.projeto ? "" : "fraco"}>
                      {o.projeto ? <Link href={`/projeto/${o.projeto.id}`}>{o.projeto.titulo}</Link> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
