import { and, asc, desc, eq } from "drizzle-orm";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  ClipboardList,
  Cpu,
  FileText,
  FolderOpen,
  History,
  Lightbulb,
  MessageSquare,
  Plus,
  ScanSearch,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { podeVerDocumentos } from "@/auth/permissao";
import { exigirUsuario } from "@/auth/sessao";
import { atorDaWeb } from "@/os/acesso";
import { listarOs, vistoriaDoProjeto } from "@/os/consultas";
import { textoDaResposta } from "@/os/formatar";
import { formatarRelogio } from "@/os/relogio";
import { numeroOs, STATUS_ROTULO, TIPO_ROTULO } from "@/os/tipos";
import { db } from "@/db";
import {
  comentario as comentarioTable,
  etapa as etapaTable,
  projeto as projetoTable,
  projetoEvento as eventoTable,
} from "@/db/schema";

import { Cabecalho, Caminho, Cartao, Dados, Vazio } from "../../_ui";
import { moverProjeto } from "../../actions";
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

function reais(valor: string | number | null): string | null {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null;
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

const SITUACAO_ROTULO: Record<string, string> = {
  concluido: "Concluído",
  cancelado: "Cancelado",
  pausado: "Pausado",
};

export default async function DetalheProjeto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ serial?: string }>;
}) {
  const usuario = await exigirUsuario();
  const ator = atorDaWeb(usuario);
  const { id } = await params;
  const { serial: aviso } = await searchParams;

  // Da empresa de quem pede: sem isto, um id de projeto de outra empresa
  // abriria aqui — o sistema é multiempresa desde a primeira migration.
  const projeto = await db.query.projeto.findFirst({
    where: and(eq(projetoTable.id, id), eq(projetoTable.empresaId, usuario.empresaId)),
    with: {
      cliente: true,
      usina: true,
      etapa: true,
      responsavel: true,
      seriais: { with: { usina: { columns: { nome: true } } } },
    },
  });
  if (!projeto) notFound();

  const [eventos, comentarios, etapas, ordens, vistoria, temDocumentos] = await Promise.all([
    db.query.projetoEvento.findMany({
      where: eq(eventoTable.projetoId, id),
      with: { etapaDe: true, etapaPara: true, usuario: true },
      orderBy: desc(eventoTable.ocorridoEm),
    }),
    db.query.comentario.findMany({
      where: and(eq(comentarioTable.entidade, "projeto"), eq(comentarioTable.entidadeId, id)),
      with: { autor: true },
      orderBy: asc(comentarioTable.criadoEm),
    }),
    db.query.etapa.findMany({
      where: eq(etapaTable.empresaId, usuario.empresaId),
      orderBy: asc(etapaTable.ordem),
      columns: { id: true, nome: true, slug: true },
    }),
    listarOs(ator, { projetoId: id, aba: "todas" }),
    vistoriaDoProjeto(usuario.empresaId, id),
    podeVerDocumentos(usuario.empresaId, usuario.papel),
  ]);

  const diasNaEtapa = Math.floor((Date.now() - projeto.etapaDesde.getTime()) / 86_400_000);
  const indiceEtapa = etapas.findIndex((e) => e.id === projeto.etapaId);
  const primeira = indiceEtapa <= 0;
  const ultima = indiceEtapa === etapas.length - 1;
  const instalacao = ordens.find((o) => o.tipo === "instalacao");
  const cliente = projeto.cliente;
  const cidade = [cliente.cidade, cliente.uf].filter(Boolean).join("/");

  /**
   * O que fazer agora, como no "Path" do Salesforce: a descrição da etapa (que
   * vem do cadastro da esteira, não do código) e, quando existe, o botão que
   * resolve a etapa.
   */
  let acaoDoGuia: React.ReactNode = null;
  const slug = projeto.etapa.slug;
  if (slug === "vistoria_tecnica") {
    acaoDoGuia = vistoria ? (
      <Link href={`/os/${vistoria.id}`} className="botao secundario">
        Ver a vistoria {numeroOs(vistoria.numero)}
      </Link>
    ) : ator.gestao ? (
      <Link href={`/os/nova?projeto=${projeto.id}&tipo=vistoria`} className="botao">
        <Plus size={15} aria-hidden /> Abrir OS de vistoria
      </Link>
    ) : null;
  } else if (slug === "execucao") {
    acaoDoGuia = instalacao ? (
      <Link href={`/os/${instalacao.id}`} className="botao secundario">
        Ver a instalação {numeroOs(instalacao.numero)}
      </Link>
    ) : ator.gestao ? (
      <Link href={`/os/nova?projeto=${projeto.id}&tipo=instalacao`} className="botao">
        <Plus size={15} aria-hidden /> Abrir OS de instalação
      </Link>
    ) : null;
  } else if (["documentacao", "contrato", "projeto"].includes(slug) && temDocumentos) {
    acaoDoGuia = (
      <Link href={`/documentos/${projeto.id}`} className="botao secundario">
        <FolderOpen size={15} aria-hidden /> Abrir o dossiê
      </Link>
    );
  }

  const respondidos = vistoria?.checklist.filter((i) => i.respondidoEm || i.anexos.length) ?? [];

  return (
    <main className="registro">
      <Cabecalho
        trilha={[{ href: "/esteira", rotulo: "Esteira de projetos" }]}
        titulo={cliente.nome}
        selos={
          <>
            <span className="ui-selo ui-selo-marca">{projeto.etapa.nome}</span>
            {projeto.situacao !== "em_andamento" && (
              <span className="ui-selo">{SITUACAO_ROTULO[projeto.situacao] ?? projeto.situacao}</span>
            )}
          </>
        }
        meta={
          <>
            <span className={diasNaEtapa >= 15 ? "texto-atencao" : ""}>
              {diasNaEtapa === 0 ? "entrou nesta etapa hoje" : `há ${diasNaEtapa} ${diasNaEtapa === 1 ? "dia" : "dias"} nesta etapa`}
            </span>
            {projeto.responsavel && (
              <span className="meta-pessoa">
                <span className="avatar-mini" aria-hidden>
                  {iniciais(projeto.responsavel.nome)}
                </span>
                {projeto.responsavel.nome}
              </span>
            )}
            {cidade && <span>{cidade}</span>}
          </>
        }
        acoes={
          <>
            {temDocumentos && (
              <Link href={`/documentos/${projeto.id}`} className="botao secundario">
                <FolderOpen size={15} aria-hidden /> Dossiê
              </Link>
            )}
            {ator.gestao && (
              <Link href={`/os/nova?projeto=${projeto.id}`} className="botao secundario">
                <Plus size={15} aria-hidden /> Nova OS
              </Link>
            )}
            <span className="grupo-botoes">
              <form action={moverProjeto.bind(null, projeto.id, "voltar")}>
                <button type="submit" className="botao secundario" disabled={primeira} title="Voltar uma etapa">
                  <ArrowLeft size={15} aria-hidden />
                  <span className="sr-only">Voltar uma etapa</span>
                </button>
              </form>
              <form action={moverProjeto.bind(null, projeto.id, "avancar")}>
                <button type="submit" className="botao" disabled={ultima}>
                  Avançar etapa <ArrowRight size={15} aria-hidden />
                </button>
              </form>
            </span>
          </>
        }
      />

      <div className="faixa-caminho">
        <Caminho etapas={etapas} atual={indiceEtapa} compacto />
        <div className="guia">
          <span className="guia-icone" aria-hidden>
            <Lightbulb size={18} />
          </span>
          <div className="guia-texto">
            <strong>Agora: {projeto.etapa.nome}</strong>
            {projeto.etapa.descricao && <p>{projeto.etapa.descricao}</p>}
          </div>
          {acaoDoGuia && <div className="guia-acao">{acaoDoGuia}</div>}
        </div>
      </div>

      <div className="registro-grade">
        <div className="registro-principal">
          <Cartao
            titulo="Ordens de serviço"
            icone={<ClipboardList size={16} />}
            contador={ordens.length}
            acao={
              ator.gestao && ordens.length > 0 ? (
                <Link href={`/os/nova?projeto=${projeto.id}`} className="link-acao">
                  <Plus size={14} aria-hidden /> Nova OS
                </Link>
              ) : null
            }
          >
            {ordens.length === 0 ? (
              <Vazio
                icone={<ClipboardList size={20} />}
                titulo="Nenhuma OS nesta venda"
                acao={
                  ator.gestao ? (
                    <Link href={`/os/nova?projeto=${projeto.id}`} className="botao">
                      <Plus size={15} aria-hidden /> Nova OS nesta venda
                    </Link>
                  ) : null
                }
              >
                A vistoria e a instalação abertas por aqui andam a esteira sozinhas quando são concluídas.
              </Vazio>
            ) : (
              <ul className="lista-limpa lista-colada">
                {ordens.map((o) => (
                  <li key={o.id}>
                    <Link href={`/os/${o.id}`} className="linha-os">
                      <span className="linha-os-num">{numeroOs(o.numero)}</span>
                      <span className="linha-os-corpo">
                        <strong>{TIPO_ROTULO[o.tipo] ?? o.tipo}</strong>
                        <small>
                          {o.agendadaPara ? formatarRelogio(o.agendadaPara) : "sem data"}
                          {" · "}
                          {o.responsavel?.nome ?? "sem responsável"}
                        </small>
                      </span>
                      <span className={`pilula st-${o.status}`}>{STATUS_ROTULO[o.status] ?? o.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao
            titulo="Vistoria técnica"
            icone={<ScanSearch size={16} />}
            contador={projeto.vistoriaEm ? data(projeto.vistoriaEm) : undefined}
            ajuda={
              <>
                Feita pelo técnico, antes de vender. Não confundir com o pedido de vistoria da etapa 11, que é da
                Energisa para ligar o sistema. O engenheiro usa o que está aqui para fazer o projeto.
              </>
            }
          >
            {vistoria ? (
              <>
                <div className="faixa-info">
                  <ClipboardCheck size={16} aria-hidden />
                  <span>
                    Pelo app:{" "}
                    <Link href={`/os/${vistoria.id}`}>
                      {numeroOs(vistoria.numero)}
                    </Link>{" "}
                    <span className={`pilula st-${vistoria.status}`}>{STATUS_ROTULO[vistoria.status] ?? vistoria.status}</span>
                    {vistoria.responsavel ? ` · ${vistoria.responsavel.nome}` : ""}
                  </span>
                </div>
                {vistoria.status !== "concluida" && (
                  <p className="nota">Ainda em andamento: as respostas podem mudar.</p>
                )}
                {respondidos.length === 0 ? (
                  <p className="nota">Nenhuma resposta ainda.</p>
                ) : (
                  <dl className="dados dados-grade">
                    {respondidos.map((i) => (
                      <div key={i.id}>
                        <dt>{i.descricao}</dt>
                        <dd>
                          {textoDaResposta(i)}
                          {i.observacao ? <span className="fraco"> · {i.observacao}</span> : null}
                          {i.anexos.length > 0 && i.tipoResposta !== "foto" && (
                            <span className="fraco">
                              {" "}
                              · {i.anexos.length} foto{i.anexos.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            ) : (
              <p className="nota">
                Nenhuma vistoria pelo app ainda.
                {ator.gestao && (
                  <>
                    {" "}
                    <Link href={`/os/nova?projeto=${projeto.id}&tipo=vistoria`}>Abrir OS de vistoria</Link>
                  </>
                )}
              </p>
            )}

            <details className="dobra-limpa" open={!vistoria && !!projeto.vistoriaObservacoes}>
              <summary>Anotação manual da vistoria</summary>
              <form action={salvarVistoria.bind(null, projeto.id)} className="form-ficha">
                <label className="curto">
                  Data da vistoria
                  <input
                    type="date"
                    name="vistoriaEm"
                    defaultValue={projeto.vistoriaEm ? projeto.vistoriaEm.toISOString().slice(0, 10) : ""}
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
            </details>
          </Cartao>

          <Cartao
            titulo="Dados da venda"
            icone={<UserRound size={16} />}
            ajuda={
              <>
                O consumo médio é a base do dimensionamento. Uma conta de luz da Energisa traz 13 meses de histórico
                numa página só — não precisa juntar várias.
              </>
            }
          >
            <form action={salvarInformacoes.bind(null, projeto.id)} className="form-ficha">
              <div className="dupla">
                <label>
                  Consumo médio (kWh/mês)
                  <input name="consumoMedioKwh" inputMode="decimal" defaultValue={projeto.consumoMedioKwh ?? ""} placeholder="632" />
                </label>
                <label>
                  Concessionária
                  <input name="concessionaria" defaultValue={projeto.concessionaria ?? ""} placeholder="Energisa Sergipe" />
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
                  Salvar
                </button>
              </div>
            </form>
          </Cartao>

          <Cartao
            titulo="Projeto técnico"
            icone={<FileText size={16} />}
            ajuda={
              <>
                O protocolo do parecer de acesso é o número que se cobra da concessionária quando o projeto trava —
                segundo o cliente, é aí que o processo mais demora.
              </>
            }
          >
            <form action={salvarProjetoTecnico.bind(null, projeto.id)} className="form-ficha">
              <div className="dupla">
                <label>
                  Número da ART
                  <input name="numeroArt" defaultValue={projeto.numeroArt ?? ""} />
                </label>
                <label>
                  Protocolo da concessionária
                  <input name="protocoloConcessionaria" defaultValue={projeto.protocoloConcessionaria ?? ""} />
                </label>
              </div>
              <div className="dupla">
                <label>
                  Potência (kWp)
                  <input name="potenciaKwp" inputMode="decimal" defaultValue={projeto.potenciaKwp ?? ""} />
                </label>
                <label>
                  Valor (R$)
                  <input name="valor" inputMode="decimal" defaultValue={projeto.valor ?? ""} />
                </label>
              </div>
              <div className="ficha-acoes">
                <button type="submit" className="primario">
                  Salvar
                </button>
              </div>
            </form>
          </Cartao>

          <Cartao
            titulo="Inversores instalados"
            icone={<Cpu size={16} />}
            contador={projeto.seriais.length || undefined}
            ajuda={
              <>
                É o número de série que liga esta venda à usina que aparece no portal do fabricante dias depois. Sem
                ele, o sistema vê a usina com o nome que o técnico digitou no portal — <code>José Fernando7</code>,{" "}
                <code>micaely 03</code> — e não sabe que é deste cliente. O serial está na etiqueta do aparelho e não
                muda.
              </>
            }
          >
            <p className="nota">Anote o número de série de cada inversor no dia da instalação.</p>

            {aviso === "repetido" && (
              <p className="erro">
                Este número de série já está em outro projeto. É digitação errada ou inversor remanejado — confira
                antes de insistir.
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
                        confirmado no portal{s.usina?.nome ? ` · ${s.usina.nome}` : ""}
                      </span>
                    ) : (
                      <span className="pilula sev-atencao">esperando o portal confirmar</span>
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
              <input type="text" name="observacao" placeholder="opcional: inversor 2, o do fundo…" aria-label="Observação" />
              <button type="submit" className="botao secundario">
                Anotar
              </button>
            </form>
          </Cartao>

          <Cartao
            titulo="Conversa"
            icone={<MessageSquare size={16} />}
            contador={comentarios.length || undefined}
            ajuda="A discussão fica presa a este projeto, e não perdida num grupo. Seis meses depois ainda dá para achar o que foi combinado."
          >
            {comentarios.length > 0 && (
              <ul className="conversa">
                {comentarios.map((c) => (
                  <li key={c.id}>
                    <span className="avatar-mini" aria-hidden>
                      {iniciais(c.autor?.nome ?? "?")}
                    </span>
                    <div>
                      <span className="conversa-autor">
                        {c.autor?.nome ?? "alguém"}
                        <span className="fraco"> · {c.criadoEm.toLocaleDateString("pt-BR")}</span>
                      </span>
                      <p>{c.texto}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form action={comentar.bind(null, projeto.id)} className="form-conversa">
              <textarea name="texto" rows={2} placeholder="Escreva um recado para a equipe…" aria-label="Comentário" />
              <button type="submit" className="botao">
                Comentar
              </button>
            </form>
          </Cartao>
        </div>

        <aside className="registro-lateral">
          <Cartao titulo="Resumo">
            <Dados
              itens={[
                ["Cliente", cliente.nome],
                [
                  "Telefone",
                  cliente.telefone ? <a href={`tel:${cliente.telefone.replace(/\D/g, "")}`}>{cliente.telefone}</a> : null,
                ],
                ["Cidade", cidade],
                ["Consumo médio", projeto.consumoMedioKwh ? `${kWh(projeto.consumoMedioKwh)}/mês` : null],
                ["Potência", kWp(projeto.potenciaKwp)],
                ["Valor", reais(projeto.valor)],
                ["Concessionária", projeto.concessionaria],
                [
                  "Usina",
                  projeto.usina ? (
                    <Link href={`/usinas?busca=${encodeURIComponent(projeto.usina.nome)}`}>{projeto.usina.nome}</Link>
                  ) : null,
                ],
                ["ART", projeto.numeroArt],
                ["Protocolo", projeto.protocoloConcessionaria],
                ["Criado em", data(projeto.criadoEm)],
              ]}
            />
          </Cartao>

          <Cartao titulo="Histórico na esteira" icone={<History size={16} />}>
            {eventos.length === 0 ? (
              <p className="nota">
                Ainda não mudou de etapa. Cada movimentação registra quanto tempo o projeto passou na etapa anterior.
              </p>
            ) : (
              <ol className="tempo">
                {eventos.map((e) => (
                  <li key={e.id}>
                    <span className="tempo-ponto" aria-hidden />
                    <div>
                      <strong>{e.etapaPara.nome}</strong>
                      <small>
                        {e.ocorridoEm.toLocaleDateString("pt-BR")}
                        {e.etapaDe ? ` · ficou ${duracao(e.horasNaEtapaAnterior)} em ${e.etapaDe.nome}` : ""}
                        {e.usuario ? ` · ${e.usuario.nome}` : ""}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Cartao>
        </aside>
      </div>
    </main>
  );
}
