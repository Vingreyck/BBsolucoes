import { Fragment } from "react";

import { and, asc, inArray, isNotNull } from "drizzle-orm";

import { exigirUsuario } from "@/auth/sessao";
import { db, schema } from "@/db";
import { etapa as etapaTable } from "@/db/schema";
import { liberaOsDeInstalacao, tomDaFase, vigente, type FaseEnergisa } from "@/energisa/situacoes";
import { ehGestaoWeb } from "@/os/acesso";
import { numeroOs } from "@/os/tipos";

import { Info, Plus } from "lucide-react";

import { Cabecalho } from "../_ui";
import { moverProjeto } from "../actions";
import { gerarOsInstalacao } from "./actions";
import { kWp } from "../formatar";

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

export default async function Esteira() {
  const usuario = await exigirUsuario();
  const gestao = ehGestaoWeb(usuario.papel);

  const etapas = await db.query.etapa.findMany({
    orderBy: asc(etapaTable.ordem),
  });

  const projetos = await db.query.projeto.findMany({
    with: { cliente: true, responsavel: true },
  });

  /**
   * A situação de cada projeto no portal da Energisa, lida pelo robô
   * (`/energisa`). Na etapa 9, a aprovação libera o botão da OS de instalação;
   * a OS de instalação que já existe aparece no lugar do botão.
   */
  const daEnergisa = await db.query.energisaProjeto.findMany({ where: isNotNull(schema.energisaProjeto.projetoId) });
  const entradasPorProjeto = new Map<string, typeof daEnergisa>();
  for (const en of daEnergisa) {
    const lista = entradasPorProjeto.get(en.projetoId!) ?? [];
    lista.push(en);
    entradasPorProjeto.set(en.projetoId!, lista);
  }
  const energisa = new Map(
    [...entradasPorProjeto].map(([id, lista]) => [id, vigente(lista.map((en) => ({ ...en, fase: en.fase as FaseEnergisa })))]),
  );
  const osInstalacao = new Map<string, { id: string; numero: number }>();
  if (energisa.size) {
    const ordens = await db
      .select({ id: schema.ordemServico.id, numero: schema.ordemServico.numero, projetoId: schema.ordemServico.projetoId })
      .from(schema.ordemServico)
      .where(
        and(
          inArray(schema.ordemServico.projetoId, [...energisa.keys()]),
          inArray(schema.ordemServico.tipo, ["instalacao"]),
          inArray(schema.ordemServico.status, ["aberta", "agendada", "em_deslocamento", "em_andamento", "aguardando_peca"]),
        ),
      );
    for (const o of ordens) if (o.projetoId) osInstalacao.set(o.projetoId, { id: o.id, numero: o.numero });
  }

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
  const abertos = projetos.filter((p) => p.situacao !== "concluido");
  const concluidos = projetos.length - abertos.length;

  const porEtapa = new Map<string, typeof projetos>();
  for (const p of abertos) {
    const lista = porEtapa.get(p.etapaId) ?? [];
    lista.push(p);
    porEtapa.set(p.etapaId, lista);
  }

  const parados = projetos.filter(
    (p) => diasDesde(p.etapaDesde) >= DIAS_ATENCAO && p.situacao === "em_andamento",
  );

  return (
    <main>
      <Cabecalho
        titulo="Esteira de projetos"
        selos={
          parados.length > 0 ? (
            <span className="pilula sev-atencao">
              {parados.length} parados há {DIAS_ATENCAO}+ dias
            </span>
          ) : undefined
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

      <details className="como-ler">
        <summary>
          <Info size={15} aria-hidden /> Como ler a esteira
        </summary>
        <div>
          <p>
            As 13 etapas do fluxo, confirmadas com o cliente. A <strong>Execução</strong> é a etapa que mais gera
            retrabalho, e para onde o projeto volta quando a concessionária reprova — use a seta para trás.
          </p>
          <p>
            Os dossiês vindos do Drive entraram com a etapa <strong>deduzida pelos documentos que existem na pasta</strong>,
            não informada por ninguém — um dossiê sem a conta de luz foi parar em coleta de informações, um sem foto do
            padrão em vistoria técnica. Confira antes de cobrar alguém por isso. Os {concluidos} concluídos são os que já
            têm usina gerando e saem do quadro. Detalhe de cada um em <a href="/documentos">Dossiês</a>.
          </p>
        </div>
      </details>

      <div className="esteira">
        {etapas.map((e) => {
          const lista = porEtapa.get(e.id) ?? [];
          return (
            <Fragment key={e.id}>
              <section className={lista.length ? "coluna" : "coluna vazia"}>
                <div className="coluna-topo">
                  <span className="ordem">
                    {String(Math.round(e.ordem / 10)).padStart(2, "0")}
                    {e.papelResponsavel
                      ? ` · ${PAPEL_ROTULO[e.papelResponsavel] ?? e.papelResponsavel}`
                      : ""}
                    {e.prazoPadraoDias ? ` · ${e.prazoPadraoDias}d` : ""}
                  </span>
                  <div className="linha">
                    <span className="nome">{e.nome}</span>
                    <span className="qtd">{lista.length}</span>
                  </div>
                  {e.descricao && <span className="desc">{e.descricao}</span>}
                </div>

                {lista.length > 0 && (
                  <div className="cartoes">
                    {lista.map((p) => {
                      const dias = diasDesde(p.etapaDesde);
                      const estourou =
                        p.prazoEtapa !== null && p.prazoEtapa.getTime() < Date.now();
                      const nivel = estourou
                        ? "critico"
                        : dias >= DIAS_ATENCAO
                          ? "atencao"
                          : "normal";
                      return (
                        <article className={`cartao n-${nivel}`} key={p.id}>
                          <a className="cliente" href={`/projeto/${p.id}`}>
                            {p.cliente.nome}
                          </a>
                          <span className="meta">
                            {kWp(p.potenciaKwp) ?? "—"}
                            {p.cliente.cidade ? ` · ${p.cliente.cidade}` : ""}
                          </span>
                          <span className={`dias d-${nivel}`}>
                            {dias === 0
                              ? "hoje"
                              : `${dias} ${dias === 1 ? "dia" : "dias"} nesta etapa`}
                            {estourou ? " · prazo estourado" : ""}
                          </span>
                          {p.responsavel && (
                            <span className="dono">{p.responsavel.nome}</span>
                          )}
                          {(() => {
                            const v = energisa.get(p.id);
                            if (!v) return null;
                            const fase = v.fase as FaseEnergisa;
                            const os = osInstalacao.get(p.id);
                            return (
                              <>
                                <span
                                  className={`pilula ${TOM_ENERGISA[tomDaFase(fase)]}`}
                                  title={`Projeto ${v.numero} no portal da Energisa, desde ${v.situacaoDesde.toLocaleDateString("pt-BR")}`}
                                >
                                  Energisa: {v.descricaoSituacao ?? fase}
                                </span>
                                {e.slug === "aprovacao_concessionaria" &&
                                  liberaOsDeInstalacao(fase) &&
                                  (os ? (
                                    <a className="link-acao" href={`/os/${os.id}`}>
                                      {numeroOs(os.numero)} de instalação
                                    </a>
                                  ) : gestao ? (
                                    <form action={gerarOsInstalacao.bind(null, p.id)}>
                                      <button type="submit" className="botao botao-cartao">
                                        Gerar OS de instalação
                                      </button>
                                    </form>
                                  ) : null)}
                              </>
                            );
                          })()}
                          <div className="mover">
                            <form action={moverProjeto.bind(null, p.id, "voltar")}>
                              <button
                                type="submit"
                                title="Voltar uma etapa"
                                aria-label={`Voltar ${p.cliente.nome} uma etapa`}
                              >
                                ←
                              </button>
                            </form>
                            <form action={moverProjeto.bind(null, p.id, "avancar")}>
                              <button
                                type="submit"
                                title="Avançar uma etapa"
                                aria-label={`Avançar ${p.cliente.nome} uma etapa`}
                              >
                                →
                              </button>
                            </form>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </Fragment>
          );
        })}
      </div>
    </main>
  );
}
