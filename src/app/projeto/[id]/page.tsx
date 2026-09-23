import { and, asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import {
  comentario as comentarioTable,
  projeto as projetoTable,
  projetoEvento as eventoTable,
} from "@/db/schema";

import { kWh, kWp } from "../../formatar";
import {
  anotarSerial,
  comentar,
  removerSerial,
  salvarInformacoes,
  salvarProjetoTecnico,
  salvarVistoria,
} from "../actions";

export const dynamic = "force-dynamic";

function data(d: Date | null): string {
  return d ? d.toLocaleDateString("pt-BR") : "—";
}

/** Horas viram algo legível: "3 dias", "5 horas". */
function duracao(horas: number | null): string {
  if (horas === null) return "";
  if (horas < 24) return `${horas} h`;
  const dias = Math.round(horas / 24);
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export default async function DetalheProjeto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ serial?: string }>;
}) {
  await exigirUsuario();
  const { id } = await params;
  const { serial: aviso } = await searchParams;

  const projeto = await db.query.projeto.findFirst({
    where: eq(projetoTable.id, id),
    with: {
      cliente: true,
      usina: true,
      etapa: true,
      responsavel: true,
      seriais: { with: { usina: { columns: { nome: true } } } },
    },
  });
  if (!projeto) notFound();

  const eventos = await db.query.projetoEvento.findMany({
    where: eq(eventoTable.projetoId, id),
    with: { etapaDe: true, etapaPara: true, usuario: true },
    orderBy: desc(eventoTable.ocorridoEm),
  });

  const comentarios = await db.query.comentario.findMany({
    where: and(
      eq(comentarioTable.entidade, "projeto"),
      eq(comentarioTable.entidadeId, id),
    ),
    with: { autor: true },
    orderBy: asc(comentarioTable.criadoEm),
  });

  const diasNaEtapa = Math.floor(
    (Date.now() - projeto.etapaDesde.getTime()) / 86_400_000,
  );

  return (
    <main>
      <header className="topo">
        <h1>{projeto.cliente.nome}</h1>
        <span className="pilula st-aberta">{projeto.etapa.nome}</span>
        <span className="sub">
          {diasNaEtapa === 0
            ? "entrou nesta etapa hoje"
            : `há ${diasNaEtapa} ${diasNaEtapa === 1 ? "dia" : "dias"} nesta etapa`}
        </span>
        {projeto.responsavel && (
          <span className="sub">· {projeto.responsavel.nome}</span>
        )}
      </header>

      <div className="os-detalhe">
        {/* Etapa 2 */}
        <section className="bloco">
          <h2>Informações do cliente</h2>
          <p className="nota">
            O consumo médio é a base do dimensionamento. Uma conta de luz da
            Energisa traz 13 meses de histórico numa página só — não precisa
            juntar várias.
          </p>
          <form action={salvarInformacoes.bind(null, projeto.id)} className="form-ficha">
            <div className="dupla">
              <label>
                Consumo médio (kWh/mês)
                <input
                  name="consumoMedioKwh"
                  inputMode="decimal"
                  defaultValue={projeto.consumoMedioKwh ?? ""}
                  placeholder="632"
                />
              </label>
              <label>
                Concessionária
                <input
                  name="concessionaria"
                  defaultValue={projeto.concessionaria ?? ""}
                  placeholder="Energisa Sergipe"
                />
              </label>
            </div>
            <label>
              O que o cliente pediu
              <textarea
                name="observacoes"
                rows={3}
                defaultValue={projeto.observacoes ?? ""}
                placeholder="Aparelhos que pretende acrescentar, ar-condicionado, piscina, expectativa de aumento"
              />
            </label>
            <div className="ficha-acoes">
              <button type="submit" className="primario">
                Salvar informações
              </button>
            </div>
          </form>
        </section>

        {/* Etapa 5 */}
        <section className="bloco">
          <h2>
            Vistoria técnica
            {projeto.vistoriaEm && (
              <span className="contador">{data(projeto.vistoriaEm)}</span>
            )}
          </h2>
          <p className="nota">
            Feita pelo técnico, antes de vender. Não confundir com o pedido de
            vistoria da etapa 11, que é da Energisa para ligar o sistema.
          </p>
          <form action={salvarVistoria.bind(null, projeto.id)} className="form-ficha">
            <label className="curto">
              Data da vistoria
              <input
                type="date"
                name="vistoriaEm"
                defaultValue={
                  projeto.vistoriaEm
                    ? projeto.vistoriaEm.toISOString().slice(0, 10)
                    : ""
                }
              />
            </label>
            <label>
              O que foi encontrado
              <textarea
                name="vistoriaObservacoes"
                rows={4}
                defaultValue={projeto.vistoriaObservacoes ?? ""}
                placeholder="Estado do quadro, medidas, orientação e inclinação do telhado, sombreamento, local do aparelho, acesso"
              />
            </label>
            <div className="ficha-acoes">
              <button type="submit" className="primario">
                Salvar vistoria
              </button>
            </div>
          </form>
        </section>

        {/* Etapa 8 */}
        <section className="bloco">
          <h2>Projeto</h2>
          <p className="nota">
            O protocolo do parecer de acesso é o número que se cobra da
            concessionária quando o projeto trava — segundo o cliente, é aí que o
            processo mais demora.
          </p>
          <form
            action={salvarProjetoTecnico.bind(null, projeto.id)}
            className="form-ficha"
          >
            <div className="dupla">
              <label>
                Número da ART
                <input name="numeroArt" defaultValue={projeto.numeroArt ?? ""} />
              </label>
              <label>
                Protocolo da concessionária
                <input
                  name="protocoloConcessionaria"
                  defaultValue={projeto.protocoloConcessionaria ?? ""}
                />
              </label>
            </div>
            <div className="dupla">
              <label className="curto">
                Potência (kWp)
                <input
                  name="potenciaKwp"
                  inputMode="decimal"
                  defaultValue={projeto.potenciaKwp ?? ""}
                />
              </label>
              <label className="curto">
                Valor (R$)
                <input
                  name="valor"
                  inputMode="decimal"
                  defaultValue={projeto.valor ?? ""}
                />
              </label>
            </div>
            <div className="ficha-acoes">
              <button type="submit" className="primario">
                Salvar projeto
              </button>
            </div>
          </form>
        </section>


        {/* Etapa 10 — instalação */}
        <section className="bloco">
          <h2>
            Inversores instalados
            {projeto.seriais.length > 0 && (
              <span className="contador">{projeto.seriais.length}</span>
            )}
          </h2>
          <p className="nota">
            <strong>
              Anote aqui o número de série de cada inversor no dia da instalação.
            </strong>{" "}
            É o que liga esta venda à usina que vai aparecer no portal do
            fabricante dias depois. Sem isso, o sistema vê a usina com o nome
            que o técnico digitou no portal — <code>José Fernando7</code>,{" "}
            <code>micaely 03</code> — e não tem como saber que é deste cliente.
            O serial está na etiqueta do aparelho e não muda.
          </p>

          {aviso === "repetido" && (
            <p className="erro">
              Este número de série já está em outro projeto. É digitação errada
              ou inversor remanejado — confira antes de insistir.
            </p>
          )}
          {aviso === "vazio" && <p className="erro">Digite o número de série.</p>}

          {projeto.seriais.length > 0 && (
            <ul className="seriais">
              {projeto.seriais.map((s) => (
                <li key={s.id}>
                  <code>{s.numeroSerie}</code>
                  {s.observacao && <span className="fraco"> · {s.observacao}</span>}
                  {s.usinaId ? (
                    <span className="pilula sev-info">
                      confirmado no portal
                      {s.usina?.nome ? ` · ${s.usina.nome}` : ""}
                    </span>
                  ) : (
                    <span className="pilula sev-atencao">
                      esperando o portal confirmar
                    </span>
                  )}
                  <form action={removerSerial.bind(null, projeto.id, s.id)}>
                    <button type="submit" className="remover" title="Remover">
                      remover
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={anotarSerial.bind(null, projeto.id)} className="form-serial">
            <input
              type="text"
              name="numeroSerie"
              placeholder="Número de série do inversor"
              required
              autoComplete="off"
              spellCheck={false}
              aria-label="Número de série do inversor"
            />
            <input
              type="text"
              name="observacao"
              placeholder="opcional: inversor 2, o do fundo…"
              aria-label="Observação"
            />
            <button type="submit">Anotar</button>
          </form>
        </section>

        {/* Histórico */}
        <section className="bloco">
          <h2>
            Caminho na esteira
            {eventos.length > 0 && (
              <span className="contador">{eventos.length} movimentações</span>
            )}
          </h2>
          {eventos.length === 0 ? (
            <p className="nota">
              Este projeto ainda não mudou de etapa. Cada movimentação registra
              quanto tempo ele passou na etapa anterior — é desse histórico que
              sai a resposta para onde os projetos travam.
            </p>
          ) : (
            <ol className="linha-tempo">
              {eventos.map((e) => (
                <li key={e.id}>
                  <span className="quando">
                    {e.ocorridoEm.toLocaleDateString("pt-BR")}
                  </span>
                  <span className="mudanca">
                    {e.etapaDe ? `${e.etapaDe.nome} → ` : ""}
                    <strong>{e.etapaPara.nome}</strong>
                  </span>
                  <span className="fraco">
                    {duracao(e.horasNaEtapaAnterior)}
                    {e.usuario ? ` · ${e.usuario.nome}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Comentários */}
        <section className="bloco">
          <h2>
            Conversa
            {comentarios.length > 0 && (
              <span className="contador">{comentarios.length}</span>
            )}
          </h2>
          <p className="nota">
            A discussão fica presa a este projeto, e não perdida num grupo. Seis
            meses depois ainda dá para achar o que foi combinado.
          </p>
          {comentarios.length > 0 && (
            <ul className="comentarios">
              {comentarios.map((c) => (
                <li key={c.id}>
                  <span className="autor">
                    {c.autor?.nome ?? "alguém"}
                    <span className="fraco">
                      {" · "}
                      {c.criadoEm.toLocaleDateString("pt-BR")}
                    </span>
                  </span>
                  <span className="corpo">{c.texto}</span>
                </li>
              ))}
            </ul>
          )}
          <form action={comentar.bind(null, projeto.id)} className="form-ficha">
            <label>
              Escrever
              <textarea name="texto" rows={2} placeholder="O que aconteceu?" />
            </label>
            <div className="ficha-acoes">
              <button type="submit" className="primario">
                Comentar
              </button>
            </div>
          </form>
        </section>

        {projeto.usina && (
          <p className="nota">
            Usina vinculada: <strong>{projeto.usina.nome}</strong>
            {kWp(projeto.usina.potenciaKwp) ? ` · ${kWp(projeto.usina.potenciaKwp)}` : ""}
            {projeto.consumoMedioKwh
              ? ` · consumo de ${kWh(projeto.consumoMedioKwh)}/mês`
              : ""}
          </p>
        )}
      </div>
    </main>
  );
}
