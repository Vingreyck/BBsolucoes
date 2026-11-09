import { headers } from "next/headers";
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileDown,
  FileText,
  History,
  Link2,
  ListChecks,
  MapPinned,
  MessageCircle,
  MessageSquare,
  Navigation,
  PauseCircle,
  Pencil,
  Phone,
  PlayCircle,
  RotateCcw,
  Route,
  UserRound,
  UserX,
  XCircle,
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
  agendarOsAction,
  agendarVisitaDeVoltaAction,
  anexarAction,
  comentarOsAction,
  removerAnexoAction,
  renovarLinkAction,
} from "../actions";
import { Cabecalho, Caminho, Cartao, Dados } from "../../_ui";
import { iniciais } from "../../formatar";
import { BotaoDialogo, MenuAcoes, type AcaoDoMenu } from "./acoes";
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
    // Quem pode voltar na visita de volta também precisa da lista, mesmo sem ser gestão.
    ator.gestao || os.checklist.some((i) => i.agendar) ? responsaveisPossiveis(ator.empresaId) : Promise.resolve([]),
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
  // Itens deixados para a visita de volta, e se ela já foi aberta.
  const deixados = os.checklist.filter((i) => i.agendar);
  const visitaAberta = os.retornos.some((r) => r.descricao.startsWith("Visita de volta"));
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

  // Toda resposta do servidor (feito ou recusado) faz o menu e as janelinhas
  // nascerem de novo: a janelinha aberta fecha e a mensagem aparece.
  const chave = `${os.status}|${os.eventos.length}|${ok ?? ""}|${erro ?? ""}`;
  const ultimaPausa = [...os.eventos].reverse().find((e) => e.tipo === "pausada");
  const motivoPausa = ((ultimaPausa?.dados ?? {}) as { motivo?: string }).motivo;

  const formEditar = (
    <form action={acaoOsAction.bind(null, os.id)} className="form-ficha compacto">
      <input type="hidden" name="acao" value="editar" />
      <label>
        Descrição
        <textarea name="descricao" rows={4} defaultValue={os.descricao} maxLength={4000} />
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
  );

  const formResponsavel = (
    <form action={acaoOsAction.bind(null, os.id)} className="form-ficha compacto">
      <input type="hidden" name="acao" value="atribuir" />
      <label>
        Quem atende
        <select name="responsavelId" defaultValue={os.responsavel?.id ?? ""}>
          <option value="">Ninguém</option>
          {pessoas.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome} ({PAPEL[u.papel] ?? u.papel})
            </option>
          ))}
        </select>
      </label>
      <div className="ficha-acoes">
        <button type="submit">Salvar</button>
      </div>
    </form>
  );

  /** Agendar e reagendar: quem vai e quando, e o motivo quando já havia data. */
  const formAgendar = (
    <form action={agendarOsAction.bind(null, os.id)} className="form-agendar">
      {gestao && (
        <label className="entrada">
          <span className="entrada-rotulo">Quem vai</span>
          <select name="responsavelId" defaultValue={os.responsavel?.id ?? ""}>
            <option value="">Ninguém ainda</option>
            {pessoas.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome} ({PAPEL[u.papel] ?? u.papel})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="entrada">
        <span className="entrada-rotulo">Dia e hora</span>
        <input type="datetime-local" name="agendadaPara" defaultValue={relogioParaCampo(os.agendadaPara)} required />
      </label>
      {os.agendadaPara && (
        <>
          <label className="entrada">
            <span className="entrada-rotulo">Motivo do reagendamento</span>
            <select name="motivo" required defaultValue="">
              <option value="" disabled>
                Escolha…
              </option>
              {MOTIVOS_REAGENDAMENTO.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="entrada">
            <span className="entrada-rotulo">
              Detalhe <span className="entrada-opcional">(obrigatório em “Outro”)</span>
            </span>
            <input type="text" name="motivoDetalhe" maxLength={400} />
          </label>
        </>
      )}
      <button type="submit" className="botao">
        <CalendarClock size={15} aria-hidden /> {os.agendadaPara ? "Reagendar" : "Agendar"}
      </button>
    </form>
  );

  const formConcluir = (
    <form action={acaoOsAction.bind(null, os.id)} className="form-ficha compacto">
      <input type="hidden" name="acao" value="concluir" />
      {pendentes.length > 0 && (
        <p className="nota alerta-nota">
          {pendentes.length === 1 ? "Falta 1 item obrigatório" : `Faltam ${pendentes.length} itens obrigatórios`} do
          checklist — a conclusão vai ser recusada até eles serem cumpridos.
        </p>
      )}
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
          rows={4}
          defaultValue={os.laudo ?? ""}
          placeholder="O que foi encontrado e o que foi feito. Obrigatório se não resolveu."
          maxLength={8000}
        />
      </label>
      <label>
        Quem recebeu / assinou pelo cliente
        <input type="text" name="assinaturaNome" defaultValue={os.assinaturaNome ?? ""} maxLength={200} />
      </label>
      {deixados.length > 0 && (
        <CamposVisitaDeVolta
          deixados={deixados.map((i) => i.descricao)}
          pessoas={pessoas}
          padrao={os.responsavelId}
          obrigatorio={false}
        />
      )}
      <div className="ficha-acoes">
        <button type="submit">Concluir OS</button>
      </div>
    </form>
  );

  // O que não é o próximo passo: secundário ou perigoso, no menu "Mais".
  const maisAcoes: AcaoDoMenu[] = [];
  if (gestao && !fechada) {
    maisAcoes.push({
      id: "editar",
      rotulo: "Editar descrição, prioridade e prazo",
      icone: <Pencil size={15} aria-hidden />,
      titulo: "Editar dados da OS",
      conteudo: formEditar,
    });
    maisAcoes.push({
      id: "responsavel",
      rotulo: os.responsavel ? "Trocar responsável" : "Definir responsável",
      icone: <UserRound size={15} aria-hidden />,
      titulo: os.responsavel ? "Trocar responsável" : "Definir responsável",
      descricao: "Quem recebe o aviso no app e aparece na agenda.",
      conteudo: formResponsavel,
    });
  }
  if (gestao && (os.status === "agendada" || os.status === "aguardando_peca")) {
    maisAcoes.push({
      id: "reagendar",
      rotulo: "Reagendar",
      icone: <CalendarClock size={15} aria-hidden />,
      titulo: "Reagendar",
      descricao: "O responsável recebe o aviso da nova data.",
      conteudo: formAgendar,
    });
  }
  if (executa && os.status === "em_andamento") {
    maisAcoes.push({
      id: "pausar",
      rotulo: "Pausar (aguardando peça ou cliente)",
      icone: <PauseCircle size={15} aria-hidden />,
      titulo: "Pausar o atendimento",
      descricao: "A OS fica parada até alguém retomar. O motivo vai para o histórico.",
      conteudo: <FormMotivo osId={os.id} acao="pausar" motivos={MOTIVOS_PAUSA} botao="Pausar" />,
    });
  }
  if (executa && ["agendada", "em_deslocamento", "em_andamento"].includes(os.status)) {
    maisAcoes.push({
      id: "nao_atendida",
      rotulo: "Não foi possível atender",
      icone: <UserX size={15} aria-hidden />,
      titulo: "Não foi possível atender",
      descricao: "A OS volta para a fila “A agendar”, sem data, com o motivo no histórico.",
      conteudo: <FormMotivo osId={os.id} acao="nao_atendida" motivos={MOTIVOS_NAO_ATENDIDA} botao="Registrar" />,
    });
  }
  if (gestao && linkPublico) {
    maisAcoes.push({
      id: "novo_link",
      rotulo: "Gerar outro link do relatório",
      icone: <Link2 size={15} aria-hidden />,
      titulo: "Gerar outro link do relatório",
      descricao: "O link atual para de abrir. Use se ele foi parar com quem não devia.",
      conteudo: (
        <form action={renovarLinkAction.bind(null, os.id)} className="ficha-acoes">
          <button type="submit">Gerar outro link</button>
        </form>
      ),
    });
  }
  if (gestao && fechada) {
    maisAcoes.push({
      id: "reabrir",
      rotulo: "Reabrir a OS",
      icone: <RotateCcw size={15} aria-hidden />,
      titulo: "Reabrir a OS",
      conteudo: (
        <FormMotivo osId={os.id} acao="reabrir" motivos={["Cliente reclamou", "Concluída por engano", "Outro"]} botao="Reabrir" />
      ),
    });
  }
  if (gestao && !fechada) {
    maisAcoes.push({
      id: "cancelar",
      rotulo: "Cancelar a OS",
      icone: <XCircle size={15} aria-hidden />,
      perigo: true,
      titulo: "Cancelar a OS",
      descricao: "A OS sai da agenda e da fila. Dá para reabrir depois, com motivo.",
      conteudo: <FormMotivo osId={os.id} acao="cancelar" motivos={MOTIVOS_CANCELAMENTO} botao="Cancelar OS" perigo />,
    });
  }

  return (
    <main className="registro registro-os">
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
          </>
        }
        acoes={
          <>
            <a href={`/os/${os.id}/relatorio`} className="botao secundario" target="_blank" rel="noopener">
              <FileDown size={15} aria-hidden /> PDF
            </a>
            <MenuAcoes key={chave} acoes={maisAcoes} />
          </>
        }
      />

      <div className="faixa-caminho">
        {os.status !== "cancelada" && <Caminho etapas={PASSOS} atual={passoAtual} rotuloAtual="situação atual" />}
      </div>

      {ok && <p className="aviso ok">{ok}</p>}
      {erro && (
        <p className="aviso erro" role="alert">
          {erro}
        </p>
      )}

      {/* O próximo passo: uma ação principal, a que a situação da OS pede agora. */}
      <section className={`agora agora-${os.status}`} aria-labelledby="agora-titulo" key={`agora-${chave}`}>
        <span className="agora-icone" aria-hidden>
          {os.status === "aberta" ? (
            <CalendarClock size={20} />
          ) : os.status === "agendada" ? (
            <Navigation size={20} />
          ) : os.status === "em_deslocamento" ? (
            <MapPinned size={20} />
          ) : os.status === "em_andamento" ? (
            <PlayCircle size={20} />
          ) : os.status === "aguardando_peca" ? (
            <PauseCircle size={20} />
          ) : os.status === "concluida" ? (
            <CheckCircle2 size={20} />
          ) : (
            <XCircle size={20} />
          )}
        </span>

        <div className="agora-texto">
          <span className="agora-rotulo">Agora</span>
          {os.status === "aberta" && (
            <>
              <h2 id="agora-titulo">{gestao ? "Agende o atendimento" : "Esperando o escritório agendar"}</h2>
              <p>
                {gestao
                  ? "Escolha quem vai e quando. A pessoa recebe o aviso no app e a OS entra na agenda."
                  : "Se já for atender, marque a saída ou comece o atendimento."}
                {prazoVencido && <strong className="texto-perigo"> O prazo já venceu.</strong>}
              </p>
            </>
          )}
          {os.status === "agendada" && (
            <>
              <h2 id="agora-titulo">
                Agendada para {os.agendadaPara ? formatarRelogio(os.agendadaPara) : "—"}
                {os.responsavel ? ` com ${os.responsavel.nome.split(" ")[0]}` : ""}
              </h2>
              <p>Ao sair para o cliente, marque a saída: ele acompanha a chegada e o tempo de deslocamento fica registrado.</p>
            </>
          )}
          {os.status === "em_deslocamento" && (
            <>
              <h2 id="agora-titulo">A caminho do cliente</h2>
              <p>Ao chegar, comece o atendimento. A chegada fica marcada com a hora e o lugar.</p>
            </>
          )}
          {os.status === "em_andamento" && (
            <>
              <h2 id="agora-titulo">
                Em atendimento{tempo.ms ? ` há ${formatarDuracao(tempo.ms)}` : ""}
              </h2>
              <p>
                {os.checklist.length === 0
                  ? "Quando terminar, conclua com o laudo e o nome de quem recebeu."
                  : pendentes.length === 0
                    ? "Checklist completo. Falta concluir com o laudo e o nome de quem recebeu."
                    : `Faltam ${pendentes.length} ${pendentes.length === 1 ? "item obrigatório" : "itens obrigatórios"} do checklist antes de concluir.`}
              </p>
              {os.checklist.length > 0 && (
                <span className="agora-progresso" title={`${feitos} de ${obrigatorios.length || os.checklist.length}`}>
                  <span className="progresso-trilho">
                    <span style={{ width: `${progressoChecklist}%` }} />
                  </span>
                  <span>
                    {feitos}/{obrigatorios.length || os.checklist.length} {obrigatorios.length ? "obrigatórios" : "itens"}
                  </span>
                </span>
              )}
            </>
          )}
          {os.status === "aguardando_peca" && (
            <>
              <h2 id="agora-titulo">Pausada</h2>
              <p>{motivoPausa ? `Motivo: ${motivoPausa}.` : "Aguardando peça ou o cliente."} Quando der para seguir, retome.</p>
            </>
          )}
          {os.status === "concluida" && (
            <>
              <h2 id="agora-titulo">
                Concluída {os.concluidaEm ? `em ${formatarInstante(os.concluidaEm, false)}` : ""}
                {os.resultado && (
                  <span className={`pilula ${os.resultado === "resolvido" ? "st-concluida" : "st-aguardando_peca"}`}>
                    {RESULTADO_ROTULO[os.resultado] ?? os.resultado}
                  </span>
                )}
              </h2>
              <p>
                {os.assinaturaNome ? `Recebido por ${os.assinaturaNome}. ` : ""}
                {linkPublico ? "Mande o relatório para o cliente: ele abre o link sem precisar de login." : ""}
              </p>
              {os.laudo && <p className="agora-laudo">{os.laudo}</p>}
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
            </>
          )}
          {os.status === "cancelada" && (
            <>
              <h2 id="agora-titulo">Cancelada</h2>
              <p>Esta OS não está mais na agenda nem na fila. O motivo está no histórico.</p>
            </>
          )}
        </div>

        <div className="agora-acoes">
          {os.status === "aberta" && gestao && formAgendar}
          {os.status === "aberta" && !gestao && executa && (
            <>
              <form action={acaoOsAction.bind(null, os.id)}>
                <input type="hidden" name="acao" value="iniciar" />
                <button type="submit" className="botao">
                  <PlayCircle size={15} aria-hidden /> Iniciar atendimento
                </button>
              </form>
              <form action={acaoOsAction.bind(null, os.id)}>
                <input type="hidden" name="acao" value="deslocamento" />
                <button type="submit" className="botao secundario">
                  Saiu para o local
                </button>
              </form>
            </>
          )}
          {os.status === "agendada" && executa && (
            <>
              <form action={acaoOsAction.bind(null, os.id)}>
                <input type="hidden" name="acao" value="deslocamento" />
                <button type="submit" className="botao">
                  <Navigation size={15} aria-hidden /> Saiu para o local
                </button>
              </form>
              <form action={acaoOsAction.bind(null, os.id)}>
                <input type="hidden" name="acao" value="iniciar" />
                <button type="submit" className="botao secundario">
                  Já estou lá: iniciar
                </button>
              </form>
            </>
          )}
          {os.status === "em_deslocamento" && executa && (
            <form action={acaoOsAction.bind(null, os.id)}>
              <input type="hidden" name="acao" value="iniciar" />
              <button type="submit" className="botao">
                <MapPinned size={15} aria-hidden /> Cheguei: iniciar atendimento
              </button>
            </form>
          )}
          {os.status === "em_andamento" && executa && (
            <>
              <BotaoDialogo
                key={`concluir-${chave}`}
                rotulo="Concluir OS"
                icone={<CheckCircle2 size={15} aria-hidden />}
                classe="botao"
                titulo="Concluir a OS"
                descricao="O laudo e o nome de quem recebeu vão para o relatório do cliente."
              >
                {formConcluir}
              </BotaoDialogo>
              {pendentes.length > 0 && (
                <a href="#checklist" className="botao secundario">
                  <ListChecks size={15} aria-hidden /> Ver o que falta
                </a>
              )}
            </>
          )}
          {os.status === "aguardando_peca" && executa && (
            <form action={acaoOsAction.bind(null, os.id)}>
              <input type="hidden" name="acao" value="retomar" />
              <button type="submit" className="botao">
                <PlayCircle size={15} aria-hidden /> Retomar atendimento
              </button>
            </form>
          )}
          {os.status === "concluida" && (
            <>
              {linkPublico && wa && (
                <a
                  href={`https://wa.me/${wa}?text=${encodeURIComponent(mensagemWa)}`}
                  className="botao botao-whatsapp"
                  target="_blank"
                  rel="noopener"
                >
                  <MessageCircle size={15} aria-hidden /> Enviar relatório pelo WhatsApp
                </a>
              )}
              <a href={`/os/${os.id}/relatorio`} className="botao secundario" target="_blank" rel="noopener">
                <FileDown size={15} aria-hidden /> Baixar PDF
              </a>
              {gestao && os.resultado === "nao_resolvido" && os.retornos.length === 0 && (
                <form action={abrirRetornoAction.bind(null, os.id)}>
                  <button type="submit" className="botao secundario">
                    Abrir OS de retorno
                  </button>
                </form>
              )}
            </>
          )}
          {os.status === "cancelada" && gestao && (
            <BotaoDialogo key={`reabrir-${chave}`} rotulo="Reabrir" icone={<RotateCcw size={15} aria-hidden />} titulo="Reabrir a OS">
              <FormMotivo osId={os.id} acao="reabrir" motivos={["Cliente reclamou", "Concluída por engano", "Outro"]} botao="Reabrir" />
            </BotaoDialogo>
          )}
        </div>
      </section>

      {gestao && os.status === "concluida" && deixados.length > 0 && !visitaAberta && (
        <div className="registro-aviso">
          <Cartao titulo="Visita de volta" icone={<CalendarClock size={16} />} destaque>
            <form action={agendarVisitaDeVoltaAction.bind(null, os.id)} className="form-ficha compacto">
              <CamposVisitaDeVolta
                deixados={deixados.map((i) => i.descricao)}
                pessoas={pessoas}
                padrao={os.responsavelId}
                obrigatorio
              />
              <div className="ficha-acoes">
                <button type="submit">Abrir a visita de volta</button>
              </div>
            </form>
          </Cartao>
        </div>
      )}

      <div className="registro-grade">
        <div className="registro-principal">
          <Cartao titulo="Solicitação" icone={<FileText size={16} />}>
            <p className="descricao-os">{os.descricao}</p>
          </Cartao>

          <Cartao
            id="checklist"
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
                      <ItemChecklist key={item.id} osId={os.id} item={item} podeResponder={podeResponder} podeRemoverDe={podeRemoverDe} />
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
            <div className="cliente-os">
              <strong className="cliente-os-nome">{os.cliente.nome}</strong>
              {endereco && <span className="cliente-os-endereco">{endereco}</span>}
              {(os.cliente.telefone || mapaCliente) && (
                <div className="cliente-os-contato">
                  {os.cliente.telefone && (
                    <a href={`tel:${soDigitos(os.cliente.telefone)}`} className="botao secundario" title={os.cliente.telefone}>
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
                </div>
              )}
            </div>
          </Cartao>

          <Cartao titulo="Detalhes" icone={<ClipboardList size={16} />}>
            <Dados
              itens={[
                [
                  "Responsável",
                  os.responsavel ? (
                    <span className="meta-pessoa">
                      <span className="avatar-mini" aria-hidden>
                        {iniciais(os.responsavel.nome)}
                      </span>
                      {os.responsavel.nome}
                    </span>
                  ) : (
                    <span className="texto-atencao">ninguém ainda</span>
                  ),
                ],
                ["Agendada", os.agendadaPara ? formatarRelogio(os.agendadaPara) : null],
                [
                  "Prazo",
                  os.prazoSla ? (
                    <span className={prazoVencido ? "texto-perigo" : undefined}>
                      {formatarRelogio(os.prazoSla)}
                      {prazoVencido ? " · vencido" : ""}
                    </span>
                  ) : null,
                ],
                ["Telefone", os.cliente.telefone],
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
                [
                  "Aberta",
                  <>
                    {formatarInstante(os.criadoEm, false)}
                    {os.abertaPor ? ` por ${os.abertaPor.nome}` : ""}
                    {os.origem === "alerta" ? " (alerta)" : os.origem === "cliente" ? " (pedido do cliente)" : ""}
                  </>,
                ],
                ["Retorno de", os.osOrigem ? <Link href={`/os/${os.osOrigem.id}`}>{numeroOs(os.osOrigem.numero)}</Link> : null],
              ]}
            />
          </Cartao>

          {(chegada || os.concluidaEm || tempo.ms > 0) && (
            <Cartao titulo="Em campo" icone={<MapPinned size={16} />}>
              <Dados
                itens={[
                  [
                    "Chegada",
                    chegada ? (
                      <>
                        {formatarInstante(chegada.ocorridoEm, false)}
                        {chegada.latitude && chegada.longitude && (
                          <>
                            {" · "}
                            <a href={`https://www.google.com/maps?q=${chegada.latitude},${chegada.longitude}`} target="_blank" rel="noopener">
                              onde
                            </a>
                          </>
                        )}
                      </>
                    ) : null,
                  ],
                  ["Conclusão", os.concluidaEm ? formatarInstante(os.concluidaEm, false) : null],
                  ["Tempo", tempo.ms ? formatarDuracao(tempo.ms) : null],
                ]}
              />
            </Cartao>
          )}

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

/**
 * Quem volta e quando, para os itens deixados para a visita de volta. Na
 * conclusão é opcional (sem escolher, a OS conclui e o escritório agenda
 * depois); depois de concluída, é o que abre a OS nova.
 */
function CamposVisitaDeVolta({
  deixados,
  pessoas,
  padrao,
  obrigatorio,
}: {
  deixados: string[];
  pessoas: { id: string; nome: string }[];
  padrao: string | null;
  obrigatorio: boolean;
}) {
  return (
    <fieldset className="visita-de-volta">
      <legend>
        Visita de volta · {deixados.length} {deixados.length === 1 ? "item ficou" : "itens ficaram"} para depois
      </legend>
      <p className="nota">{deixados.join(" · ")}</p>
      <label>
        Quem volta
        <select name="voltaResponsavelId" defaultValue={obrigatorio ? (padrao ?? "") : ""} required={obrigatorio}>
          <option value="">{obrigatorio ? "Escolha…" : "Decidir depois (o escritório agenda)"}</option>
          {pessoas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>
      <label>
        Dia (opcional)
        <input type="date" name="voltaDia" />
      </label>
    </fieldset>
  );
}
