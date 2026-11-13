import { and, asc, eq } from "drizzle-orm";
import { ExternalLink, FolderOpen, Info, MessageCircle, Search, SearchX, TrendingUp } from "lucide-react";
import Link from "next/link";

import { exigirAcessoDocumentos } from "@/auth/permissao";
import { db, schema } from "@/db";
import { ehDoCliente } from "@/documentos/cobranca";

import { Cabecalho, Cartao, Vazio } from "../_ui";
import { endereco, paginar, Paginacao } from "../_ui/paginacao";
import { Pendencias } from "../_ui/pendencias";
import { SeletorFiltro } from "../_ui/seletor-filtro";
import { semAcento } from "../formatar";

export const dynamic = "force-dynamic";

/**
 * O dossiê de cada venda, e o que falta para ele avançar.
 *
 * Duas regras fazem esta tela ser lista de trabalho em vez de lista de
 * lamentação:
 *
 * 1. **O documento só é cobrado a partir da etapa em que deveria existir.**
 *    Quem fechou contrato semana passada não deve aparecer em vermelho por não
 *    ter ART — o engenheiro nem começou o projeto. A regra mora em
 *    `exigencia_documento`, então mudar é UPDATE, não migration.
 *
 * 2. **Arquivo de trabalho não conta.** O `.dwg` e a planilha `.xlsm` são o
 *    meio do caminho, não o entregável. Nove clientes tinham como único
 *    memorial a planilha do engenheiro e passavam por completos.
 *
 * **O que esta tela NÃO diz é "atrasado".** Nos 171 dossiês que vieram do
 * Drive a etapa foi deduzida justamente pelos documentos que faltam, então
 * dizer que eles estão em falta na própria etapa seria raciocínio circular — e
 * a primeira versão desta tela caiu nele, acusando 116 de 118. O que a coluna
 * mostra é **o que falta para sair da etapa atual**, que é a mesma informação
 * sem a acusação. Atraso de verdade só existe quando alguém move a etapa à
 * mão, e aí a comparação passa a valer.
 */

const ROTULO: Record<string, string> = {
  art: "ART",
  boleto_art: "Boleto ART",
  contrato: "Contrato",
  memorial: "Memorial",
  procuracao: "Procuração",
  recibo: "Recibo",
  documento_pessoal: "Documento do titular",
  uc_geradora: "Conta de luz",
  projeto_eletrico: "Projeto elétrico",
  simulacao: "Simulação",
  uc_beneficiaria: "UCs beneficiárias",
  compensativo: "Compensativo",
  nota_fiscal: "Nota fiscal",
  ficha_cadastral: "Ficha",
  datasheet: "Datasheet",
  comprovante: "Comprovante",
  declaracao: "Declaração",
  orcamento: "Orçamento",
  foto_padrao: "Foto do padrão",
  protocolo: "Protocolo Energisa",
  outro: "Outro",
};

export default async function Documentos({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; busca?: string; etapa?: string; pagina?: string }>;
}) {
  const acesso = await exigirAcessoDocumentos();
  const usuario = acesso.usuario;
  const { filtro = "", busca = "", etapa: etapaFiltro = "", pagina: paginaPedida } = await searchParams;

  const [etapas, todasExigencias, projetos] = await Promise.all([
    db.query.etapa.findMany({
      where: and(eq(schema.etapa.empresaId, usuario.empresaId), eq(schema.etapa.ativa, true)),
      orderBy: asc(schema.etapa.ordem),
    }),
    db.query.exigenciaDocumento.findMany({
      where: eq(schema.exigenciaDocumento.empresaId, usuario.empresaId),
      with: { etapa: true },
    }),
    db.query.projeto.findMany({
      where: eq(schema.projeto.empresaId, usuario.empresaId),
      with: { cliente: true, etapa: true, documentos: true },
    }),
  ]);

  /**
   * Estreitar aqui estreita tudo.
   *
   * Filtrando as exigências pelo papel logo na entrada, a coluna do que falta,
   * a contagem dos gargalos e os filtros já saem no escopo de quem está
   * olhando — sem `if` espalhado pela tela. Para o técnico a lista vira "os
   * dossiês esperando a minha foto", que é a lista que ele usaria.
   */
  const exigencias = acesso.tudo
    ? todasExigencias
    : todasExigencias.filter((e) => acesso.pode(e.tipo));

  /**
   * Documentos que são da pessoa e não da venda — CNH, RG, ficha.
   *
   * Contam para todos os dossiês do cliente: quem mandou a CNH uma vez não
   * deve aparecer sem documento do titular no segundo projeto.
   */
  const doCliente = await db.query.documento.findMany({
    where: eq(schema.documento.empresaId, usuario.empresaId),
    columns: { clienteId: true, tipo: true, status: true, projetoId: true },
  });
  const tiposDaPessoa = new Map<string, Set<string>>();
  for (const d of doCliente) {
    if (d.projetoId || d.status === "trabalho") continue;
    const s = tiposDaPessoa.get(d.clienteId) ?? new Set<string>();
    s.add(d.tipo);
    tiposDaPessoa.set(d.clienteId, s);
  }

  const linhas = projetos.map((p) => {
    const ordemAtual = p.etapa.ordem;

    // O que já conta como entregue: qualquer coisa que não seja arquivo de
    // trabalho, do dossiê ou da pessoa.
    const presentes = new Set<string>(
      p.documentos.filter((d) => d.status !== "trabalho").map((d) => d.tipo),
    );
    for (const t of tiposDaPessoa.get(p.clienteId) ?? []) presentes.add(t);

    const exigidosAgora = exigencias.filter(
      (e) => e.obrigatorio && e.etapa.ordem <= ordemAtual,
    );
    const falta = exigidosAgora.filter((e) => !presentes.has(e.tipo));

    /**
     * Documento que existe, precisa de assinatura e não temos a versão
     * assinada — mas só quando o nome do arquivo **diz** que está esperando
     * assinatura. Para os 2.378 arquivos que não dizem nada, `indefinido` é a
     * resposta certa e cobrar seria inventar pendência.
     */
    const semAssinatura = exigencias
      .filter((e) => e.exigeAssinatura && presentes.has(e.tipo))
      .filter((e) => {
        const doTipo = p.documentos.filter((d) => d.tipo === e.tipo);
        const assinado = doTipo.some((d) => d.status === "assinado");
        const esperando = doTipo.some((d) => d.status === "aguardando_assinatura");
        return !assinado && esperando;
      });

    // Só de trabalho: o arquivo existe, mas é o `.dwg`, não o entregável.
    const soTrabalho = exigencias
      .filter((e) => e.obrigatorio && e.etapa.ordem <= ordemAtual)
      .filter(
        (e) =>
          !presentes.has(e.tipo) &&
          p.documentos.some((d) => d.tipo === e.tipo && d.status === "trabalho"),
      );

    return {
      projeto: p,
      falta,
      semAssinatura,
      soTrabalho,
      exigidos: exigidosAgora.length,
      pasta: p.documentos.find((d) => d.linkDrive)?.linkDrive ?? null,
    };
  });
  // Ordem de arquivo: pelo nome, como as pastas do Drive.
  linhas.sort((a, b) => a.projeto.titulo.localeCompare(b.projeto.titulo, "pt-BR"));

  const alvo = semAcento(busca.trim());

  const ativos = linhas.filter((l) => l.projeto.situacao !== "concluido");
  const base = filtro === "concluidos" ? linhas : ativos;

  const filtradas = base.filter((l) => {
    if (alvo) {
      if (!semAcento(`${l.projeto.titulo} ${l.projeto.cliente?.nome ?? ""}`).includes(alvo)) return false;
    }
    if (etapaFiltro && l.projeto.etapa.slug !== etapaFiltro) return false;
    if (filtro === "pendentes") return l.falta.length > 0;
    if (filtro === "assinatura") return l.semAssinatura.length > 0;
    if (filtro === "trabalho") return l.soTrabalho.length > 0;
    if (filtro === "emdia") return l.falta.length === 0;
    return true;
  });

  const pendentes = ativos.filter((l) => l.falta.length > 0).length;
  const emDia = ativos.filter((l) => l.falta.length === 0).length;
  const esperandoAssinatura = ativos.filter((l) => l.semAssinatura.length > 0).length;
  const apenasTrabalho = ativos.filter((l) => l.soTrabalho.length > 0).length;
  const concluidos = linhas.length - ativos.length;

  const porEtapa = new Map<string, number>();
  for (const l of ativos) {
    porEtapa.set(l.projeto.etapa.slug, (porEtapa.get(l.projeto.etapa.slug) ?? 0) + 1);
  }

  /**
   * Qual documento está segurando mais gente.
   *
   * É a pergunta que transforma 116 linhas numa tarde de trabalho: se 62
   * dossiês param no mesmo papel, o serviço não é ligar para 62 clientes, é
   * resolver aquele papel. Some por dossiê, não por arquivo.
   */
  const gargalos = new Map<string, number>();
  for (const l of ativos) {
    for (const e of l.falta) gargalos.set(e.tipo, (gargalos.get(e.tipo) ?? 0) + 1);
  }
  const maioresGargalos = [...gargalos].sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (linhas.length === 0) {
    return (
      <main>
        <Cabecalho titulo="Dossiês" />
        <div className="pagina-corpo">
          <Vazio icone={<FolderOpen size={20} />} titulo="Nenhum dossiê ainda">
            Rode <code>scripts/listar-drive.gs</code> no Apps Script da conta do Google, baixe o CSV para{" "}
            <code>dados/</code> e então <code>npm run import:drive -- &quot;dados/arquivo.csv&quot;</code> seguido de{" "}
            <code>npm run dossies</code>.
          </Vazio>
        </div>
      </main>
    );
  }

  const pagina = paginar(filtradas, paginaPedida);
  const atuais = { busca, filtro, etapa: etapaFiltro };
  const maiorGargalo = Math.max(1, ...maioresGargalos.map(([, n]) => n));

  return (
    <main>
      <Cabecalho
        titulo="Dossiês"
        selos={pendentes > 0 ? <span className="pilula sev-atencao">{pendentes} esperando documento</span> : undefined}
        acoes={
          <Link href="/documentos/cobranca" className="botao">
            <MessageCircle size={15} aria-hidden /> Cobrar clientes
          </Link>
        }
        meta={
          <span>
            {base.length} {filtro === "concluidos" ? "dossiês" : "em andamento"}
          </span>
        }
      />

      <div className="pagina-corpo pilha">
        {maioresGargalos.length > 0 && (
          <Cartao
            titulo="O que está segurando mais gente"
            icone={<TrendingUp size={16} />}
            ajuda="Resolver o papel de cima destrava mais do que ligar para cliente por cliente. O que é do cliente mandar leva direto à fila de cobrança, com a mensagem pronta para o WhatsApp."
          >
            <ul className="funil funil-solto">
              {maioresGargalos.map(([tipo, n]) => (
                <li key={tipo}>
                  <a
                    className="funil-rotulo"
                    href={ehDoCliente(tipo) ? `/documentos/cobranca?tipo=${tipo}` : endereco("/documentos", { filtro: "pendentes", busca })}
                  >
                    {ROTULO[tipo] ?? tipo}
                  </a>
                  <span className="funil-barra">
                    <span style={{ width: `${Math.max(4, (n / maiorGargalo) * 100)}%` }} />
                  </span>
                  <span className="funil-num">{n}</span>
                </li>
              ))}
            </ul>
          </Cartao>
        )}

        {!acesso.tudo && (
          <p className="aviso aviso-solto">
            <strong>Você está vendo os documentos das suas etapas</strong> —{" "}
            {[...acesso.tipos].map((t) => ROTULO[t] ?? t).join(", ")}. O resto do
            dossiê existe, mas é de outra pessoa: documento de cliente guarda CNH,
            CPF e conta de luz, e cada um enxerga só o que precisa para trabalhar.
          </p>
        )}

        <section className="lista" id="lista" aria-label="Dossiês">
          <div className="lista-barra">
            <form className="campo-busca" action="/documentos">
              <Search size={15} aria-hidden />
              <input type="search" name="busca" placeholder="Buscar cliente" defaultValue={busca} aria-label="Buscar cliente" />
              {filtro && <input type="hidden" name="filtro" value={filtro} />}
              {etapaFiltro && <input type="hidden" name="etapa" value={etapaFiltro} />}
            </form>
            <SeletorFiltro
              rotulo="Etapa"
              atual={etapaFiltro}
              opcoes={[
                { valor: "", rotulo: "Todas", href: endereco("/documentos", atuais, { etapa: null }) },
                ...etapas
                  .filter((e) => (porEtapa.get(e.slug) ?? 0) > 0)
                  .map((e) => ({
                    valor: e.slug,
                    rotulo: `${e.nome} (${porEtapa.get(e.slug)})`,
                    href: endereco("/documentos", atuais, { etapa: e.slug }),
                  })),
              ]}
            />
            <nav className="filtros" aria-label="Situação">
              <Filtro atual={filtro} valor="" atuais={atuais} n={ativos.length}>
                Em andamento
              </Filtro>
              <Filtro atual={filtro} valor="pendentes" atuais={atuais} n={pendentes} perigo>
                Esperando documento
              </Filtro>
              {esperandoAssinatura > 0 && (
                <Filtro atual={filtro} valor="assinatura" atuais={atuais} n={esperandoAssinatura} perigo>
                  Falta assinar
                </Filtro>
              )}
              {apenasTrabalho > 0 && (
                <Filtro atual={filtro} valor="trabalho" atuais={atuais} n={apenasTrabalho} perigo>
                  Só o arquivo de trabalho
                </Filtro>
              )}
              <Filtro atual={filtro} valor="emdia" atuais={atuais} n={emDia}>
                Em dia
              </Filtro>
              <Filtro atual={filtro} valor="concluidos" atuais={atuais} n={concluidos}>
                Com os concluídos
              </Filtro>
            </nav>
          </div>

          {filtradas.length === 0 ? (
            <Vazio
              icone={<SearchX size={20} />}
              titulo="Nenhum dossiê bate com esse filtro"
              acao={
                <a href="/documentos" className="botao secundario">
                  Limpar filtros
                </a>
              }
            />
          ) : (
            <>
              <div className="tabela-rolagem">
                <table className="tabela tabela-dossies">
                  <thead>
                    <tr>
                      <th scope="col">Cliente</th>
                      <th scope="col">Etapa</th>
                      <th scope="col">Entregues</th>
                      <th scope="col">Falta para avançar</th>
                      <th scope="col" className="col-acao">
                        <span className="sr-only">Pasta no Drive</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagina.itens.map(({ projeto, falta, semAssinatura, soTrabalho, exigidos, pasta }) => (
                      <tr key={projeto.id}>
                        <td>
                          <a className="celula-dupla" href={`/documentos/${projeto.id}`}>
                            <strong>{projeto.titulo}</strong>
                            <small>
                              {[projeto.cliente?.cidade, projeto.situacao === "concluido" ? "concluído" : null]
                                .filter(Boolean)
                                .join(" · ") || "sem cidade"}
                            </small>
                          </a>
                        </td>
                        <td className="fraco">{projeto.etapa.nome}</td>
                        <td>
                          <Progresso feitos={exigidos - falta.length} total={exigidos} />
                        </td>
                        <td>
                          <Pendencias
                            itens={[
                              ...falta.map((e) => ({ rotulo: ROTULO[e.tipo] ?? e.tipo })),
                              ...semAssinatura.map((e) => ({ rotulo: `${ROTULO[e.tipo] ?? e.tipo} (falta assinar)`, peso: "meio" as const })),
                              ...soTrabalho.map((e) => ({ rotulo: `${ROTULO[e.tipo] ?? e.tipo} (só o de trabalho)`, peso: "meio" as const })),
                            ]}
                            vazio={
                              <span className="status-ok">
                                <span aria-hidden /> em dia
                              </span>
                            }
                          />
                        </td>
                        <td className="col-acao">
                          {pasta && (
                            <a
                              className="botao-icone"
                              href={pasta}
                              target="_blank"
                              rel="noreferrer"
                              title="Abrir a pasta no Drive"
                              aria-label={`Abrir a pasta de ${projeto.titulo} no Drive`}
                            >
                              <ExternalLink size={15} aria-hidden />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacao {...pagina} rotulo="dossiês" href={(n) => endereco("/documentos", atuais, { pagina: n })} />
            </>
          )}
        </section>

        <details className="como-ler como-ler-solto">
          <summary>
            <Info size={15} aria-hidden /> Como os documentos são cobrados
          </summary>
          <div>
            <p>
              <strong>Cada documento só é cobrado a partir da etapa em que deveria existir.</strong> A conta de luz na
              coleta de informações, as fotos do padrão na vistoria técnica, o documento do titular na documentação,
              contrato e procuração no contrato, projeto/memorial/ART no projeto, o protocolo na aprovação da
              concessionária. Quem fechou ontem não aparece devendo ART. A regra está na tabela{" "}
              <code>exigencia_documento</code> e é para o dono corrigir olhando.
            </p>
            <p>
              <strong>Arquivo de trabalho não conta como documento.</strong> O <code>.dwg</code> do projeto e a planilha{" "}
              <code>.xlsm</code> do memorial são o meio do caminho — nove clientes tinham como único memorial a planilha e
              passavam por completos. Documento pessoal fica com a pessoa, não com a venda: quem já mandou a CNH não
              precisa mandar de novo no segundo projeto.
            </p>
          </div>
        </details>
      </div>
    </main>
  );
}

/** Quantos dos documentos exigidos até a etapa atual já chegaram. */
function Progresso({ feitos, total }: { feitos: number; total: number }) {
  if (total === 0) return <span className="fraco">—</span>;
  const pct = Math.round((feitos / total) * 100);
  return (
    <span
      className={`progresso-mini${feitos === total ? " completo" : ""}`}
      title={`${feitos} de ${total} documentos exigidos até esta etapa`}
    >
      <span className="progresso-trilho" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span>
        {feitos}/{total}
      </span>
    </span>
  );
}

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
      href={endereco("/documentos", atuais, { filtro: valor, pagina: null })}
      className={`filtro${ativo ? " ativo" : ""}${perigo ? " perigo" : ""}`}
      aria-current={ativo ? "page" : undefined}
    >
      {children} <span className="filtro-n">{n}</span>
    </a>
  );
}
