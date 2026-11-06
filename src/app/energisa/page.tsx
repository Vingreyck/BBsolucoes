import { and, desc, eq } from "drizzle-orm";
import { Info, RefreshCw } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

import { db, schema } from "@/db";
import { haQuantoTempo } from "@/documentos/cobranca";
import { codigoDoFavorito } from "@/energisa/favorito";
import { ROTULO_FASE, sugerirProjetos, tomDaFase, type FaseEnergisa } from "@/energisa/situacoes";
import { exigirGestaoWeb } from "@/os/acesso";

import { Cabecalho, Cartao, Vazio } from "../_ui";
import { desvincular, vincular } from "./actions";
import { Favorito } from "./favorito";

export const dynamic = "force-dynamic";

const TOM: Record<string, string> = {
  ok: "sev-info",
  ruim: "sev-critico",
  espera: "sev-atencao",
  neutro: "",
};

/**
 * Os projetos da empresa no portal da Energisa (AWGPE): a lista que chega pelo
 * favorito "Enviar ao Selebi", o vínculo de cada linha ao projeto do Selebi e
 * como instalar o favorito.
 */
export default async function Energisa({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const ator = await exigirGestaoWeb();
  const { ver = "" } = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const protocolo = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const [ultima] = await db.select().from(schema.roboEnergisa).where(eq(schema.roboEnergisa.empresaId, ator.empresaId));
  const linhas = await db
    .select({
      id: schema.energisaProjeto.id,
      numero: schema.energisaProjeto.numero,
      empreendimento: schema.energisaProjeto.empreendimento,
      endereco: schema.energisaProjeto.endereco,
      dataAbertura: schema.energisaProjeto.dataAbertura,
      descricao: schema.energisaProjeto.descricaoSituacao,
      fase: schema.energisaProjeto.fase,
      situacaoDesde: schema.energisaProjeto.situacaoDesde,
      projetoId: schema.energisaProjeto.projetoId,
      vinculo: schema.energisaProjeto.vinculo,
      cliente: schema.cliente.nome,
    })
    .from(schema.energisaProjeto)
    .leftJoin(schema.projeto, eq(schema.projeto.id, schema.energisaProjeto.projetoId))
    .leftJoin(schema.cliente, eq(schema.cliente.id, schema.projeto.clienteId))
    .where(eq(schema.energisaProjeto.empresaId, ator.empresaId))
    .orderBy(desc(schema.energisaProjeto.dataAbertura));

  const abertos = await db
    .select({ projetoId: schema.projeto.id, cliente: schema.cliente.nome, etapa: schema.etapa.nome })
    .from(schema.projeto)
    .innerJoin(schema.cliente, eq(schema.cliente.id, schema.projeto.clienteId))
    .innerJoin(schema.etapa, eq(schema.etapa.id, schema.projeto.etapaId))
    .where(and(eq(schema.projeto.empresaId, ator.empresaId), eq(schema.projeto.situacao, "em_andamento")))
    .orderBy(schema.cliente.nome);

  const agora = new Date();
  const cincoDias = agora.getTime() - 5 * 86_400_000;
  const semVinculo = linhas.filter((l) => !l.projetoId && l.fase !== "cancelado");
  const recentes = linhas.filter((l) => (l.dataAbertura?.getTime() ?? 0) >= cincoDias);
  const esperando = linhas.filter((l) => l.projetoId && (l.fase === "analise" || l.fase === "vistoria_pendente"));
  const filtro = ver || (semVinculo.length ? "sem-vinculo" : "recentes");
  const visiveis =
    filtro === "sem-vinculo"
      ? semVinculo
      : filtro === "recentes"
        ? recentes
        : filtro === "esperando"
          ? esperando
          : linhas.slice(0, 300);

  const atualizadoHoje = ultima?.ultimaLeituraEm && haQuantoTempo(ultima.ultimaLeituraEm, agora) === "hoje";

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/esteira", rotulo: "Esteira" }]}
        titulo="Projetos na Energisa"
        selos={
          <span className={`pilula ${atualizadoHoje ? "sev-info" : "sev-atencao"}`}>
            {atualizadoHoje ? "atualizado hoje" : "atualizar hoje"}
          </span>
        }
        meta={
          <span>
            {ultima?.ultimaLeituraEm
              ? `Última atualização ${haQuantoTempo(ultima.ultimaLeituraEm, agora)} às ${ultima.ultimaLeituraEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
              : "Nenhuma atualização ainda"}
            {ultima?.totalProjetos ? ` · ${ultima.totalProjetos} projetos no portal` : ""}
          </span>
        }
      />

      <div className="pagina-corpo pilha">
        <Cartao titulo="Atualizar pela Energisa" icone={<RefreshCw size={16} />} destaque={!atualizadoHoje}>
          {ultima?.mensagem && <p className="fraco">{ultima.mensagem}</p>}
          <ol className="passos-simples">
            <li>
              Abra o{" "}
              <a href="https://servicos.energisa.com.br/AWGPE/dashboard?CodigoEmpresaWeb=3" target="_blank" rel="noreferrer">
                portal da Energisa — Meus projetos
              </a>{" "}
              e entre como sempre (CPF e código do SMS).
            </li>
            <li>
              Com a lista de projetos na tela, clique no favorito <strong>Enviar ao Selebi</strong>.
            </li>
            <li>Uma janela do Selebi abre, recebe a lista e atualiza a esteira. Pronto.</li>
          </ol>
          <p className="fraco">Primeira vez neste computador? Arraste o botão abaixo para a barra de favoritos do navegador:</p>
          <Favorito codigo={codigoDoFavorito(`${protocolo}://${host}`)} />
        </Cartao>

        <details className="como-ler">
          <summary>
            <Info size={15} aria-hidden /> Como funciona
          </summary>
          <div>
            <p>
              <strong>Por que um clique, e não um robô:</strong> o portal da Energisa recusa acesso automatizado. Com o
              favorito, quem abre o portal é a pessoa, no navegador dela; o clique só entrega ao Selebi a lista que a
              página já mostra — a lista inteira, porque aprovação e vistoria acontecem em projetos que entraram há
              semanas. Uma vez por dia basta; se ninguém enviar, chega um e-mail.
            </p>
            <p>
              <strong>Na esteira:</strong> o cartão mostra a situação na Energisa. Na etapa 9, o projeto aprovado ganha o
              botão &quot;Gerar OS de instalação&quot;. Na etapa 11, &quot;UC GD Conectada&quot; leva o projeto para
              Monitoramento sozinho, e &quot;Vistoria Reprovada&quot; o devolve para Execução.
            </p>
            <p>
              <strong>Vínculo:</strong> cada linha do portal é ligada ao projeto do Selebi pelo ID anotado no campo
              &quot;Protocolo&quot; do projeto, ou pelo nome do cliente quando não há dúvida. As outras ficam em
              &quot;Sem vínculo&quot;, para escolher abaixo.
            </p>
          </div>
        </details>
      </div>

      <div className="caixa-filtros">
        <div className="linha-filtro">
          <span className="rotulo-filtro">Mostrar</span>
          <nav className="filtros">
            <Link
              href="/energisa?ver=sem-vinculo"
              className={`filtro${filtro === "sem-vinculo" ? " ativo" : ""}${semVinculo.length ? " perigo" : ""}`}
            >
              Sem vínculo ({semVinculo.length})
            </Link>
            <Link href="/energisa?ver=recentes" className={`filtro${filtro === "recentes" ? " ativo" : ""}`}>
              Entraram nos últimos 5 dias ({recentes.length})
            </Link>
            <Link href="/energisa?ver=esperando" className={`filtro${filtro === "esperando" ? " ativo" : ""}`}>
              Esperando a Energisa ({esperando.length})
            </Link>
            <Link href="/energisa?ver=todos" className={`filtro${filtro === "todos" ? " ativo" : ""}`}>
              Todos ({linhas.length})
            </Link>
          </nav>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <div className="pagina-corpo">
          <Vazio titulo={linhas.length ? "Nada neste filtro" : "Nenhuma lista recebida ainda"} />
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela tabela-cobranca">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th>Entrada</th>
                <th>Situação na Energisa</th>
                <th>Projeto no Selebi</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const fase = l.fase as FaseEnergisa;
                const sugestoes = l.projetoId ? [] : sugerirProjetos(l.empreendimento, abertos).slice(0, 3);
                const ids = new Set(sugestoes.map((s) => s.projetoId));
                return (
                  <tr key={l.id}>
                    <td className="forte">
                      {l.empreendimento}
                      <div className="fraco">
                        ID {l.numero}
                        {l.endereco ? ` · ${l.endereco}` : ""}
                      </div>
                    </td>
                    <td className="fraco">{l.dataAbertura ? l.dataAbertura.toLocaleDateString("pt-BR") : "—"}</td>
                    <td>
                      <span className={`pilula ${TOM[tomDaFase(fase)]}`}>{l.descricao ?? ROTULO_FASE[fase]}</span>
                      <div className="fraco">desde {l.situacaoDesde.toLocaleDateString("pt-BR")}</div>
                    </td>
                    <td>
                      {l.projetoId ? (
                        <>
                          <Link href={`/projeto/${l.projetoId}`}>{l.cliente}</Link>
                          <div className="fraco">
                            {l.vinculo === "automatico"
                              ? "vinculado pelo nome"
                              : l.vinculo === "protocolo"
                                ? "pelo protocolo"
                                : "vinculado à mão"}
                            {" · "}
                            <form action={desvincular.bind(null, l.id)} className="form-mini">
                              <button type="submit" className="link-perigo">
                                desfazer
                              </button>
                            </form>
                          </div>
                        </>
                      ) : (
                        <form action={vincular.bind(null, l.id)} className="form-telefone">
                          <select name="projetoId" required defaultValue="" aria-label={`Projeto do Selebi para ${l.empreendimento}`}>
                            <option value="" disabled>
                              Escolha o projeto…
                            </option>
                            {sugestoes.length > 0 && (
                              <optgroup label="Sugestões pelo nome">
                                {sugestoes.map((s) => (
                                  <option key={s.projetoId} value={s.projetoId}>
                                    {s.cliente}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="Projetos em andamento">
                              {abertos
                                .filter((a) => !ids.has(a.projetoId))
                                .map((a) => (
                                  <option key={a.projetoId} value={a.projetoId}>
                                    {a.cliente} — {a.etapa}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                          <button type="submit" className="botao secundario">
                            Vincular
                          </button>
                        </form>
                      )}
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
