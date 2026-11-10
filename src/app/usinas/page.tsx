import { and, asc, eq, sql } from "drizzle-orm";

import { Plus, Search, SearchX, Unlink } from "lucide-react";

import { exigirUsuario } from "@/auth/sessao";
import { db } from "@/db";
import {
  alerta as alertaTable,
  leitura as leituraTable,
  usina as usinaTable,
} from "@/db/schema";

import { Cabecalho, Vazio } from "../_ui";
import { endereco, paginar, Paginacao } from "../_ui/paginacao";
import { SeletorFiltro } from "../_ui/seletor-filtro";
import { kWh, kWp } from "../formatar";

export const dynamic = "force-dynamic";

/**
 * Acima disto a potência cadastrada é fisicamente impossível.
 *
 * `geração do dia ÷ potência` é quantas horas de sol pleno a usina teria
 * precisado. No Nordeste isso fica entre 4 e 6; acima de 8 não existe, e denuncia
 * potência errada no cadastro do portal — problema que atinge parte do parque e
 * que precisa ser corrigido na origem, não aqui.
 */
const HORAS_IMPOSSIVEIS = 8;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Nome de exibição de cada portal. A chave é o valor guardado no banco.
 *
 * `sem_portal` não é um fabricante: é a usina que não está em portal nenhum.
 * O cliente confirmou que essas existem, e elas são as mais perigosas — não
 * aparecem em lugar nenhum quando param de gerar.
 */
/**
 * Como cada problema aparece na coluna Situação.
 *
 * "Sem comunicação" é o inversor que parou de mandar dado — pode ser internet,
 * datalogger ou o próprio inversor. "Sem geração" é quando ele fala mas não
 * produz, que é falha de verdade. A distinção decide o que o técnico leva na
 * mochila.
 */
const SITUACAO_ROTULO: Record<string, string> = {
  sem_comunicacao: "Sem comunicação",
  offline: "Sem geração",
  geracao_baixa: "Gerando pouco",
  alarme_inversor: "Alarme",
};

const PORTAL_ROTULO: Record<string, string> = {
  growatt: "Growatt",
  foxess: "FoxESS",
  solis: "Solis",
  hoymiles: "Hoymiles",
  huawei: "Huawei",
  solarportal_plus: "SolarPortal+",
  nep: "NEP",
  outro: "Outro",
};

export default async function Usinas({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; filtro?: string; portal?: string; pagina?: string }>;
}) {
  const usuario = await exigirUsuario();
  const { busca = "", filtro = "", portal = "", pagina: paginaPedida } = await searchParams;

  // Da empresa de quem pede: o sistema é multiempresa desde a primeira migration.
  const usinas = await db.query.usina.findMany({
    where: eq(usinaTable.empresaId, usuario.empresaId),
    with: {
      cliente: true,
      equipamentos: true,
      vinculosPortal: { with: { contaPortal: true } },
    },
    orderBy: asc(usinaTable.nome),
  });

  // Uma consulta agregada em vez de uma por usina.
  const series = await db
    .select({
      usinaId: leituraTable.usinaId,
      /**
       * Dias distintos, não linhas. Uma usina com quatro microinversores grava
       * quatro leituras por dia, e contar linhas faria um único dia aparecer
       * como quatro.
       */
      dias: sql<number>`count(distinct (${leituraTable.medidoEm} at time zone 'UTC')::date)`,
      ultima: sql<string>`max(${leituraTable.medidoEm})::date::text`,
      maiorDia: sql<number>`max(${leituraTable.energiaKwh})::float8`,
      total: sql<number>`sum(${leituraTable.energiaKwh})::float8`,
    })
    .from(leituraTable)
    .where(and(eq(leituraTable.granularidade, "dia"), eq(leituraTable.empresaId, usuario.empresaId)))
    .groupBy(leituraTable.usinaId);

  const porUsina = new Map(series.map((s) => [s.usinaId, s]));

  /**
   * Situação de cada usina, tirada dos alertas abertos.
   *
   * Esta lista nasceu como auditoria de cadastro — potência errada, sem
   * equipamento, sem série. Isso resolveu o problema de agosto. Só que agora o
   * sistema sabe quais usinas pararam de comunicar, e uma lista de 138 linhas
   * que não mostra isso obriga a pessoa a abrir outra tela para descobrir o que
   * importa. Quem abre a lista de usinas quer saber, antes de tudo, quais estão
   * com problema hoje.
   */
  const problemas = await db
    .select({
      usinaId: alertaTable.usinaId,
      tipo: alertaTable.tipo,
      desde: sql<string>`min(${alertaTable.abertoEm})::date::text`,
      quantos: sql<number>`count(*)::int`,
    })
    .from(alertaTable)
    .where(and(eq(alertaTable.status, "aberto"), eq(alertaTable.empresaId, usuario.empresaId)))
    .groupBy(alertaTable.usinaId, alertaTable.tipo);

  /** Da mais grave para a menos: parada pesa mais que gerando pouco. */
  const ORDEM_GRAVIDADE = ["sem_comunicacao", "offline", "geracao_baixa"];

  const situacaoPorUsina = new Map<
    string,
    { tipo: string; desde: string; dias: number }
  >();
  for (const p of problemas) {
    const anterior = situacaoPorUsina.get(p.usinaId);
    const pesoNovo = ORDEM_GRAVIDADE.indexOf(p.tipo);
    const pesoAtual = anterior ? ORDEM_GRAVIDADE.indexOf(anterior.tipo) : 99;
    if (pesoNovo > pesoAtual) continue;
    situacaoPorUsina.set(p.usinaId, {
      tipo: p.tipo,
      desde: p.desde,
      dias: Math.floor(
        (Date.now() - new Date(`${p.desde}T12:00:00Z`).getTime()) / 86_400_000,
      ),
    });
  }

  const todas = usinas.map((u) => {
    const serie = porUsina.get(u.id);
    const potencia = u.potenciaKwp ? Number(u.potenciaKwp) : null;

    // Com série, a física decide. Sem série, sobra o absurdo evidente.
    const potenciaSuspeita =
      potencia !== null && potencia > 0
        ? serie?.maiorDia
          ? serie.maiorDia / potencia > HORAS_IMPOSSIVEIS
          : potencia < 1
        : false;

    return {
      usina: u,
      serie,
      potencia,
      potenciaSuspeita,
      situacao: situacaoPorUsina.get(u.id),
      semEquipamento: u.equipamentos.length === 0,
      semSerie: !serie,
      // Uma usina pode, em tese, estar em mais de um portal. Na prática é um só.
      // Tipado como string porque o filtro vem da URL, que não conhece o enum.
      portais: u.vinculosPortal.map((v) => v.contaPortal.fabricante as string),
    };
  });

  /**
   * Recomeço: as usinas de antes ficam só para análise. Saem da lista, das
   * contas e dos filtros, e aparecem só no filtro "Arquivadas" — seguem
   * coletando, sem alerta, OS automática nem relatório.
   */
  const verArquivadas = filtro === "arquivadas";
  const arquivadas = todas.filter((l) => l.usina.arquivadaEm);
  const ativas = todas.filter((l) => !l.usina.arquivadaEm);
  const linhas = verArquivadas ? arquivadas : ativas;

  const alvo = normalizar(busca.trim());
  const filtradas = linhas.filter((l) => {
    if (alvo) {
      const campos = normalizar(
        `${l.usina.nome} ${l.usina.cliente?.nome ?? ""} ${l.usina.cidade ?? ""}`,
      );
      if (!campos.includes(alvo)) return false;
    }
    if (portal === "sem_portal" && l.portais.length > 0) return false;
    if (portal && portal !== "sem_portal" && !l.portais.includes(portal)) return false;
    if (filtro === "problema") return l.situacao !== undefined;
    // Só o mudo. "Sem geração" é o inversor que fala e não produz, e é outro
    // problema — juntar os dois faria este filtro repetir o de cima.
    if (filtro === "sem-comunicacao") return l.situacao?.tipo === "sem_comunicacao";
    if (filtro === "potencia") return l.potenciaSuspeita;
    if (filtro === "sem-equipamento") return l.semEquipamento;
    if (filtro === "sem-serie") return l.semSerie;
    return true;
  });

  // Contagem por portal, para os botões mostrarem quantas cada um tem.
  const porPortal = new Map<string, number>();
  for (const l of ativas) {
    if (l.portais.length === 0) {
      porPortal.set("sem_portal", (porPortal.get("sem_portal") ?? 0) + 1);
    }
    for (const p of new Set(l.portais)) {
      porPortal.set(p, (porPortal.get(p) ?? 0) + 1);
    }
  }
  const portaisOrdenados = [...porPortal].sort((a, b) => b[1] - a[1]);

  const suspeitas = ativas.filter((l) => l.potenciaSuspeita).length;
  const semEquipamento = ativas.filter((l) => l.semEquipamento).length;
  const semSerie = ativas.filter((l) => l.semSerie).length;
  const comProblema = ativas.filter((l) => l.situacao !== undefined).length;
  const semComunicacao = ativas.filter(
    (l) => l.situacao?.tipo === "sem_comunicacao",
  ).length;
  const pagina = paginar(filtradas, paginaPedida);
  const atuais = { busca, filtro, portal };
  const potenciaTotal = filtradas.reduce((s, l) => s + (l.potencia ?? 0), 0);

  const gerando = ativas.length - comProblema;
  const pendenciasCadastro = suspeitas + semEquipamento;

  return (
    <main>
      <Cabecalho
        titulo="Usinas"
        meta={
          <>
            <span>
              {filtradas.length === linhas.length ? `${linhas.length} ${verArquivadas ? "arquivadas" : "cadastradas"}` : `${filtradas.length} de ${linhas.length}`}
            </span>
            <span>{kWp(potenciaTotal)}</span>
          </>
        }
        acoes={
          <>
            <a href="/usinas/sem-dono" className="botao secundario">
              <Unlink size={15} aria-hidden /> Sem dono
            </a>
            <a href="/cadastro" className="botao">
              <Plus size={15} aria-hidden /> Nova usina
            </a>
          </>
        }
      />

      <section className="indicadores indicadores-pagina" aria-label="Resumo do parque">
        <a href="/usinas" className="indicador tom-ok">
          <span className="indicador-rotulo">Sem problema</span>
          <span className="indicador-valor">{gerando}</span>
          <span className="indicador-detalhe">gerando normalmente</span>
        </a>
        <a href="/usinas?filtro=problema" className={`indicador${comProblema ? " tom-perigo" : ""}`}>
          <span className="indicador-rotulo">Com problema</span>
          <span className="indicador-valor">{comProblema}</span>
          <span className="indicador-detalhe">alerta aberto agora</span>
        </a>
        <a href="/usinas?filtro=sem-comunicacao" className={`indicador${semComunicacao ? " tom-atencao" : ""}`}>
          <span className="indicador-rotulo">Sem comunicação</span>
          <span className="indicador-valor">{semComunicacao}</span>
          <span className="indicador-detalhe">inversor parou de mandar dado</span>
        </a>
        <a href="/usinas?filtro=potencia" className={`indicador${pendenciasCadastro ? " tom-atencao" : ""}`}>
          <span className="indicador-rotulo">Cadastro a corrigir</span>
          <span className="indicador-valor">{pendenciasCadastro}</span>
          <span className="indicador-detalhe">
            {suspeitas} potência errada · {semEquipamento} sem equipamento
          </span>
        </a>
      </section>

      <div className="pagina-corpo pilha">
        {verArquivadas && (
          <p className="aviso aviso-solto">
            <strong>Usinas de antes do recomeço.</strong> Seguem coletando, só para análise da geração: não geram alerta,
            OS automática nem relatório mensal, e não aparecem no resto do sistema.
          </p>
        )}

        {filtro === "potencia" && suspeitas > 0 && (
          <p className="aviso aviso-solto">
            A potência dessas usinas exigiria mais de {HORAS_IMPOSSIVEIS} horas de sol pleno num único dia para gerar o que
            elas geraram — o que não existe. É erro de cadastro <strong>no portal da Growatt</strong>, provavelmente kWp
            digitado em campo que espera watts, e precisa ser corrigido lá. Enquanto não for, o alerta de geração abaixo do
            esperado não funciona nessas usinas.
          </p>
        )}


        <section className="lista" id="lista" aria-label="Usinas">
          <div className="lista-barra">
            <form className="campo-busca" action="/usinas">
              <Search size={15} aria-hidden />
              <input type="search" name="busca" placeholder="Cliente, usina ou cidade" defaultValue={busca} aria-label="Buscar usina" />
              {filtro && <input type="hidden" name="filtro" value={filtro} />}
              {portal && <input type="hidden" name="portal" value={portal} />}
            </form>
            <SeletorFiltro
              rotulo="Portal"
              atual={portal}
              opcoes={[
                { valor: "", rotulo: `Todos (${ativas.length})`, href: endereco("/usinas", atuais, { portal: null }) },
                ...portaisOrdenados.map(([p, n]) => ({
                  valor: p,
                  rotulo: `${p === "sem_portal" ? "Sem portal" : (PORTAL_ROTULO[p] ?? p)} (${n})`,
                  href: endereco("/usinas", atuais, { portal: p }),
                })),
              ]}
            />
            <nav className="filtros" aria-label="Situação e cadastro">
              <Filtro atual={filtro} valor="" atuais={atuais} n={ativas.length}>
                Todas
              </Filtro>
              <Filtro atual={filtro} valor="problema" atuais={atuais} n={comProblema} perigo>
                Com problema
              </Filtro>
              <Filtro atual={filtro} valor="sem-comunicacao" atuais={atuais} n={semComunicacao} perigo>
                Sem comunicação
              </Filtro>
              <Filtro atual={filtro} valor="potencia" atuais={atuais} n={suspeitas} perigo>
                Potência errada
              </Filtro>
              <Filtro atual={filtro} valor="sem-equipamento" atuais={atuais} n={semEquipamento}>
                Sem equipamento
              </Filtro>
              <Filtro atual={filtro} valor="sem-serie" atuais={atuais} n={semSerie}>
                Sem geração
              </Filtro>
              {arquivadas.length > 0 && (
                <Filtro atual={filtro} valor="arquivadas" atuais={atuais} n={arquivadas.length}>
                  Arquivadas
                </Filtro>
              )}
            </nav>
          </div>

          {filtradas.length === 0 ? (
            <Vazio
              icone={<SearchX size={20} />}
              titulo="Nenhuma usina bate com esse filtro"
              acao={
                <a href="/usinas" className="botao secundario">
                  Limpar filtros
                </a>
              }
            />
          ) : (
            <>
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th scope="col">Cliente e usina</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Portal</th>
                      <th scope="col">Cidade</th>
                      <th scope="col" className="num">Potência</th>
                      <th scope="col" className="num">Instalada</th>
                      <th scope="col" className="num">Equip.</th>
                      <th scope="col" className="num">Geração no banco</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagina.itens.map(({ usina, serie, potenciaSuspeita, semEquipamento, portais, situacao }) => (
                      <tr key={usina.id}>
                        <td>
                          <span className="celula-dupla">
                            {usina.cliente ? (
                              <strong>{usina.cliente.nome}</strong>
                            ) : (
                              <a href="/usinas/sem-dono" className="pilula sev-atencao">
                                sem dono
                              </a>
                            )}
                            <small>{usina.nome}</small>
                          </span>
                        </td>
                        <td>
                          {situacao ? (
                            <span
                              className={`pilula ${situacao.tipo === "geracao_baixa" ? "sev-atencao" : "sev-critico"}`}
                              title={`Desde ${new Date(`${situacao.desde}T12:00:00Z`).toLocaleDateString("pt-BR")}`}
                            >
                              {SITUACAO_ROTULO[situacao.tipo] ?? situacao.tipo}
                              {situacao.dias > 0 ? ` · ${situacao.dias}d` : ""}
                            </span>
                          ) : (
                            <span className="status-ok">
                              <span aria-hidden /> gerando
                            </span>
                          )}
                        </td>
                        <td className={portais.length ? "" : "fraco"}>
                          {portais.length
                            ? [...new Set(portais)].map((p) => (
                                <span key={p} className="etiqueta-portal">
                                  {PORTAL_ROTULO[p] ?? p}
                                </span>
                              ))
                            : "nenhum"}
                        </td>
                        <td>{usina.cidade ?? "—"}</td>
                        <td className={`num ${potenciaSuspeita ? "ruim" : ""}`}>
                          {kWp(usina.potenciaKwp) ?? "—"}
                          {potenciaSuspeita && (
                            <span className="marca" title="Potência impossível para a geração registrada">
                              !
                            </span>
                          )}
                        </td>
                        <td className="num">{usina.dataInstalacao ? usina.dataInstalacao.toLocaleDateString("pt-BR") : "—"}</td>
                        <td className={`num ${semEquipamento ? "fraco" : ""}`}>{usina.equipamentos.length || "—"}</td>
                        <td className="num">
                          {serie ? `${serie.dias} ${serie.dias === 1 ? "dia" : "dias"} · ${kWh(serie.total)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacao {...pagina} rotulo="usinas" href={(n) => endereco("/usinas", atuais, { pagina: n })} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

/** Um botão de filtro que preserva a busca e o portal já escolhidos. */
function Filtro({
  atual,
  valor,
  atuais,
  n,
  perigo,
  children,
}: {
  atual: string;
  valor: string;
  atuais: Record<string, string>;
  n: number;
  perigo?: boolean;
  children: React.ReactNode;
}) {
  const ativo = atual === valor;
  return (
    <a
      href={endereco("/usinas", atuais, { filtro: valor, pagina: null })}
      className={`filtro${ativo ? " ativo" : ""}${perigo ? " perigo" : ""}`}
      aria-current={ativo ? "page" : undefined}
    >
      {children} <span className="filtro-n">{n}</span>
    </a>
  );
}
