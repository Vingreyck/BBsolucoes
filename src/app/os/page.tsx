import Link from "next/link";

import { exigirAtorWeb } from "@/os/acesso";
import { ABAS, contarPorStatus, ehAba, listarOs, responsaveisPossiveis, type OsDaLista } from "@/os/consultas";
import { formatarInstante, formatarRelogio, relogioAgora } from "@/os/relogio";
import { encerrada, numeroOs, PRIORIDADE_ROTULO, STATUS_ROTULO, TIPO_ROTULO, type TipoOs } from "@/os/tipos";

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

  return (
    <main>
      <header className="topo">
        <h1>Ordens de serviço</h1>
        <span className="sub">
          {ator.gestao ? "da empresa" : "suas"} · {quantos(ABAS.abertas.status)} em aberto
        </span>
        <span className="acao-topo acoes-topo">
          <Link href="/os/agenda" className="botao secundario">
            Agenda
          </Link>
          {ator.gestao && (
            <Link href="/os/acompanhamento" className="botao secundario">
              Em campo
            </Link>
          )}
          {ator.gestao && (
            <Link href="/os/nova" className="botao">
              Nova OS
            </Link>
          )}
        </span>
      </header>

      {p.ok && <p className="aviso ok">{p.ok}</p>}
      {p.erro && <p className="aviso erro" role="alert">{p.erro}</p>}

      <nav className="abas" aria-label="Situação">
        {Object.entries(ABAS).map(([chave, a]) => (
          <Link key={chave} href={link({ aba: chave })} className={`aba${chave === aba ? " ativa" : ""}`}>
            {a.rotulo}
            <span className="contagem">{quantos(a.status)}</span>
          </Link>
        ))}
      </nav>

      <form className="filtros-os" method="get" action="/os">
        <input type="hidden" name="aba" value={aba} />
        <input
          type="search"
          name="q"
          defaultValue={p.q ?? ""}
          placeholder="Cliente, cidade, CPF ou nº da OS"
          aria-label="Buscar"
        />
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
        {(p.q || tipo || p.tecnico) && (
          <Link href={`/os?aba=${aba}`} className="limpar">
            limpar filtros
          </Link>
        )}
      </form>

      {ordens.length === 0 ? (
        <div className="vazio">
          <p>
            {p.q || tipo || p.tecnico
              ? "Nenhuma OS com esses filtros."
              : aba === "abertas"
                ? "Nenhuma OS em aberto."
                : `Nenhuma OS em "${ABAS[aba].rotulo}".`}
            {ator.gestao && aba === "abertas" && !p.q && (
              <>
                {" "}
                Abra uma pelo botão <strong>Nova OS</strong>, pela tela do projeto ou a partir de um{" "}
                <Link href="/alertas">alerta</Link>.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th className="num">Nº</th>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Situação</th>
                <th>Prioridade</th>
                <th>Quando</th>
                <th>Responsável</th>
                <th className="num">Checklist</th>
                <th>Projeto</th>
              </tr>
            </thead>
            <tbody>
              {ordens.map((o) => {
                const q = quando(o, agora);
                const obrigatorios = o.checklist.filter((i) => i.obrigatorio);
                const feitos = obrigatorios.filter((i) => i.concluido).length;
                return (
                  <tr key={o.id}>
                    <td className="num forte">
                      <Link href={`/os/${o.id}`}>{numeroOs(o.numero)}</Link>
                    </td>
                    <td>
                      <Link href={`/os/${o.id}`} className="forte linha-cliente">
                        {o.cliente.nome}
                      </Link>
                      {o.cliente.cidade && <span className="fraco"> · {o.cliente.cidade}</span>}
                    </td>
                    <td>{TIPO_ROTULO[o.tipo] ?? o.tipo}</td>
                    <td>
                      <span className={`pilula st-${o.status}`}>{STATUS_ROTULO[o.status] ?? o.status}</span>
                    </td>
                    <td>
                      <span className={`pilula pr-${o.prioridade}`}>{PRIORIDADE_ROTULO[o.prioridade] ?? o.prioridade}</span>
                    </td>
                    <td className={q.atrasado && !encerrada(o.status) ? "ruim" : ""}>
                      {q.texto}
                      {q.atrasado && !encerrada(o.status) ? " · atrasada" : ""}
                    </td>
                    <td className={o.responsavel ? "" : "fraco"}>{o.responsavel?.nome ?? "sem responsável"}</td>
                    <td className="num">{obrigatorios.length ? `${feitos}/${obrigatorios.length}` : "—"}</td>
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
