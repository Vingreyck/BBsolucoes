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
import { endereco, paginar, Paginacao } from "../_ui/paginacao";
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
 * Os projetos da empresa no portal da Energisa (AWGPE): a lista que chega pela
 * extensão do Chrome (ou pelo favorito "Enviar ao Selebi"), o vínculo de cada
 * linha ao projeto do Selebi e como instalar as duas.
 */
/**
 * Cada linha solta leva uma lista com todos os projetos abertos: com centenas de
 * linhas de uma vez, a página passava de dezenas de milhares de itens e travava
 * o servidor enquanto era montada.
 */
const POR_PAGINA = 30;

export default async function Energisa({ searchParams }: { searchParams: Promise<{ ver?: string; pagina?: string }> }) {
  const ator = await exigirGestaoWeb();
  const { ver = "", pagina: paginaPedida = "" } = await searchParams;
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
  const doFiltro =
    filtro === "sem-vinculo"
      ? semVinculo
      : filtro === "recentes"
        ? recentes
        : filtro === "esperando"
          ? esperando
          : linhas;
  const pagina = paginar(doFiltro, paginaPedida, POR_PAGINA);
  const visiveis = pagina.itens;

  const atualizadoHoje = ultima?.ultimaLeituraEm && haQuantoTempo(ultima.ultimaLeituraEm, agora) === "hoje";
  const deslogado = ultima?.estado === "desconectado";

  return (
    <main>
      <Cabecalho
        trilha={[{ href: "/esteira", rotulo: "Esteira" }]}
        titulo="Projetos na Energisa"
        selos={
          deslogado ? (
            <span className="pilula sev-critico">portal saiu da conta</span>
          ) : (
            <span className={`pilula ${atualizadoHoje ? "sev-info" : "sev-atencao"}`}>
              {atualizadoHoje ? "atualizado hoje" : "atualizar hoje"}
            </span>
          )
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
        <Cartao titulo="Atualizar pela Energisa" icone={<RefreshCw size={16} />} destaque={!atualizadoHoje || deslogado}>
          {ultima?.mensagem && <p className={deslogado ? undefined : "fraco"}>{ultima.mensagem}</p>}
          <p>
            <strong>Automático:</strong> a extensão Selebi no Chrome do computador que fica com o portal aberto lê a
            lista a cada 30 minutos, sem clique. Instale uma vez:
          </p>
          <ol className="passos-simples">
            <li>
              <a href="/energisa/extensao" download>
                Baixe a extensão
              </a>{" "}
              e descompacte numa pasta fixa (ex.: Documentos). Se a pasta for apagada, a extensão some.
            </li>
            <li>
              No Chrome, abra <code>chrome://extensions</code> e ligue o <strong>Modo do desenvolvedor</strong> (no
              alto, à direita).
            </li>
            <li>
              Clique em <strong>Carregar sem compactação</strong> e escolha a pasta <code>selebi-energisa</code>.
            </li>
            <li>
              Nesse Chrome, fique logado no Selebi, entre no{" "}
              <a href="https://servicos.energisa.com.br/AWGPE/dashboard?CodigoEmpresaWeb=3" target="_blank" rel="noreferrer">
                portal da Energisa
              </a>{" "}
              (CPF e código do SMS) e deixe a aba aberta — pode fixar a aba.
            </li>
          </ol>
          <details className="como-ler">
            <summary>Sem a extensão: o favorito &quot;Enviar ao Selebi&quot;</summary>
            <div>
              <p>
                Com o portal aberto em &quot;Meus projetos&quot;, clique no favorito: uma janela do Selebi recebe a lista e
                atualiza a esteira. Para instalar, arraste o botão para a barra de favoritos:
              </p>
              <Favorito codigo={codigoDoFavorito(`${protocolo}://${host}`)} />
            </div>
          </details>
        </Cartao>

        <details className="como-ler">
          <summary>
            <Info size={15} aria-hidden /> Como funciona
          </summary>
          <div>
            <p>
              <strong>Por que no Chrome, e não num robô no servidor:</strong> o portal da Energisa recusa acesso de
              servidor. A extensão roda no Chrome de quem já entrou no portal e pede a mesma lista que a página mostra —
              a lista inteira, porque aprovação e vistoria acontecem em projetos que entraram há semanas. Ela não entra
              no portal sozinha: quando ele sai da conta, o Chrome avisa, esta página mostra, e basta entrar de novo. Se
              ninguém atualizar no dia, chega um e-mail.
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
          <Paginacao
            {...pagina}
            rotulo="projetos"
            ancora={null}
            href={(n) => endereco("/energisa", { ver: filtro }, { pagina: n })}
          />
        </div>
      )}
    </main>
  );
}
