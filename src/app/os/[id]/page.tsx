import { headers } from "next/headers";
import {
  CalendarClock,
  Camera,
  FileDown,
  FileText,
  History,
  ListChecks,
  MapPinned,
  MessageCircle,
  MessageSquare,
  Navigation,
  Phone,
  PlayCircle,
  Route,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ErroOs, exigirAtorWeb, podeExecutar } from "@/os/acesso";
import { carregarOs, comentariosDaOs, responsaveisPossiveis, tempoEmCampo } from "@/os/consultas";
import {
  formatarDuracao,
  formatarInstante,
  formatarRelogio,
  relogioAgora,
  relogioParaCampo,
} from "@/os/relogio";
import {
  encerrada,
  MOTIVOS_CANCELAMENTO,
  MOTIVOS_NAO_ATENDIDA,
  MOTIVOS_PAUSA,
  MOTIVOS_REAGENDAMENTO,
  numeroOs,
  PRIORIDADE_ROTULO,
  RESULTADO_ROTULO,
  STATUS_ROTULO,
  TIPO_ROTULO,
} from "@/os/tipos";

import {
  abrirRetornoAction,
  acaoOsAction,
  anexarAction,
  comentarOsAction,
  removerAnexoAction,
  renovarLinkAction,
} from "../actions";
import { Cabecalho, Caminho, Cartao, Dados } from "../../_ui";
import { FormMotivo, Historico, ItemChecklist } from "./partes";
import Trajeto from "./trajeto";

export const dynamic = "force-dynamic";

const PAPEL: Record<string, string> = { tecnico: "técnico", vendedor: "vendedor", engenheiro: "engenheiro", adm: "adm" };

function soDigitos(t: string | null | undefined): string {
  return (t ?? "").replace(/\D/g, "");
}

/** Número com DDI para o wa.me: 11 dígitos de celular brasileiro viram 55… */
function whatsapp(telefone: string | null | undefined): string | null {
  const d = soDigitos(telefone);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length >= 12) return d;
  return null;
}

export default async function DetalheOs({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const ator = await exigirAtorWeb();
  const { id } = await params;
  const { ok, erro } = await searchParams;

  let os;
  try {
    os = await carregarOs(ator, id);
  } catch (e) {
    if (e instanceof ErroOs) notFound();
    throw e;
  }

  const [comentarios, pessoas] = await Promise.all([
    comentariosDaOs(ator.empresaId, os.id),
    ator.gestao ? responsaveisPossiveis(ator.empresaId) : Promise.resolve([]),
  ]);

  const fechada = encerrada(os.status);
  const executa = podeExecutar(ator, os);
  const gestao = ator.gestao;
  const podeResponder = executa && !fechada;
  const podeRemoverDe = (enviadoPorId: string | null) => gestao || enviadoPorId === ator.id;

  const tempo = tempoEmCampo(os.eventos);
  // O mapa só aparece quando há o que mostrar: a OS está em campo, ou alguma
  // ação foi feita com GPS (saiu, chegou, concluiu).
  const mostrarTrajeto =
    os.status === "em_deslocamento" || os.status === "em_andamento" || os.eventos.some((e) => e.latitude !== null);
  const chegada = os.eventos.find((e) => e.tipo === "iniciada");
  const assinatura = os.anexos.find((a) => a.categoria === "assinatura");
  const avulsas = os.anexos.filter((a) => a.categoria !== "assinatura" && !a.checklistItemId);
  const obrigatorios = os.checklist.filter((i) => i.obrigatorio);
  const pendentes = obrigatorios.filter((i) => !i.concluido);
  const feitos = obrigatorios.length
    ? obrigatorios.length - pendentes.length
    : os.checklist.filter((i) => i.concluido).length;
  const progressoChecklist = Math.round((feitos / Math.max(1, obrigatorios.length || os.checklist.length)) * 100);
  const agora = relogioAgora();
  const prazoVencido = !fechada && os.prazoSla !== null && os.prazoSla < agora;

  // Checklist agrupado por seção, na ordem em que foi pedido.
  const secoes: { nome: string; itens: typeof os.checklist }[] = [];
  for (const item of os.checklist) {
    const nome = item.secao ?? "Checklist";
    const ultima = secoes[secoes.length - 1];
    if (ultima?.nome === nome) ultima.itens.push(item);
    else secoes.push({ nome, itens: [item] });
  }

  // O link público do relatório precisa do endereço de fora (atrás do Caddy).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const protocolo = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const linkPublico = os.relatorioToken ? `${protocolo}://${host}/r/${os.relatorioToken}` : null;
  const wa = whatsapp(os.cliente.telefone);
  const primeiroNome = os.cliente.nome.split(" ")[0];
  const mensagemWa = linkPublico
    ? `Olá, ${primeiroNome}! Segue o relatório do atendimento (OS ${numeroOs(os.numero)}) da ${os.empresa.nome}: ${linkPublico}`
    : "";

  const endereco = [
    [os.cliente.logradouro, os.cliente.numero].filter(Boolean).join(", "),
    os.cliente.bairro,
    [os.cliente.cidade, os.cliente.uf].filter(Boolean).join(" - "),
  ]
    .filter(Boolean)
    .join(" · ");
  const mapaCliente =
    os.usina?.latitude && os.usina?.longitude
      ? `https://www.google.com/maps?q=${os.usina.latitude},${os.usina.longitude}`
      : endereco
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`
        : null;

  /** O caminho da OS, como no ServiceTitan: onde ela está entre abrir e concluir. */
  const PASSOS = [
    { id: "aberta", nome: "A agendar" },
    { id: "agendada", nome: "Agendada" },
    { id: "em_deslocamento", nome: "A caminho" },
    { id: "em_andamento", nome: "Em atendimento" },
    { id: "concluida", nome: "Concluída" },
  ];
  const passoAtual =
    os.status === "concluida"
      ? PASSOS.length
      : os.status === "aguardando_peca"
        ? 3
        : Math.max(0, PASSOS.findIndex((p) => p.id === os.status));

  return (
    <main className="registro">
      <Cabecalho
        trilha={[{ href: "/os", rotulo: "Ordens de serviço" }]}
        titulo={`OS ${numeroOs(os.numero)}`}
        selos={
          <>
            <span className={`pilula st-${os.status}`}>{STATUS_ROTULO[os.status] ?? os.status}</span>
            {os.prioridade !== "normal" && (
              <span className={`pilula pr-${os.prioridade}`}>{PRIORIDADE_ROTULO[os.prioridade] ?? os.prioridade}</span>
            )}
          </>
        }
        meta={
          <>
            <span>{TIPO_ROTULO[os.tipo] ?? os.tipo}</span>
            <span className="meta-pessoa">
              <UserRound size={14} aria-hidden /> {os.cliente.nome}
            </span>
            <span className={`meta-pessoa${prazoVencido ? " texto-perigo" : ""}`}>
              <CalendarClock size={14} aria-hidden />
              {os.agendadaPara ? formatarRelogio(os.agendadaPara) : "sem data"}
              {prazoVencido ? " · prazo vencido" : ""}
            </span>
            <span className="meta-pessoa">
              <span className="avatar-mini" aria-hidden>
                {(os.responsavel?.nome ?? "?").slice(0, 1).toUpperCase()}
              </span>
              {os.responsavel?.nome ?? "sem responsável"}
            </span>
          </>
        }
        acoes={
          <>
            {os.cliente.telefone && (
              <a href={`tel:${soDigitos(os.cliente.telefone)}`} className="botao secundario" title="Ligar para o cliente">
                <Phone size={15} aria-hidden /> Ligar
              </a>
            )}
            {wa && (
              <a href={`https://wa.me/${wa}`} className="botao secundario" target="_blank" rel="noopener">
                <MessageCircle size={15} aria-hidden /> WhatsApp
              </a>
            )}
            {mapaCliente && (
              <a href={mapaCliente} className="botao secundario" target="_blank" rel="noopener">
                <Navigation size={15} aria-hidden /> Rota
              </a>
            )}
            <a href={`/os/${os.id}/relatorio`} className="botao secundario" target="_blank" rel="noopener">
              <FileDown size={15} aria-hidden /> PDF
            </a>
          </>
        }
      />

      <div className="faixa-caminho">
        {os.status === "cancelada" ? (
          <p className="aviso erro">Esta OS foi cancelada.</p>
        ) : (
          <Caminho etapas={PASSOS} atual={passoAtual} rotuloAtual="situação atual" />
        )}
        {os.status === "aguardando_peca" && <p className="aviso">Pausada: aguardando peça ou o cliente.</p>}
      </div>

      {ok && <p className="aviso ok">{ok}</p>}
      {erro && (
        <p className="aviso erro" role="alert">
          {erro}
        </p>
      )}

      <div className="registro-grade">
        <div className="registro-principal">
          <Cartao titulo="Solicitação" icone={<FileText size={16} />}>
            <p className="descricao-os">{os.descricao}</p>
            {gestao && !fechada && (
              <details className="dobra">
                <summary>Editar dados da OS</summary>
                <form action={acaoOsAction.bind(null, os.id)} className="form-ficha compacto">
                  <input type="hidden" name="acao" value="editar" />
                  <label>
                    Descrição
                    <textarea name="descricao" rows={3} defaultValue={os.descricao} maxLength={4000} />
                  </label>
                  <div className="dupla">
                    <label>
                      Prioridade
                      <select name="prioridade" defaultValue={os.prioridade}>
                        {Object.entries(PRIORIDADE_ROTULO).map(([v, r]) => (
                          <option key={v} value={v}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Prazo
                      <input type="datetime-local" name="prazoSla" defaultValue={relogioParaCampo(os.prazoSla)} />
                    </label>
                  </div>
                  <div className="ficha-acoes">
                    <button type="submit">Salvar</button>
                  </div>
                </form>
              </details>
            )}
          </Cartao>

          {!fechada && executa && (
            <Cartao titulo="Atendimento" icone={<PlayCircle size={16} />} destaque>
              <div className="botoes">
                {(os.status === "aberta" || os.status === "agendada") && (
                  <form action={acaoOsAction.bind(null, os.id)}>
                    <input type="hidden" name="acao" value="deslocamento" />
                    <button type="submit" className="botao secundario">
                      Saiu para o local
                    </button>
                  </form>
                )}
                {["aberta", "agendada", "em_deslocamento"].includes(os.status) && (
                  <form action={acaoOsAction.bind(null, os.id)}>
                    <input type="hidden" name="acao" value="iniciar" />
                    <button type="submit" className="botao">
                      Iniciar atendimento
                    </button>
                  </form>
                )}
                {os.status === "aguardando_peca" && (
                  <form action={acaoOsAction.bind(null, os.id)}>
                    <input type="hidden" name="acao" value="retomar" />
                    <button type="submit" className="botao">
                      Retomar atendimento
                    </button>
                  </form>
                )}
              </div>

              {(os.status === "em_andamento" || gestao) && (
                <details className="dobra" open={os.status === "em_andamento" && pendentes.length === 0}>
                  <summary>Concluir</summary>
                  {pendentes.length > 0 && (
                    <p className="nota alerta-nota">
                      {pendentes.length === 1 ? "Falta 1 item obrigatório" : `Faltam ${pendentes.length} itens obrigatórios`}{" "}
                      do checklist — a conclusão vai ser recusada até eles serem cumpridos.
                    </p>
                  )}
                  <form action={acaoOsAction.bind(null, os.id)} className="form-ficha compacto">
                    <input type="hidden" name="acao" value="concluir" />
                    <div className="linha-radios">
                      <label>
                        <input type="radio" name="resultado" value="resolvido" defaultChecked /> Resolvido
                      </label>
                      <label>
                        <input type="radio" name="resultado" value="nao_resolvido" /> Não resolvido — precisa voltar
                      </label>
                    </div>
                    <label>
                      Laudo técnico
                      <textarea
                        name="laudo"
                        rows={3}
                        defaultValue={os.laudo ?? ""}
                        placeholder="O que foi encontrado e o que foi feito. Obrigatório se não resolveu."
                        maxLength={8000}
                      />
                    </label>
                    <label>
                      Quem recebeu / assinou pelo cliente
                      <input type="text" name="assinaturaNome" defaultValue={os.assinaturaNome ?? ""} maxLength={200} />
                    </label>
                    <div className="ficha-acoes">
                      <button type="submit">Concluir OS</button>
                    </div>
                  </form>
                </details>
              )}

              {os.status === "em_andamento" && (
                <details className="dobra">
                  <summary>Pausar (aguardando peça ou cliente)</summary>
                  <FormMotivo osId={os.id} acao="pausar" motivos={MOTIVOS_PAUSA} botao="Pausar" />
                </details>
              )}
              {["agendada", "em_deslocamento", "em_andamento"].includes(os.status) && (
                <details className="dobra">
                  <summary>Não foi possível atender</summary>
                  <p className="nota">A OS volta para a fila “A agendar”, sem data, com o motivo no histórico.</p>
                  <FormMotivo osId={os.id} acao="nao_atendida" motivos={MOTIVOS_NAO_ATENDIDA} botao="Registrar" />
                </details>
              )}
              {gestao && (
                <details className="dobra">
                  <summary>Cancelar a OS</summary>
                  <FormMotivo osId={os.id} acao="cancelar" motivos={MOTIVOS_CANCELAMENTO} botao="Cancelar OS" perigo />
                </details>
              )}
            </Cartao>
          )}

          {fechada && (
            <Cartao
              titulo={os.status === "concluida" ? "Conclusão" : "Cancelada"}
              icone={<ListChecks size={16} />}
              acao={
                os.resultado ? (
                  <span className={`pilula ${os.resultado === "resolvido" ? "st-concluida" : "st-aguardando_peca"}`}>
                    {RESULTADO_ROTULO[os.resultado] ?? os.resultado}
                  </span>
                ) : null
              }
            >
              {os.laudo && <p className="descricao-os">{os.laudo}</p>}
              {os.status === "concluida" && (
                <dl className="campos">
                  <div>
                    <dt>Concluída</dt>
                    <dd>{formatarInstante(os.concluidaEm)}</dd>
                  </div>
                  {os.assinaturaNome && (
                    <div>
                      <dt>Recebido por</dt>
                      <dd>{os.assinaturaNome}</dd>
                    </div>
                  )}
                </dl>
              )}
              {os.retornos.length > 0 && (
                <p className="nota">
                  Retorno:{" "}
                  {os.retornos.map((r) => (
                    <Link key={r.id} href={`/os/${r.id}`}>
                      {numeroOs(r.numero)} ({STATUS_ROTULO[r.status]?.toLowerCase()})
                    </Link>
                  ))}
                </p>
              )}
              {gestao && (
                <div className="botoes">
                  {os.resultado === "nao_resolvido" && os.retornos.length === 0 && (
                    <form action={abrirRetornoAction.bind(null, os.id)}>
                      <button type="submit" className="botao">
                        Abrir OS de retorno
                      </button>
                    </form>
                  )}
                  <details className="dobra">
                    <summary>Reabrir</summary>
                    <FormMotivo osId={os.id} acao="reabrir" motivos={["Cliente reclamou", "Concluída por engano", "Outro"]} botao="Reabrir" />
                  </details>
                </div>
              )}
            </Cartao>
          )}

          <Cartao
            titulo="Checklist"
            icone={<ListChecks size={16} />}
            contador={
              obrigatorios.length
                ? `${obrigatorios.length - pendentes.length}/${obrigatorios.length} obrigatórios`
                : `${os.checklist.filter((i) => i.concluido).length}/${os.checklist.length}`
            }
            acao={
              os.checklist.length > 0 ? (
                <span className="progresso" aria-hidden>
                  <span style={{ width: `${progressoChecklist}%` }} />
                </span>
              ) : null
            }
          >
            {os.checklist.length === 0 ? (
              <p className="nota">Esta OS não tem checklist — o modelo do tipo dela está vazio.</p>
            ) : (
              secoes.map((secao) => (
                <div key={secao.nome} className="secao-checklist">
                  {secoes.length > 1 && <h3>{secao.nome}</h3>}
                  <ul className="itens-os">
                    {secao.itens.map((item) => (
                      <ItemChecklist
                        key={item.id}
                        osId={os.id}
                        item={item}
                        podeResponder={podeResponder}
                        podeRemoverDe={podeRemoverDe}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </Cartao>

          <Cartao id="anexos" titulo="Outras fotos e assinatura" icone={<Camera size={16} />} contador={avulsas.length + (assinatura ? 1 : 0)}>
            {avulsas.length === 0 && !assinatura && <p className="nota">Nenhum anexo fora do checklist.</p>}
            {(avulsas.length > 0 || assinatura) && (
              <div className="fotos-item">
                {[...avulsas, ...(assinatura ? [assinatura] : [])].map((a) => (
                  <figure key={a.id}>
                    <a href={`/os/anexo/${a.id}`} target="_blank" rel="noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element -- vem do Drive pelo proxy autenticado */}
                      <img src={`/os/anexo/${a.id}`} alt={a.categoria === "assinatura" ? "Assinatura do cliente" : "Foto"} loading="lazy" />
                    </a>
                    <figcaption>
                      {a.categoria === "assinatura" ? "Assinatura · " : ""}
                      {a.capturadoEm ? formatarInstante(a.capturadoEm, false) : ""}
                      {a.enviadoPor ? ` · ${a.enviadoPor.nome}` : ""}
                      {podeResponder && podeRemoverDe(a.enviadoPorId) && (
                        <form action={removerAnexoAction.bind(null, os.id, a.id)} className="form-mini">
                          <button type="submit" className="link-perigo">
                            tirar
                          </button>
                        </form>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            {podeResponder && (
              <form action={anexarAction.bind(null, os.id)} className="form-foto">
                <select name="categoria" defaultValue="foto" aria-label="Tipo de anexo">
                  <option value="foto">Foto</option>
                  <option value="assinatura">Assinatura do cliente (imagem)</option>
                  <option value="documento">Documento (PDF ou imagem)</option>
                </select>
                <input type="file" name="arquivo" accept="image/jpeg,image/png,application/pdf" multiple required />
                <button type="submit" className="botao secundario">
                  Enviar
                </button>
              </form>
            )}
          </Cartao>

          <Cartao id="relatorio" titulo="Relatório para o cliente" icone={<FileDown size={16} />}>
            <p className="nota">
              O PDF é gerado na hora, com as fotos, o checklist e a assinatura.
              {!fechada && " Enquanto a OS não é concluída, ele sai marcado como parcial."}
            </p>
            <div className="botoes">
              <a href={`/os/${os.id}/relatorio`} className="botao secundario" target="_blank" rel="noopener">
                Baixar PDF
              </a>
              {linkPublico && wa && (
                <a
                  href={`https://wa.me/${wa}?text=${encodeURIComponent(mensagemWa)}`}
                  className="botao"
                  target="_blank"
                  rel="noopener"
                >
                  Enviar pelo WhatsApp
                </a>
              )}
            </div>
            {linkPublico ? (
              <>
                <label className="link-publico">
                  Link do cliente (abre sem login)
                  <input type="text" readOnly value={linkPublico} />
                </label>
                {gestao && (
                  <form action={renovarLinkAction.bind(null, os.id)} className="form-mini">
                    <button type="submit" className="link-perigo">
                      gerar outro link (o atual para de abrir)
                    </button>
                  </form>
                )}
              </>
            ) : (
              <p className="nota">O link para mandar ao cliente é criado quando a OS é concluída.</p>
            )}
          </Cartao>

          <Cartao id="comentarios" titulo="Comentários" icone={<MessageSquare size={16} />} contador={comentarios.length || undefined}>
            {comentarios.length > 0 && (
              <ul className="comentarios">
                {comentarios.map((c) => (
                  <li key={c.id}>
                    <span className="autor">
                      {c.autor?.nome ?? "—"} · {formatarInstante(c.criadoEm, false)}
                    </span>
                    <span className="corpo">{c.texto}</span>
                  </li>
                ))}
              </ul>
            )}
            <form action={comentarOsAction.bind(null, os.id)} className="form-comentario">
              <textarea name="texto" rows={2} required maxLength={4000} placeholder="Recado para a equipe sobre esta OS" />
              <button type="submit" className="botao secundario">
                Comentar
              </button>
            </form>
          </Cartao>
        </div>

        <aside className="registro-lateral">
          <Cartao titulo="Cliente" icone={<UserRound size={16} />}>
            <Dados
              itens={[
                ["Nome", os.cliente.nome],
                [
                  "Telefone",
                  os.cliente.telefone ? (
                    <>
                      <a href={`tel:${soDigitos(os.cliente.telefone)}`}>{os.cliente.telefone}</a>
                      {wa && (
                        <>
                          {" · "}
                          <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener">
                            WhatsApp
                          </a>
                        </>
                      )}
                    </>
                  ) : null,
                ],
                [
                  "Endereço",
                  endereco ? (
                    <>
                      {endereco}
                      {mapaCliente && (
                        <>
                          {" · "}
                          <a href={mapaCliente} target="_blank" rel="noopener">
                            mapa
                          </a>
                        </>
                      )}
                    </>
                  ) : null,
                ],
                ["Usina", os.usina?.nome],
                [
                  "Venda",
                  os.projeto ? (
                    <>
                      <Link href={`/projeto/${os.projeto.id}`}>{os.projeto.titulo}</Link>
                      <span className="fraco"> · {os.projeto.etapa.nome}</span>
                    </>
                  ) : null,
                ],
              ]}
            />
          </Cartao>

          <Cartao titulo="Quem e quando" icone={<CalendarClock size={16} />}>
            <dl className="campos">
              <div>
                <dt>Responsável</dt>
                <dd className={os.responsavel ? "" : "fraco"}>{os.responsavel?.nome ?? "ninguém ainda"}</dd>
              </div>
              <div>
                <dt>Agendada</dt>
                <dd className={os.agendadaPara ? "" : "fraco"}>{os.agendadaPara ? formatarRelogio(os.agendadaPara) : "sem data"}</dd>
              </div>
              <div>
                <dt>Prazo</dt>
                <dd className={prazoVencido ? "ruim" : os.prazoSla ? "" : "fraco"}>
                  {os.prazoSla ? formatarRelogio(os.prazoSla) : "sem prazo"}
                  {prazoVencido ? " · vencido" : ""}
                </dd>
              </div>
              <div>
                <dt>Aberta</dt>
                <dd>
                  {formatarInstante(os.criadoEm, false)}
                  {os.abertaPor ? ` por ${os.abertaPor.nome}` : ""}
                  {os.origem === "alerta" ? " (alerta)" : os.origem === "cliente" ? " (pedido do cliente)" : ""}
                </dd>
              </div>
              {os.osOrigem && (
                <div>
                  <dt>Retorno de</dt>
                  <dd>
                    <Link href={`/os/${os.osOrigem.id}`}>{numeroOs(os.osOrigem.numero)}</Link>
                  </dd>
                </div>
              )}
            </dl>

            {gestao && !fechada && (
              <>
                <details className="dobra">
                  <summary>{os.responsavel ? "Trocar responsável" : "Definir responsável"}</summary>
                  <form action={acaoOsAction.bind(null, os.id)} className="form-acao">
                    <input type="hidden" name="acao" value="atribuir" />
                    <select name="responsavelId" defaultValue={os.responsavel?.id ?? ""}>
                      <option value="">Ninguém</option>
                      {pessoas.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nome} ({PAPEL[u.papel] ?? u.papel})
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="botao secundario">
                      Salvar
                    </button>
                  </form>
                </details>
                {["aberta", "agendada", "aguardando_peca"].includes(os.status) && (
                  <details className="dobra" open={os.status === "aberta" && !os.agendadaPara}>
                    <summary>{os.agendadaPara ? "Reagendar" : "Agendar"}</summary>
                    <form action={acaoOsAction.bind(null, os.id)} className="form-acao">
                      <input type="hidden" name="acao" value="agendar" />
                      <input type="datetime-local" name="agendadaPara" defaultValue={relogioParaCampo(os.agendadaPara)} required />
                      {os.agendadaPara && (
                        <>
                          <select name="motivo" required defaultValue="">
                            <option value="" disabled>
                              Motivo do reagendamento…
                            </option>
                            {MOTIVOS_REAGENDAMENTO.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <input type="text" name="motivoDetalhe" placeholder="Detalhe (obrigatório em “Outro”)" maxLength={400} />
                        </>
                      )}
                      <button type="submit" className="botao secundario">
                        Salvar
                      </button>
                    </form>
                  </details>
                )}
              </>
            )}
          </Cartao>

          <Cartao titulo="Em campo" icone={<MapPinned size={16} />}>
            <dl className="campos">
              <div>
                <dt>Chegada</dt>
                <dd className={chegada ? "" : "fraco"}>
                  {chegada ? formatarInstante(chegada.ocorridoEm, false) : "—"}
                  {chegada?.latitude && chegada.longitude && (
                    <>
                      {" · "}
                      <a href={`https://www.google.com/maps?q=${chegada.latitude},${chegada.longitude}`} target="_blank" rel="noopener">
                        onde
                      </a>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Conclusão</dt>
                <dd className={os.concluidaEm ? "" : "fraco"}>{os.concluidaEm ? formatarInstante(os.concluidaEm, false) : "—"}</dd>
              </div>
              <div>
                <dt>Tempo</dt>
                <dd className={tempo.ms ? "" : "fraco"}>{tempo.ms ? formatarDuracao(tempo.ms) : "—"}</dd>
              </div>
            </dl>
          </Cartao>

          {mostrarTrajeto && (
            <Cartao id="trajeto" titulo="Trajeto" icone={<Route size={16} />}>
              <Trajeto osId={os.id} status={os.status} tecnico={os.responsavel?.nome ?? null} aoVivo={gestao} />
            </Cartao>
          )}

          <Cartao titulo="Histórico" icone={<History size={16} />}>
            <Historico eventos={os.eventos} />
          </Cartao>
        </aside>
      </div>
    </main>
  );
}
