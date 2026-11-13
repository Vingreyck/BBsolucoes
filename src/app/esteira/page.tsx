import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileCheck2,
  FileClock,
  FolderOpen,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wrench,
} from "lucide-react";
import Link from "next/link";

import { podeVerDocumentos } from "@/auth/permissao";
import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { numeroWhatsapp } from "@/documentos/cobranca";
import { ROTULO_DOCUMENTO } from "@/documentos/rotulos";
import { liberaOsDeInstalacao, tomDaFase, vigente, type FaseEnergisa } from "@/energisa/situacoes";
import { ehGestaoWeb } from "@/os/acesso";
import { quemUsaOApp } from "@/os/consultas";
import { formatarRelogio } from "@/os/relogio";
import { encerrada, numeroOs, STATUS_ROTULO, TIPO_ROTULO } from "@/os/tipos";
import { dadosTecnicosDosProjetos } from "@/projeto/aproveitar-vistoria";
import { situacaoDosDocumentos } from "@/projeto/automatico";
import { faltaParaOProjeto } from "@/projeto/da-vistoria";
import { diasCorridos, fraseDoTempo, rotuloDoTempo } from "@/projeto/tempo";
import { sugestaoDeEquipamentos } from "@/projeto/kit";
import { entradaDe, representantesDaEmpresa, ultimosContratos } from "@/projeto/contrato-dados";

import { Ajuda, Cabecalho } from "../_ui";
import { BotaoDialogo } from "../_ui/dialogo";
import { moverProjeto } from "../actions";
import { iniciais, kWp, semAcento } from "../formatar";
import { origemDoSite } from "../origem";
import { aprovarProposta, gerarOsInstalacao, reprovarProposta } from "./actions";
import { AcoesDoContrato } from "./contrato";
import { PedirDadosDoCliente } from "./pedir-dados";
import { ColunaEsteira, QuadroEsteira } from "./quadro";

/** Lê do banco a cada request — nada aqui é estático. */
export const dynamic = "force-dynamic";

const PAPEL_ROTULO: Record<string, string> = {
  adm: "ADM",
  vendedor: "Vendedor",
  engenheiro: "Engenheiro",
  tecnico: "Técnico",
  estoque: "Estoque",
};

/** Acima disto o cartão acende. Provisório: o número certo sai do histórico real. */
const DIAS_ATENCAO = 15;

function diasDesde(data: Date): number {
  return Math.floor((Date.now() - data.getTime()) / 86_400_000);
}

const TOM_ENERGISA: Record<string, string> = { ok: "sev-info", ruim: "sev-critico", espera: "sev-atencao", neutro: "" };

const SITUACAO_ROTULO: Record<string, string> = { pausado: "pausado", cancelado: "cancelado" };

export default async function Esteira({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string; os?: string }>;
}) {
  const usuario = await exigirUsuario();
  const { ok, erro, os: osFeita } = await searchParams;
  const gestao = ehGestaoWeb(usuario.papel);

  // Tudo pela empresa de quem está olhando: o quadro de uma empresa nunca
  // pode mostrar etapa ou projeto de outra.
  const [etapas, projetos, daEnergisa] = await Promise.all([
    db.query.etapa.findMany({
      where: and(eq(schema.etapa.empresaId, usuario.empresaId), eq(schema.etapa.ativa, true)),
      orderBy: asc(schema.etapa.ordem),
    }),
    db.query.projeto.findMany({
      where: eq(schema.projeto.empresaId, usuario.empresaId),
      with: { cliente: true, responsavel: true },
    }),
    /**
     * A situação de cada projeto no portal da Energisa, lida pela extensão
     * (`/energisa`). Na etapa 9, a aprovação libera o botão da OS de
     * instalação; a OS que já existe aparece no lugar do botão.
     */
    db.query.energisaProjeto.findMany({
      where: and(eq(schema.energisaProjeto.empresaId, usuario.empresaId), isNotNull(schema.energisaProjeto.projetoId)),
    }),
  ]);

  const entradasPorProjeto = new Map<string, typeof daEnergisa>();
  for (const en of daEnergisa) {
    const lista = entradasPorProjeto.get(en.projetoId!) ?? [];
    lista.push(en);
    entradasPorProjeto.set(en.projetoId!, lista);
  }
  const energisa = new Map(
    [...entradasPorProjeto].map(([id, lista]) => [id, vigente(lista.map((en) => ({ ...en, fase: en.fase as FaseEnergisa })))]),
  );
  /**
   * As OS dos projetos em aberto, numa consulta só. Delas saem:
   * - o aviso no cartão com a OS do projeto e o estado dela (aberta, agendada,
   *   em andamento, concluída…), para ninguém precisar abrir a OS para saber;
   * - a OS de instalação aberta, que troca o botão "Gerar OS de instalação";
   * - a OS de vistoria aberta, que troca o botão "Criar OS de vistoria" (sobra
   *   quando alguém voltou o projeto com a seta).
   */
  const idsAbertos = projetos.filter((p) => p.situacao !== "concluido").map((p) => p.id);
  const ordensDosProjetos = idsAbertos.length
    ? await db
        .select({
          id: schema.ordemServico.id,
          numero: schema.ordemServico.numero,
          projetoId: schema.ordemServico.projetoId,
          tipo: schema.ordemServico.tipo,
          status: schema.ordemServico.status,
          agendadaPara: schema.ordemServico.agendadaPara,
          criadoEm: schema.ordemServico.criadoEm,
        })
        .from(schema.ordemServico)
        .where(and(eq(schema.ordemServico.empresaId, usuario.empresaId), inArray(schema.ordemServico.projetoId, idsAbertos)))
        .orderBy(desc(schema.ordemServico.criadoEm))
    : [];
  type OsDoCartao = (typeof ordensDosProjetos)[number];
  const aberta = (o: OsDoCartao) => !encerrada(o.status);
  const osInstalacao = new Map<string, OsDoCartao>();
  const osVistoria = new Map<string, OsDoCartao>();
  const osDoCartao = new Map<string, OsDoCartao>();
  for (const o of ordensDosProjetos) {
    if (!o.projetoId) continue;
    if (aberta(o) && o.tipo === "instalacao" && !osInstalacao.has(o.projetoId)) osInstalacao.set(o.projetoId, o);
    if (aberta(o) && o.tipo === "vistoria" && !osVistoria.has(o.projetoId)) osVistoria.set(o.projetoId, o);
    // A aberta mais nova; sem nenhuma aberta, a última que existiu.
    const atual = osDoCartao.get(o.projetoId);
    if (!atual || (aberta(o) && !aberta(atual))) osDoCartao.set(o.projetoId, o);
  }

  /**
   * Etapas de documentos e de contrato: o que falta em cada cartão, o último
   * contrato gerado e quem pode assinar pela empresa.
   */
  const etapaPorId = new Map(etapas.map((e) => [e.id, e]));
  const naPapelada = projetos
    .filter((p) => p.situacao === "em_andamento" && ["documentacao", "contrato"].includes(etapaPorId.get(p.etapaId)?.slug ?? ""))
    .map((p) => ({ ...p, etapa: etapaPorId.get(p.etapaId)! }));
  const noContrato = naPapelada.filter((p) => p.etapa.slug === "contrato").map((p) => p.id);
  const [papelada, contratos, empresaDados, representantes, podeDocs, origemSite, catalogo] = await Promise.all([
    situacaoDosDocumentos(usuario.empresaId, naPapelada),
    ultimosContratos(usuario.empresaId, noContrato),
    naPapelada.length
      ? db.query.empresa.findFirst({
          where: eq(schema.empresa.id, usuario.empresaId),
          columns: { nome: true, razaoSocial: true, cnpj: true, endereco: true, email: true },
        })
      : null,
    noContrato.length && gestao ? representantesDaEmpresa(usuario.empresaId) : [],
    podeVerDocumentos(usuario.empresaId, usuario.papel),
    noContrato.length ? origemDoSite() : "",
    // O catálogo é pequeno: uma ida só serve a todos os cartões, para sugerir o
    // texto de equipamentos do contrato (kit + telhado da vistoria).
    noContrato.length
      ? db.select().from(schema.modeloEquipamento).where(eq(schema.modeloEquipamento.empresaId, usuario.empresaId))
      : [],
  ]);

  /**
   * Na etapa Projeto, o engenheiro precisa saber de relance se a vistoria trouxe
   * o que ele precisa (disjuntor, bitola, telhado, área útil…) ou se falta algo.
   */
  const noProjeto = projetos
    .filter((p) => p.situacao === "em_andamento" && etapaPorId.get(p.etapaId)?.slug === "projeto")
    .map((p) => p.id);
  const tecnicosDosProjetos = await dadosTecnicosDosProjetos(usuario.empresaId, noProjeto);

  if (etapas.length === 0) {
    return (
      <main>
        <header className="topo">
          <h1>Esteira de projetos</h1>
        </header>
        <div className="vazio">
          <p>
            Nenhuma etapa cadastrada ainda. Rode <code>npm run db:seed</code> para
            criar a empresa, as 12 etapas do fluxo e alguns projetos de exemplo.
          </p>
        </div>
      </main>
    );
  }

  /**
   * O quadro mostra trabalho em aberto.
   *
   * Quando os 171 dossiês do Drive entraram, 68 deles vieram concluídos — obra
   * entregue, usina gerando. Empilhar isso na coluna de Monitoramento
   * transformaria o quadro num arquivo morto: quem abre a esteira quer ver o
   * que está na mão de alguém hoje.
   */
  const abertos = projetos
    .filter((p) => p.situacao !== "concluido")
    // os mais antigos na etapa primeiro: são os que pedem alguém
    .sort((a, b) => a.etapaDesde.getTime() - b.etapaDesde.getTime());
  const concluidos = projetos.length - abertos.length;

  const nivelDe = (p: (typeof projetos)[number]) => {
    const estourou = p.prazoEtapa !== null && p.prazoEtapa.getTime() < Date.now();
    return estourou ? "critico" : diasDesde(p.etapaDesde) >= DIAS_ATENCAO ? "atencao" : "normal";
  };

  const porEtapa = new Map<string, typeof projetos>();
  for (const p of abertos) {
    const lista = porEtapa.get(p.etapaId) ?? [];
    lista.push(p);
    porEtapa.set(p.etapaId, lista);
  }

  const parados = abertos.filter((p) => p.situacao === "em_andamento" && nivelDe(p) !== "normal").length;
  const meus = abertos.filter((p) => p.responsavelId === usuario.id).length;
  // Quem pode receber a OS de instalação: só quem usa o app (a OS chega pelo celular).
  const tecnicos = gestao && energisa.size ? await quemUsaOApp(usuario.empresaId) : [];

  return (
    <main className="pagina-esteira">
      <Cabecalho
        titulo="Esteira de projetos"
        selos={
          <>
            {parados > 0 && <span className="pilula sev-atencao">{parados} parados</span>}
            <Ajuda rotulo="Como ler a esteira">
              <p>
                As {etapas.length} etapas do fluxo, confirmadas com o cliente. No <strong>Lead</strong>, “Aprovada” leva o projeto adiante e “Reprovada” o exclui; em <strong>Aguardando OS de vistoria</strong>, abrir a OS leva o projeto sozinho para a Vistoria técnica. A <strong>Execução</strong> é a etapa que mais gera
                retrabalho, e para onde o projeto volta quando a concessionária reprova — use a seta para trás.
              </p>
              <p>
                A faixa <strong>Assinado · 12 d</strong> no cartão conta os dias desde que o cliente assinou o contrato
                (do envio, na etapa do contrato, enquanto não volta assinado). Já o relógio do rodapé conta os dias na
                etapa atual.
              </p>
              <p>
                <strong>Parado</strong> é o projeto há {DIAS_ATENCAO} dias ou mais na mesma etapa (relógio amarelo) ou
                com o prazo da etapa estourado (vermelho). Em cada coluna, os mais antigos vêm primeiro.
              </p>
              <p>
                Os dossiês vindos do Drive entraram com a etapa <strong>deduzida pelos documentos da pasta</strong>, não
                informada por ninguém. Confira antes de cobrar alguém por isso. Os {concluidos} concluídos saem do
                quadro; detalhe de cada um em <a href="/documentos">Dossiês</a>.
              </p>
            </Ajuda>
          </>
        }
        meta={
          <>
            <span>{abertos.length} em aberto</span>
            {concluidos > 0 && <span>{concluidos} concluídos</span>}
          </>
        }
        acoes={
          <a href="/projeto/novo" className="botao">
            <Plus size={15} aria-hidden /> Novo projeto
          </a>
        }
      />

      {ok && (
        <p className="aviso ok aviso-esteira" role="status">
          <CheckCircle2 size={16} aria-hidden /> <span>{ok}</span>
          {osFeita && <Link href={`/os/${osFeita}`}>Abrir a OS</Link>}
        </p>
      )}
      {erro && (
        <p className="aviso erro aviso-esteira" role="alert">
          {erro}
        </p>
      )}

      <QuadroEsteira
        etapas={etapas.map((e, i) => ({
          id: e.id,
          ordem: String(i + 1).padStart(2, "0"),
          nome: e.nome,
          n: porEtapa.get(e.id)?.length ?? 0,
        }))}
        meuId={usuario.id}
        total={abertos.length}
        parados={parados}
        meus={meus}
      >
        {etapas.map((e, posicao) => {
          // Quem pede ação vem primeiro na coluna: na etapa 9, o aprovado pela
          // Energisa que ainda espera a OS de instalação. O resto, do mais antigo.
          const pedeAcao = (p: (typeof abertos)[number]) => {
            const v = energisa.get(p.id);
            return Boolean(v) && e.slug === "aprovacao_concessionaria" && liberaOsDeInstalacao(v!.fase as FaseEnergisa) && !osInstalacao.has(p.id);
          };
          const lista = [...(porEtapa.get(e.id) ?? [])].sort((a, b) => Number(pedeAcao(b)) - Number(pedeAcao(a)));
          return (
            <ColunaEsteira
              key={e.id}
              etapaId={e.id}
              cabecalho={
                <header className="coluna-topo">
                  <span className="ordem">
                    {String(posicao + 1).padStart(2, "0")}
                    {e.papelResponsavel ? ` · ${PAPEL_ROTULO[e.papelResponsavel] ?? e.papelResponsavel}` : ""}
                    {e.prazoPadraoDias ? ` · ${e.prazoPadraoDias}d` : ""}
                  </span>
                  <div className="linha">
                    <h2 className="nome">{e.nome}</h2>
                    <span className="qtd" aria-label={`${lista.length} projetos`}>
                      {lista.length}
                    </span>
                  </div>
                  {e.descricao && (
                    <span className="desc" title={e.descricao}>
                      {e.descricao}
                    </span>
                  )}
                </header>
              }
            >
              {lista.map((p) => {
                const dias = diasDesde(p.etapaDesde);
                const nivel = nivelDe(p);
                const estourou = nivel === "critico";
                const v = energisa.get(p.id);
                const fase = v?.fase as FaseEnergisa | undefined;
                const os = osInstalacao.get(p.id);
                const vist = osVistoria.get(p.id);
                const osCard = osDoCartao.get(p.id);
                const meta = [kWp(p.potenciaKwp), p.cliente.cidade].filter(Boolean).join(" · ");
                return (
                  <article
                    key={p.id}
                    className={`cartao-projeto${pedeAcao(p) ? " pede-acao" : ""}`}
                    data-busca={semAcento(`${p.cliente.nome} ${p.cliente.cidade ?? ""} ${p.responsavel?.nome ?? ""}`)}
                    data-nivel={nivel}
                    data-dono={p.responsavelId ?? ""}
                  >
                    <a className="cartao-projeto-titulo" href={`/projeto/${p.id}`} title={p.cliente.nome}>
                      {p.cliente.nome}
                    </a>
                    <span className="cartao-projeto-meta">
                      {meta || "—"}
                      {SITUACAO_ROTULO[p.situacao] && (
                        <span className="pilula sev-info">{SITUACAO_ROTULO[p.situacao]}</span>
                      )}
                    </span>

                    {e.slug === "lead" && gestao && (
                      <div className="cartao-projeto-extra">
                        <div className="cartao-projeto-decisao" role="group" aria-label="A proposta comercial foi aceita?">
                          <form action={aprovarProposta.bind(null, p.id, "esteira")}>
                            <button
                              type="submit"
                              className="botao botao-cartao"
                              title="O cliente aceitou a proposta: o projeto avança"
                            >
                              <ThumbsUp size={14} aria-hidden /> Aprovada
                            </button>
                          </form>
                          <BotaoDialogo
                            key={`r|${p.id}|${ok ?? ""}|${erro ?? ""}`}
                            rotulo="Reprovada"
                            icone={<ThumbsDown size={14} aria-hidden />}
                            classe="botao secundario botao-cartao botao-reprovar"
                            titulo="Proposta reprovada"
                            descricao={`${p.cliente.nome} não aceitou a proposta. O projeto sai da esteira e é excluído, e isso não se desfaz. O cadastro do cliente só sai junto se não tiver mais nada (usina, documento, OS).`}
                          >
                            <form action={reprovarProposta.bind(null, p.id)} className="form-agendar form-agendar-coluna">
                              <button type="submit" className="botao perigo">
                                <Trash2 size={15} aria-hidden /> Excluir o projeto
                              </button>
                            </form>
                          </BotaoDialogo>
                        </div>
                      </div>
                    )}

                    {e.slug === "aguardando_vistoria" && !vist && gestao && (
                      <div className="cartao-projeto-extra">
                        <a className="botao botao-cartao" href={`/os/nova?projeto=${p.id}&tipo=vistoria`}>
                          <ClipboardCheck size={14} aria-hidden /> Criar OS de vistoria
                        </a>
                      </div>
                    )}

                    {e.slug === "documentacao" && (
                      <div className="cartao-projeto-extra">
                        {(papelada.get(p.id)?.falta.length ?? 0) > 0 && (
                          <p className="cartao-projeto-falta">
                            Falta:{" "}
                            {papelada
                              .get(p.id)!
                              .falta.map((t) => ROTULO_DOCUMENTO[t] ?? t)
                              .join(", ")}
                          </p>
                        )}
                        {podeDocs && (
                          <a className="botao botao-cartao" href={`/documentos/${p.id}`}>
                            <FolderOpen size={14} aria-hidden /> Abrir documentos
                          </a>
                        )}
                        {gestao && empresaDados && (
                          <PedirDadosDoCliente
                            cliente={p.cliente}
                            empresa={empresaDados.nome}
                            classe="botao botao-whatsapp botao-cartao"
                          />
                        )}
                      </div>
                    )}

                    {e.slug === "projeto" &&
                      (() => {
                        const t = tecnicosDosProjetos.get(p.id);
                        if (!t) return <p className="cartao-projeto-falta">Sem vistoria pelo app.</p>;
                        const falta = faltaParaOProjeto(t.dados);
                        return (
                          <div className="cartao-projeto-extra">
                            <a
                              className={`pilula ${falta.length ? "sev-atencao" : "sev-info"}`}
                              href={`/projeto/${p.id}`}
                              title={falta.length ? `Falta na vistoria: ${falta.join(", ")}` : "A vistoria trouxe tudo o que o projeto elétrico precisa"}
                            >
                              {falta.length ? `Vistoria: faltam ${falta.length} dados` : "Vistoria completa"}
                            </a>
                            {falta.length > 0 && <p className="cartao-projeto-falta">Falta: {falta.join(", ")}</p>}
                          </div>
                        );
                      })()}

                    {e.slug === "contrato" && gestao && empresaDados && (
                      <div className="cartao-projeto-extra">
                        <AcoesDoContrato
                          projetoId={p.id}
                          entrada={entradaDe(p.cliente, p, empresaDados, null)}
                          equipamentos={sugestaoDeEquipamentos(p, catalogo)}
                          contrato={contratos.get(p.id) ?? null}
                          representantes={representantes}
                          whatsapp={numeroWhatsapp(p.cliente.telefone)}
                          origemSite={origemSite}
                          origem="esteira"
                          ehAdm={usuario.papel === "adm"}
                          chave={`c|${p.id}|${ok ?? ""}|${erro ?? ""}`}
                        />
                        {contratos.has(p.id) && podeDocs && (
                          <a className="link-acao" href={`/documentos/${p.id}`}>
                            <FolderOpen size={13} aria-hidden /> Subir a via assinada
                          </a>
                        )}
                      </div>
                    )}

                    {v && fase && (
                      <div className="cartao-projeto-extra">
                        <span
                          className={`pilula ${TOM_ENERGISA[tomDaFase(fase)]}`}
                          title={`Projeto ${v.numero} no portal da Energisa, desde ${v.situacaoDesde.toLocaleDateString("pt-BR")}`}
                        >
                          Energisa: {v.descricaoSituacao ?? fase}
                        </span>
                        {e.slug === "aprovacao_concessionaria" &&
                          liberaOsDeInstalacao(fase) &&
                          (os ? null : gestao ? (
                            <BotaoDialogo
                              key={`${p.id}|${ok ?? ""}|${erro ?? ""}`}
                              rotulo="Gerar OS de instalação"
                              icone={<Wrench size={14} aria-hidden />}
                              classe="botao botao-cartao"
                              titulo="Gerar OS de instalação"
                              descricao={`${p.cliente.nome} · a Energisa aprovou o projeto ${v.numero}. Escolha quem instala e quando: a OS nasce agendada, o técnico recebe o aviso no celular e o projeto vai para Execução.`}
                            >
                              <form action={gerarOsInstalacao.bind(null, p.id)} className="form-agendar form-agendar-coluna">
                                <label className="entrada">
                                  <span className="entrada-rotulo">Técnico</span>
                                  <select name="responsavelId" required defaultValue="">
                                    <option value="" disabled>
                                      {tecnicos.length ? "Escolha quem instala…" : "Ninguém entrou no app ainda"}
                                    </option>
                                    {tecnicos.map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.nome}
                                      </option>
                                    ))}
                                  </select>
                                  <small className="entrada-ajuda">Só aparece quem já entrou no app BB-Selebi.</small>
                                </label>
                                <label className="entrada">
                                  <span className="entrada-rotulo">Dia e hora</span>
                                  <input type="datetime-local" name="agendadaPara" required />
                                </label>
                                <button type="submit" className="botao">
                                  <Wrench size={15} aria-hidden /> Gerar OS e agendar
                                </button>
                              </form>
                            </BotaoDialogo>
                          ) : null)}
                      </div>
                    )}

                    {(() => {
                      /**
                       * O tempo do contrato, numa linha de contexto com rótulo escrito
                       * (e não só um número): "Assinado · 12 d" não se confunde com o
                       * relógio do rodapé, que é o tempo na etapa. Na etapa do contrato
                       * ainda sem assinatura, conta desde o envio ao cliente.
                       */
                      const assinou = p.contratoAssinadoEm;
                      const enviado = e.slug === "contrato" && !assinou ? contratos.get(p.id)?.enviadoEm : null;
                      const desde = assinou ?? enviado;
                      if (!desde) return null;
                      const dias = diasCorridos(desde);
                      const rotulo = assinou ? "Assinado" : "Aguardando assinatura";
                      const frase = fraseDoTempo(dias);
                      return (
                        <div
                          className={`cartao-projeto-contrato${assinou ? "" : " espera"}`}
                          title={`${assinou ? "Contrato assinado" : "Contrato enviado ao cliente"} em ${desde.toLocaleDateString("pt-BR")} (${frase})`}
                        >
                          <span className="cartao-projeto-contrato-rotulo">
                            {assinou ? <FileCheck2 size={13} aria-hidden /> : <FileClock size={13} aria-hidden />}
                            {rotulo}
                          </span>
                          <span className="cartao-projeto-contrato-dias">
                            {rotuloDoTempo(dias)}
                            <span className="sr-only"> ({frase})</span>
                          </span>
                        </div>
                      );
                    })()}

                    {osCard && (
                      <a
                        className="cartao-projeto-os"
                        href={`/os/${osCard.id}`}
                        title={`Abrir a ${numeroOs(osCard.numero)}`}
                      >
                        <span className="cartao-projeto-os-nome">
                          {numeroOs(osCard.numero)} · {TIPO_ROTULO[osCard.tipo] ?? osCard.tipo}
                          {osCard.status === "agendada" && osCard.agendadaPara && (
                            <small>{formatarRelogio(osCard.agendadaPara)}</small>
                          )}
                        </span>
                        <span className={`pilula st-${osCard.status}`}>
                          {STATUS_ROTULO[osCard.status] ?? osCard.status}
                        </span>
                      </a>
                    )}

                    <div className="cartao-projeto-rodape">
                      <span
                        className={`idade n-${nivel}`}
                        title={`${dias} ${dias === 1 ? "dia" : "dias"} nesta etapa${estourou ? " · prazo estourado" : ""}`}
                      >
                        <Clock size={12} aria-hidden />
                        {dias === 0 ? "hoje" : `${dias} d`}
                        <span className="sr-only"> nesta etapa{estourou ? ", prazo estourado" : ""}</span>
                      </span>
                      <div className="mover">
                        <form action={moverProjeto.bind(null, p.id, "voltar")}>
                          <button type="submit" title="Voltar uma etapa" aria-label={`Voltar ${p.cliente.nome} uma etapa`}>
                            <ChevronLeft size={15} aria-hidden />
                          </button>
                        </form>
                        <form action={moverProjeto.bind(null, p.id, "avancar")}>
                          <button type="submit" title="Avançar uma etapa" aria-label={`Avançar ${p.cliente.nome} uma etapa`}>
                            <ChevronRight size={15} aria-hidden />
                          </button>
                        </form>
                      </div>
                      {p.responsavel ? (
                        <span className="avatar-mini" title={p.responsavel.nome}>
                          {iniciais(p.responsavel.nome)}
                        </span>
                      ) : (
                        <span className="avatar-mini sem-dono" title="Sem responsável">
                          ?
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </ColunaEsteira>
          );
        })}
      </QuadroEsteira>
    </main>
  );
}
