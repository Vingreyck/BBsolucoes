import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import { ordemServico as osTable } from "@/db/schema";

import { kWp } from "../../formatar";
import { concluirOs, iniciarOs, marcarItem } from "../actions";
import { PRIORIDADE_ROTULO, STATUS_ROTULO, TIPO_ROTULO } from "../page";

export const dynamic = "force-dynamic";

export default async function DetalheOs({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  await exigirUsuario();
  const { id } = await params;
  const { erro } = await searchParams;

  const os = await db.query.ordemServico.findFirst({
    where: eq(osTable.id, id),
    with: {
      cliente: true,
      usina: true,
      responsavel: true,
      checklist: true,
      alertas: true,
    },
  });

  if (!os) notFound();

  const itens = [...os.checklist].sort((a, b) => a.ordem - b.ordem);
  const pendentesObrigatorios = itens.filter((i) => i.obrigatorio && !i.concluido);
  const encerrada = os.status === "concluida" || os.status === "cancelada";

  return (
    <main>
      <header className="topo">
        <h1>OS #{os.numero}</h1>
        <span className={`pilula st-${os.status}`}>
          {STATUS_ROTULO[os.status] ?? os.status}
        </span>
        <span className={`pilula pr-${os.prioridade}`}>
          {PRIORIDADE_ROTULO[os.prioridade] ?? os.prioridade}
        </span>
        <span className="sub">{TIPO_ROTULO[os.tipo] ?? os.tipo}</span>
      </header>

      <div className="os-detalhe">
        <section className="bloco">
          <h2>Atendimento</h2>
          <dl className="campos">
            <div>
              <dt>Cliente</dt>
              <dd>{os.cliente.nome}</dd>
            </div>
            <div>
              <dt>Usina</dt>
              <dd>
                {os.usina?.nome ?? "—"}
                {os.usina?.cidade ? ` · ${os.usina.cidade}` : ""}
                {kWp(os.usina?.potenciaKwp) ? ` · ${kWp(os.usina?.potenciaKwp)}` : ""}
              </dd>
            </div>
            <div>
              <dt>Responsável</dt>
              <dd className={os.responsavel ? "" : "fraco"}>
                {os.responsavel?.nome ?? "ninguém atribuído"}
              </dd>
            </div>
            <div>
              <dt>Origem</dt>
              <dd>
                {os.origem === "alerta"
                  ? "Aberta automaticamente a partir de um alerta"
                  : os.origem === "cliente"
                    ? "Solicitação do cliente"
                    : "Aberta manualmente"}
              </dd>
            </div>
          </dl>
          <p className="descricao">{os.descricao}</p>
        </section>

        <section className="bloco">
          <h2>
            Checklist
            <span className="contador">
              {itens.filter((i) => i.concluido).length}/{itens.length}
            </span>
          </h2>
          <p className="nota">
            Os itens obrigatórios travam a conclusão — é o que garante que foto e
            código de erro voltem do campo. A lista definitiva ainda depende da
            resposta do cliente sobre o que ele exige de um atendimento.
          </p>
          <ul className="checklist">
            {itens.map((item) => (
              <li key={item.id} className={item.concluido ? "feito" : ""}>
                <form action={marcarItem.bind(null, item.id, !item.concluido)}>
                  <button
                    type="submit"
                    className="caixa"
                    disabled={encerrada}
                    aria-label={
                      item.concluido
                        ? `Desmarcar: ${item.descricao}`
                        : `Marcar: ${item.descricao}`
                    }
                  >
                    {item.concluido ? "✓" : ""}
                  </button>
                </form>
                <span className="item-texto">
                  {item.descricao}
                  {item.obrigatorio && <span className="obrigatorio">obrigatório</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {os.alertas.length > 0 && (
          <section className="bloco">
            <h2>Alertas ligados</h2>
            <ul className="alertas-ligados">
              {os.alertas.map((a) => (
                <li key={a.id}>
                  <span className={`pilula sev-${a.severidade}`}>{a.severidade}</span>
                  {a.mensagem}
                  <span className="fraco">
                    {" "}
                    · {a.abertoEm.toLocaleDateString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="nota">
              Concluir esta OS resolve {os.alertas.length === 1 ? "este alerta" : "estes alertas"} junto.
            </p>
          </section>
        )}

        {erro && (
          <p className="erro-os" role="alert">
            {erro}
          </p>
        )}

        {!encerrada && (
          <div className="os-acoes">
            {os.status === "aberta" && (
              <form action={iniciarOs.bind(null, os.id)}>
                <button type="submit">Iniciar atendimento</button>
              </form>
            )}
            <form action={concluir.bind(null, os.id)}>
              <button
                type="submit"
                className="primario"
                title={
                  pendentesObrigatorios.length
                    ? "Há itens obrigatórios pendentes"
                    : undefined
                }
              >
                Concluir OS
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Envolve `concluirOs` para transformar a recusa em mensagem na tela.
 *
 * A action devolve o motivo em vez de lançar; aqui ele vira parâmetro na URL,
 * que funciona com ou sem JavaScript — mesma escolha do formulário de login.
 */
async function concluir(osId: string) {
  "use server";
  const { redirect } = await import("next/navigation");
  const resultado = await concluirOs(osId);
  if (resultado.erro) {
    redirect(`/os/${osId}?erro=${encodeURIComponent(resultado.erro)}`);
  }
  redirect(`/os/${osId}`);
}
