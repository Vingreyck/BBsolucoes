import { and, desc, eq } from "drizzle-orm";
import { Info, KeyRound, LogIn, RefreshCw } from "lucide-react";
import Link from "next/link";

import { db, schema } from "@/db";
import { haQuantoTempo } from "@/documentos/cobranca";
import { ROTULO_FASE, sugerirProjetos, tomDaFase, type FaseEnergisa } from "@/energisa/situacoes";
import { exigirGestaoWeb } from "@/os/acesso";

import { Cabecalho, Cartao, Vazio } from "../_ui";
import { desvincular, enviarCodigo, pedirEntrada, pedirLeitura, vincular } from "./actions";
import { AtualizarSozinho } from "./atualizar";

export const dynamic = "force-dynamic";

const ROTULO_ESTADO: Record<string, string> = {
  conectado: "conectado",
  desconectado: "precisa entrar",
  entrando: "entrando…",
  aguardando_codigo: "esperando o código",
  erro: "com erro",
  bloqueado: "recusado pela Energisa",
  parado: "ainda não rodou",
};

const TOM: Record<string, string> = {
  ok: "sev-info",
  ruim: "sev-critico",
  espera: "sev-atencao",
  neutro: "",
};

/**
 * O robô do portal de projetos da Energisa: se está conectado, o botão para
 * entrar de novo (com o código que chega por SMS), e a lista do portal com o
 * vínculo de cada linha ao projeto do Selebi.
 */
export default async function Energisa({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const ator = await exigirGestaoWeb();
  const { ver = "" } = await searchParams;

  const [robo] = await db.select().from(schema.roboEnergisa).where(eq(schema.roboEnergisa.empresaId, ator.empresaId));
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

  const estado = robo?.estado ?? "parado";
  const emAndamento = estado === "entrando" || estado === "aguardando_codigo" || Boolean(robo?.pedido);
  const tomEstado = estado === "conectado" ? "sev-info" : estado === "aguardando_codigo" || estado === "entrando" ? "sev-atencao" : "sev-critico";

  return (
    <main>
      {emAndamento && <AtualizarSozinho segundos={4} />}
      <Cabecalho
        trilha={[{ href: "/esteira", rotulo: "Esteira" }]}
        titulo="Robô da Energisa"
        selos={<span className={`pilula ${tomEstado}`}>{ROTULO_ESTADO[estado] ?? estado}</span>}
        meta={
          <span>
            {robo?.ultimaLeituraEm ? `Última leitura ${haQuantoTempo(robo.ultimaLeituraEm, agora)} às ${robo.ultimaLeituraEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Nenhuma leitura ainda"}
            {robo?.totalProjetos ? ` · ${robo.totalProjetos} projetos no portal` : ""}
          </span>
        }
      />

      <div className="pagina-corpo pilha">
        <Cartao titulo="Situação do robô" icone={<KeyRound size={16} />} destaque={estado !== "conectado"}>
          <p>{robo?.mensagem ?? "O robô ainda não subiu no servidor (container energisa)."}</p>

          {estado === "aguardando_codigo" ? (
            <form action={enviarCodigo} className="form-telefone">
              <input
                name="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="código do SMS"
                aria-label="Código que chegou por SMS"
                required
                minLength={4}
                maxLength={8}
                autoFocus
              />
              <button type="submit" className="botao">
                Enviar código
              </button>
            </form>
          ) : (
            <div className="botoes-linha">
              {estado !== "conectado" && !emAndamento && (
                <form action={pedirEntrada}>
                  <button type="submit" className="botao">
                    <LogIn size={15} aria-hidden /> Entrar na Energisa
                  </button>
                </form>
              )}
              {estado === "conectado" && !emAndamento && (
                <form action={pedirLeitura}>
                  <button type="submit" className="botao secundario">
                    <RefreshCw size={15} aria-hidden /> Ler agora
                  </button>
                </form>
              )}
              {(estado === "erro" || estado === "bloqueado" || estado === "aguardando_codigo") && (
                <a href="/energisa/tela" target="_blank" rel="noreferrer" className="botao secundario">
                  Ver a última tela do robô
                </a>
              )}
            </div>
          )}
        </Cartao>

        <details className="como-ler">
          <summary>
            <Info size={15} aria-hidden /> Como o robô funciona
          </summary>
          <div>
            <p>
              <strong>Uma leitura a cada 30 minutos.</strong> O robô abre &quot;Meus projetos&quot; no portal da Energisa e
              lê a lista inteira de uma vez — a página já entrega todos os projetos juntos, então ler os últimos 5 dias ou
              os 628 custa o mesmo para a Energisa. E precisa ser a lista inteira: a aprovação e a vistoria acontecem em
              projetos que entraram há semanas.
            </p>
            <p>
              <strong>Na esteira:</strong> o cartão mostra a situação na Energisa. Na etapa 9, o projeto aprovado ganha o
              botão &quot;Gerar OS de instalação&quot;. Na etapa 11, &quot;UC GD Conectada&quot; leva o projeto para
              Monitoramento sozinho, e &quot;Vistoria Reprovada&quot; o devolve para Execução.
            </p>
            <p>
              <strong>Quando a sessão cai:</strong> o robô manda e-mail (pelo Healthchecks) e espera alguém clicar em
              &quot;Entrar na Energisa&quot; aqui. A Energisa manda um SMS para o celular final 0544; digite o código nesta
              tela em poucos minutos.
            </p>
          </div>
        </details>
      </div>

      <div className="caixa-filtros">
        <div className="linha-filtro">
          <span className="rotulo-filtro">Mostrar</span>
          <nav className="filtros">
            <Link href="/energisa?ver=sem-vinculo" className={`filtro${filtro === "sem-vinculo" ? " ativo" : ""}${semVinculo.length ? " perigo" : ""}`}>
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
          <Vazio titulo={linhas.length ? "Nada neste filtro" : "O robô ainda não leu o portal"} />
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
                            {l.vinculo === "automatico" ? "vinculado pelo nome" : l.vinculo === "protocolo" ? "pelo protocolo" : "vinculado à mão"}
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
