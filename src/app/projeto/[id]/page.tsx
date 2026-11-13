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
  MapPin,
  MessageSquare,
  Plus,
  ScanSearch,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserRound,
  Wallet,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ehUuid } from "@/app-movel/http";
import { podeVerDocumentos } from "@/auth/permissao";
import { exigirUsuario } from "@/auth/sessao";
import { atorDaWeb } from "@/os/acesso";
import { listarOs, vistoriaDoProjeto } from "@/os/consultas";
import { textoDaResposta } from "@/os/formatar";
import { formatarRelogio } from "@/os/relogio";
import { numeroOs, STATUS_ROTULO, TIPO_ROTULO } from "@/os/tipos";
import { numeroWhatsapp } from "@/documentos/cobranca";
import { entradaDe, representantesDaEmpresa, ultimosContratos } from "@/projeto/contrato-dados";
import { dadosTecnicosDosProjetos } from "@/projeto/aproveitar-vistoria";
import { faltaParaOProjeto, lerDadosTecnicos, OPCOES_DE_TELHADO } from "@/projeto/da-vistoria";
import { rotuloDoModelo, sugestaoDeEquipamentos } from "@/projeto/kit";
import { DISPONIBILIDADE_KWH, ligacaoDoProjeto, ROTULO_LIGACAO, type Ligacao } from "@/proposta/calculo";
import { contextoDaProposta, montarEntrada, responsavelPadrao, ultimasPropostas } from "@/proposta/proposta-dados";
import { diasCorridos, fraseDoTempo } from "@/projeto/tempo";
import { FORMAS_PAGAMENTO, rotuloPagamento } from "@/projeto/pagamento";
import { db } from "@/db";
import {
  comentario as comentarioTable,
  empresa as empresaTable,
  etapa as etapaTable,
  modeloEquipamento as modeloEquipamentoTable,
  projeto as projetoTable,
  projetoEvento as eventoTable,
  unidadeConsumidora as unidadeConsumidoraTable,
} from "@/db/schema";

import { Cabecalho, Caminho, Cartao, Dados, Vazio } from "../../_ui";
import { BotaoDialogo } from "../../_ui/dialogo";
import { moverProjeto } from "../../actions";
import { aprovarProposta, reprovarProposta } from "../../esteira/actions";
import { AcoesDoContrato } from "../../esteira/contrato";
import { AcoesDaProposta } from "../../esteira/proposta";
import { PedirDadosDoCliente } from "../../esteira/pedir-dados";
import { origemDoSite } from "../../origem";
import { kWh, kWp } from "../../formatar";
import {
  anotarSerial,
  comentar,
  removerSerial,
  salvarCliente,
  salvarInformacoes,
  salvarPagamento,
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
  searchParams: Promise<{ serial?: string; cliente?: string; ok?: string; erro?: string }>;
}) {
  const usuario = await exigirUsuario();
  const ator = atorDaWeb(usuario);
  const { id } = await params;
  const { serial: aviso, cliente: avisoCliente, ok, erro } = await searchParams;
  // O que vem no endereço é palpite de quem digita: id malformado é 404, não erro.
  if (!ehUuid(id)) notFound();

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
      where: and(
        eq(comentarioTable.empresaId, usuario.empresaId),
        eq(comentarioTable.entidade, "projeto"),
        eq(comentarioTable.entidadeId, id),
      ),
      with: { autor: true },
      orderBy: asc(comentarioTable.criadoEm),
    }),
    db.query.etapa.findMany({
      where: and(eq(etapaTable.empresaId, usuario.empresaId), eq(etapaTable.ativa, true)),
      orderBy: asc(etapaTable.ordem),
      columns: { id: true, nome: true, slug: true },
    }),
    listarOs(ator, { projetoId: id, aba: "todas" }),
    vistoriaDoProjeto(usuario.empresaId, id),
    podeVerDocumentos(usuario.empresaId, usuario.papel),
  ]);

  // O catálogo de equipamentos para o kit: os modelos ativos e o já escolhido (mesmo se saiu da lista).
  const catalogo = (
    await db
      .select()
      .from(modeloEquipamentoTable)
      .where(eq(modeloEquipamentoTable.empresaId, usuario.empresaId))
      .orderBy(asc(modeloEquipamentoTable.fabricante), asc(modeloEquipamentoTable.modelo))
  ).filter((m) => m.ativo || m.id === projeto.inversorModeloId || m.id === projeto.moduloModeloId);
  const inversores = catalogo.filter((m) => m.tipo === "inversor" || m.tipo === "microinversor");
  const modulos = catalogo.filter((m) => m.tipo === "modulo");

  // A UC do cliente (a vistoria preenche) e se a vistoria já foi concluída.
  const ucs = await db
    .select({ numeroInstalacao: unidadeConsumidoraTable.numeroInstalacao, titular: unidadeConsumidoraTable.titular })
    .from(unidadeConsumidoraTable)
    .where(and(eq(unidadeConsumidoraTable.empresaId, usuario.empresaId), eq(unidadeConsumidoraTable.clienteId, projeto.clienteId)));
  const vistoriaConcluida = vistoria?.status === "concluida";
  // Os números da vistoria para o projeto elétrico (junta a vistoria e a visita de volta).
  const tecnicos = (await dadosTecnicosDosProjetos(usuario.empresaId, [projeto.id])).get(projeto.id) ?? null;
  const d = tecnicos?.dados ?? lerDadosTecnicos([]);
  const faltaProjeto = tecnicos ? faltaParaOProjeto(d) : [];
  const nomeDaEmpresa =
    (await db.query.empresa.findFirst({ where: eq(empresaTable.id, usuario.empresaId), columns: { nome: true } }))?.nome ??
    "nossa empresa";

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
  if (slug === "lead" && ator.gestao) {
    const [ctxProposta, propostas, origemSite] = await Promise.all([
      contextoDaProposta(usuario.empresaId, { nome: usuario.nome }),
      ultimasPropostas(usuario.empresaId, [projeto.id]),
      origemDoSite(),
    ]);
    acaoDoGuia = (
      <span className="grupo-botoes">
        <AcoesDaProposta
          projetoId={projeto.id}
          entrada={montarEntrada(projeto, ctxProposta, ligacaoDoProjeto(projeto.ligacao, d.polos))}
          ehAdm={usuario.papel === "adm"}
          proposta={propostas.get(projeto.id) ?? null}
          whatsapp={numeroWhatsapp(projeto.cliente.telefone)}
          origemSite={origemSite}
          origem="projeto"
          chave={`p|${ok ?? ""}|${erro ?? ""}`}
          responsaveis={ctxProposta.responsaveis}
          responsavelPadrao={responsavelPadrao(ctxProposta.responsaveis, usuario.id, projeto.responsavelId)}
        />
        <form action={aprovarProposta.bind(null, projeto.id, "projeto")}>
          <button type="submit" className="botao">
            <ThumbsUp size={15} aria-hidden /> Proposta aprovada
          </button>
        </form>
        <BotaoDialogo
          rotulo="Reprovada"
          icone={<ThumbsDown size={15} aria-hidden />}
          classe="botao secundario botao-reprovar"
          titulo="Proposta reprovada"
          descricao={`${projeto.cliente.nome} não aceitou a proposta. O projeto sai da esteira e é excluído, e isso não se desfaz. O cadastro do cliente só sai junto se não tiver mais nada (usina, documento, OS).`}
        >
          <form action={reprovarProposta.bind(null, projeto.id)} className="form-agendar form-agendar-coluna">
            <button type="submit" className="botao perigo">
              <Trash2 size={15} aria-hidden /> Excluir o projeto
            </button>
          </form>
        </BotaoDialogo>
      </span>
    );
  } else if (slug === "aguardando_vistoria") {
    const aberta = ordens.find((o) => o.tipo === "vistoria" && o.status !== "concluida" && o.status !== "cancelada");
    acaoDoGuia = aberta ? (
      <Link href={`/os/${aberta.id}`} className="botao secundario">
        Ver a vistoria {numeroOs(aberta.numero)}
      </Link>
    ) : ator.gestao ? (
      <Link href={`/os/nova?projeto=${projeto.id}&tipo=vistoria`} className="botao">
        <ClipboardCheck size={15} aria-hidden /> Criar OS de vistoria
      </Link>
    ) : null;
  } else if (slug === "vistoria_tecnica") {
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
  } else if (slug === "contrato" && ator.gestao) {
    const [empresaDados, representantes, contratos, origemSite] = await Promise.all([
      db.query.empresa.findFirst({
        where: eq(empresaTable.id, usuario.empresaId),
        columns: { nome: true, razaoSocial: true, cnpj: true, endereco: true, email: true },
      }),
      representantesDaEmpresa(usuario.empresaId),
      ultimosContratos(usuario.empresaId, [projeto.id]),
      origemDoSite(),
    ]);
    acaoDoGuia = empresaDados ? (
      <div className="guia-contrato">
        <AcoesDoContrato
          projetoId={projeto.id}
          entrada={entradaDe(projeto.cliente, projeto, empresaDados, null)}
          equipamentos={sugestaoDeEquipamentos(projeto, catalogo)}
          contrato={contratos.get(projeto.id) ?? null}
          representantes={representantes}
          whatsapp={numeroWhatsapp(projeto.cliente.telefone)}
          origemSite={origemSite}
          origem="projeto"
          ehAdm={usuario.papel === "adm"}
          chave={`c|${ok ?? ""}|${erro ?? ""}`}
        />
        {temDocumentos && (
          <Link href={`/documentos/${projeto.id}`} className="botao secundario">
            <FolderOpen size={15} aria-hidden /> Subir a via assinada
          </Link>
        )}
      </div>
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

      {ok && (
        <p className="aviso ok" role="status">
          {ok}
        </p>
      )}
      {erro && (
        <p className="aviso erro" role="alert">
          {erro}
        </p>
      )}

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
                Feita pelo técnico depois que a proposta é aprovada. Não confundir com o pedido de vistoria, que é da
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

          {tecnicos && (
            <Cartao
              titulo="Dados para o projeto elétrico"
              icone={<Zap size={16} />}
              ajuda="O que o técnico mediu e respondeu na vistoria, em números. É daqui que o projeto elétrico e o memorial leem: se faltar um item essencial, o engenheiro sabe antes de começar. Para corrigir, reabra a vistoria."
              contador={
                faltaProjeto.length === 0 ? (
                  <span className="pilula sev-info">pronto para começar</span>
                ) : (
                  <span className="pilula sev-atencao">faltam {faltaProjeto.length}</span>
                )
              }
            >
              {!tecnicos.concluida && (
                <p className="nota">
                  A vistoria ainda está em campo: as respostas podem mudar.{" "}
                  <Link href={`/os/${tecnicos.osId}`}>Abrir a {numeroOs(tecnicos.osNumero)}</Link>
                </p>
              )}
              {faltaProjeto.length > 0 && (
                <p className="aviso aviso-solto">
                  <strong>Falta para o projeto elétrico:</strong> {faltaProjeto.join(", ")}.
                </p>
              )}
              <Dados
                itens={[
                  ["Disjuntor do padrão", d.disjuntorA !== null ? `${d.disjuntorA} A${d.polos ? ` · ${d.polos.toLowerCase()}` : ""}` : d.polos],
                  ["Cabo de entrada", d.bitola],
                  ["Aterramento", d.aterramento],
                  ["Vagas no quadro (QDG)", d.qdgVagas],
                  ["Caminho do cabo", d.caminhoCabo],
                  ["Rasgar parede", d.rasgarParede === null ? null : d.rasgarParede ? "Sim" : "Não"],
                  ["Telhado", [d.telhado, ...d.telhadoEstado].filter(Boolean).join(" · ") || null],
                  ["Área útil", d.areaUtilM2 !== null ? `${d.areaUtilM2.toLocaleString("pt-BR")} m²` : null],
                  ["Sombra", d.sombra],
                  ["Local do inversor", d.inversorLocal],
                  ["Aumento de consumo previsto", d.ampliacao === null ? null : d.ampliacao ? "Sim" : "Não"],
                ]}
              />
            </Cartao>
          )}

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
                  Tipo de ligação
                  <select name="ligacao" defaultValue={projeto.ligacao ?? ""}>
                    <option value="">Ainda não sei</option>
                    {(Object.keys(DISPONIBILIDADE_KWH) as Ligacao[]).map((l) => (
                      <option key={l} value={l}>
                        {ROTULO_LIGACAO[l]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Concessionária
                  <input name="concessionaria" list="concessionarias" defaultValue={projeto.concessionaria ?? ""} placeholder="Energisa Sergipe" />
                  <datalist id="concessionarias">
                    <option value="Energisa Sergipe" />
                    <option value="Sulgipe" />
                  </datalist>
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
            titulo="Pagamento"
            icone={<Wallet size={16} />}
            contador={rotuloPagamento(projeto.formaPagamento) ?? undefined}
            ajuda="A forma de pagamento que o cliente aceitou no Lead. Se a negociação mudar, corrija aqui."
          >
            <form action={salvarPagamento.bind(null, projeto.id)} className="form-ficha">
              <div className="dupla">
                <label>
                  Forma de pagamento
                  <select name="formaPagamento" defaultValue={projeto.formaPagamento ?? ""}>
                    <option value="">Ainda não definida</option>
                    {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Valor total (R$)
                  <input name="valor" inputMode="decimal" defaultValue={projeto.valor ?? ""} />
                </label>
              </div>
              <label>
                Condições combinadas
                <textarea
                  name="pagamentoCondicoes"
                  rows={2}
                  defaultValue={projeto.pagamentoCondicoes ?? ""}
                  placeholder="Entrada, número de parcelas, banco do financiamento, data do primeiro vencimento"
                />
              </label>
              <div className="ficha-acoes">
                <button type="submit" className="primario">
                  Salvar pagamento
                </button>
              </div>
            </form>
          </Cartao>

          <Cartao
            titulo="Cliente e endereço"
            icone={<MapPin size={16} />}
            ajuda="O endereço é o que o app do técnico usa para traçar a rota até a casa do cliente. Sem ele, o botão de rota não tem para onde ir."
          >
            {avisoCliente === "ok" && <p className="aviso ok">Dados do cliente salvos.</p>}
            {avisoCliente === "cpf" && (
              <p className="erro">O CPF não confere (dígito errado?). Corrija ou deixe em branco.</p>
            )}
            {avisoCliente === "cpf-outro" && <p className="erro">Esse CPF já está no cadastro de outro cliente.</p>}
            {ator.gestao && <PedirDadosDoCliente cliente={cliente} empresa={nomeDaEmpresa} />}
            <form action={salvarCliente.bind(null, projeto.id)} className="form-ficha">
              <div className="dupla">
                <label>
                  CPF ou CNPJ <span className="fraco">(opcional)</span>
                  <input name="cpf" inputMode="numeric" defaultValue={cliente.cpfCnpj ?? ""} autoComplete="off" />
                </label>
                <label>
                  Telefone
                  <input name="telefone" inputMode="tel" defaultValue={cliente.telefone ?? ""} />
                </label>
              </div>
              <div className="dupla">
                <label>
                  Endereço
                  <input name="logradouro" defaultValue={cliente.logradouro ?? ""} placeholder="Rua, avenida, povoado" />
                </label>
                <label>
                  Número
                  <input name="numero" defaultValue={cliente.numero ?? ""} placeholder="123 ou S/N" />
                </label>
                <label>
                  Bairro
                  <input name="bairro" defaultValue={cliente.bairro ?? ""} />
                </label>
              </div>
              <div className="dupla">
                <label>
                  Complemento
                  <input name="complemento" defaultValue={cliente.complemento ?? ""} placeholder="Apto, bloco, referência" />
                </label>
                <label>
                  Cidade
                  <input name="cidade" defaultValue={cliente.cidade ?? ""} />
                </label>
                <label>
                  UF
                  <input name="uf" defaultValue={cliente.uf ?? "SE"} maxLength={2} />
                </label>
                <label>
                  CEP
                  <input
                    name="cep"
                    inputMode="numeric"
                    maxLength={9}
                    defaultValue={cliente.cep ? cliente.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2") : ""}
                    placeholder="49500-000"
                  />
                </label>
              </div>
              <div className="ficha-acoes">
                <button type="submit" className="primario">
                  Salvar cliente
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
                  Inversor
                  <select name="inversorModeloId" defaultValue={projeto.inversorModeloId ?? ""}>
                    <option value="">{inversores.length ? "Escolha do catálogo…" : "Catálogo vazio"}</option>
                    {inversores.map((m) => (
                      <option key={m.id} value={m.id}>
                        {rotuloDoModelo(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="curto">
                  Quantos
                  <input name="inversorQtd" type="number" min={1} max={999} defaultValue={projeto.inversorQtd ?? ""} />
                </label>
                <label>
                  Módulo
                  <select name="moduloModeloId" defaultValue={projeto.moduloModeloId ?? ""}>
                    <option value="">{modulos.length ? "Escolha do catálogo…" : "Catálogo vazio"}</option>
                    {modulos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {rotuloDoModelo(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="curto">
                  Quantos
                  <input name="moduloQtd" type="number" min={1} max={9999} defaultValue={projeto.moduloQtd ?? ""} />
                </label>
              </div>
              <p className="ajuda">
                O datasheet e o Inmetro do inversor e do módulo entram sozinhos no dossiê. Falta um modelo?{" "}
                {usuario.papel === "adm" || usuario.papel === "engenheiro" ? (
                  <Link href="/administracao/equipamentos">Cadastre no catálogo</Link>
                ) : (
                  "Peça ao adm ou ao engenheiro para cadastrar no catálogo"
                )}
                .
              </p>
              <div className="dupla">
                <label>
                  Potência (kWp)
                  <input
                    name="potenciaKwp"
                    inputMode="decimal"
                    defaultValue={projeto.potenciaKwp ?? ""}
                    placeholder="em branco: módulos × potência"
                  />
                </label>
              </div>
              <label className="curto">
                Tipo de telhado
                <select name="telhadoTipo" defaultValue={projeto.telhadoTipo ?? ""}>
                  <option value="">Ainda não sei</option>
                  {OPCOES_DE_TELHADO.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <small className="entrada-ajuda">
                  {projeto.telhadoTipo && vistoriaConcluida
                    ? "Veio da vistoria do técnico; pode corrigir."
                    : "A vistoria do técnico preenche sozinha, ao ser concluída."}
                </small>
              </label>
              <label>
                Equipamentos do kit <span className="fraco">(entra no contrato; em branco, sai do inversor, do módulo e do telhado)</span>
                <textarea
                  name="equipamentos"
                  rows={2}
                  maxLength={1000}
                  defaultValue={projeto.equipamentos ?? ""}
                  placeholder="2 inversores Growatt on-grid 10K 220V, 40 módulos fotovoltaicos Jinko 625W / estrutura fibrocimento"
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
                      {iniciais(c.autor?.nome ?? "Sistema")}
                    </span>
                    <div>
                      <span className="conversa-autor">
                        {c.autor?.nome ?? "Sistema"}
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
                [
                  "Endereço",
                  [[cliente.logradouro, cliente.numero].filter(Boolean).join(", "), cliente.bairro]
                    .filter(Boolean)
                    .join(" · ") || null,
                ],
                ["Pagamento", rotuloPagamento(projeto.formaPagamento)],
                ["Consumo médio", projeto.consumoMedioKwh ? `${kWh(projeto.consumoMedioKwh)}/mês` : null],
                ["Potência", kWp(projeto.potenciaKwp)],
                ["Valor", reais(projeto.valor)],
                ["Concessionária", projeto.concessionaria],
                ["UC", ucs.length ? ucs.map((u) => u.numeroInstalacao).join(", ") : null],
                ["Titular da conta", ucs.find((u) => u.titular)?.titular ?? null],
                ["Telhado", projeto.telhadoTipo],
                [
                  "Usina",
                  projeto.usina ? (
                    <Link href={`/usinas?busca=${encodeURIComponent(projeto.usina.nome)}`}>{projeto.usina.nome}</Link>
                  ) : null,
                ],
                ["ART", projeto.numeroArt],
                ["Protocolo", projeto.protocoloConcessionaria],
                [
                  "Contrato assinado",
                  projeto.contratoAssinadoEm
                    ? `${data(projeto.contratoAssinadoEm)} (${fraseDoTempo(diasCorridos(projeto.contratoAssinadoEm))})`
                    : null,
                ],
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
