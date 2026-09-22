import { asc, eq } from "drizzle-orm";

import { exigirAcessoDocumentos } from "@/auth/permissao";
import { db, schema } from "@/db";

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
  searchParams: Promise<{ filtro?: string; busca?: string; etapa?: string }>;
}) {
  const acesso = await exigirAcessoDocumentos();
  const usuario = acesso.usuario;
  const { filtro = "", busca = "", etapa: etapaFiltro = "" } = await searchParams;

  const [etapas, todasExigencias, projetos] = await Promise.all([
    db.query.etapa.findMany({
      where: eq(schema.etapa.empresaId, usuario.empresaId),
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
      total: p.documentos.length,
      pasta: p.documentos.find((d) => d.linkDrive)?.linkDrive ?? null,
    };
  });

  const alvo = busca
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  const ativos = linhas.filter((l) => l.projeto.situacao !== "concluido");
  const base = filtro === "concluidos" ? linhas : ativos;

  const filtradas = base.filter((l) => {
    if (alvo) {
      const nome = (l.projeto.cliente?.nome ?? l.projeto.titulo)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      if (!nome.includes(alvo)) return false;
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
        <header className="topo">
          <h1>Dossiês</h1>
        </header>
        <div className="vazio">
          <p>
            Nenhum dossiê ainda. Rode <code>scripts/listar-drive.gs</code> no
            Apps Script da conta do Google, baixe o CSV para <code>dados/</code>{" "}
            e então <code>npm run import:drive -- &quot;dados/arquivo.csv&quot;</code>{" "}
            seguido de <code>npm run dossies</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="topo">
        <h1>Dossiês</h1>
        <span className="sub">
          {filtradas.length === base.length
            ? `${base.length} ${filtro === "concluidos" ? "dossiês" : "em andamento"}`
            : `${filtradas.length} de ${base.length}`}
        </span>
        {pendentes > 0 && (
          <span className="alerta">{pendentes} esperando documento</span>
        )}
      </header>

      {maioresGargalos.length > 0 && (
        <p className="aviso">
          <strong>O que está segurando mais gente:</strong>{" "}
          {maioresGargalos.map(([tipo, n], i) => (
            <span key={tipo}>
              {i > 0 && " · "}
              <a href={montar({ filtro: "pendentes", busca })}>
                {ROTULO[tipo] ?? tipo}
              </a>{" "}
              em <strong>{n}</strong> dossiês
            </span>
          ))}
          . Resolver o papel de cima destrava mais do que ligar para cliente por
          cliente.
        </p>
      )}

      <div className="barra-usinas">
        <form className="busca" action="/documentos">
          <input
            type="search"
            name="busca"
            placeholder="Nome do cliente"
            defaultValue={busca}
            aria-label="Buscar cliente"
          />
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          {etapaFiltro && <input type="hidden" name="etapa" value={etapaFiltro} />}
          <button type="submit">Buscar</button>
        </form>
      </div>

      <div className="barra-usinas">
        <span className="rotulo-filtro">Situação</span>
        <nav className="filtros">
          <Filtro atual={filtro} valor="" busca={busca} etapa={etapaFiltro}>
            Em andamento ({ativos.length})
          </Filtro>
          <Filtro atual={filtro} valor="pendentes" busca={busca} etapa={etapaFiltro} perigo>
            Esperando documento ({pendentes})
          </Filtro>
          {esperandoAssinatura > 0 && (
            <Filtro atual={filtro} valor="assinatura" busca={busca} etapa={etapaFiltro} perigo>
              Falta assinar ({esperandoAssinatura})
            </Filtro>
          )}
          {apenasTrabalho > 0 && (
            <Filtro atual={filtro} valor="trabalho" busca={busca} etapa={etapaFiltro} perigo>
              Só o arquivo de trabalho ({apenasTrabalho})
            </Filtro>
          )}
          <Filtro atual={filtro} valor="emdia" busca={busca} etapa={etapaFiltro}>
            Em dia ({emDia})
          </Filtro>
          <Filtro atual={filtro} valor="concluidos" busca={busca} etapa={etapaFiltro}>
            Incluir concluídos ({concluidos})
          </Filtro>
        </nav>
      </div>

      <div className="barra-usinas">
        <span className="rotulo-filtro">Etapa</span>
        <nav className="filtros">
          <FiltroEtapa atual={etapaFiltro} valor="" busca={busca} filtro={filtro}>
            Todas
          </FiltroEtapa>
          {etapas
            .filter((e) => (porEtapa.get(e.slug) ?? 0) > 0)
            .map((e) => (
              <FiltroEtapa
                key={e.slug}
                atual={etapaFiltro}
                valor={e.slug}
                busca={busca}
                filtro={filtro}
              >
                {e.nome} ({porEtapa.get(e.slug)})
              </FiltroEtapa>
            ))}
        </nav>
      </div>

      {!acesso.tudo && (
        <p className="aviso">
          <strong>Você está vendo os documentos das suas etapas</strong> —{" "}
          {[...acesso.tipos].map((t) => ROTULO[t] ?? t).join(", ")}. O resto do
          dossiê existe, mas é de outra pessoa: documento de cliente guarda CNH,
          CPF e conta de luz, e cada um enxerga só o que precisa para trabalhar.
        </p>
      )}

      <p className="aviso">
        <strong>Cada documento só é cobrado a partir da etapa em que deveria
        existir.</strong>{" "}
        A conta de luz na coleta de informações, as fotos do padrão na vistoria
        técnica, o documento do titular na documentação, contrato e procuração
        no contrato, projeto/memorial/ART no projeto, o protocolo na aprovação
        da concessionária. Quem fechou ontem não aparece devendo ART. A regra
        está na tabela <code>exigencia_documento</code> e é para o dono
        corrigir olhando.
      </p>

      <p className="aviso">
        <strong>Arquivo de trabalho não conta como documento.</strong> O{" "}
        <code>.dwg</code> do projeto e a planilha <code>.xlsm</code> do memorial
        são o meio do caminho — nove clientes tinham como único memorial a
        planilha e passavam por completos. Documento pessoal fica com a pessoa,
        não com a venda: quem já mandou a CNH não precisa mandar de novo no
        segundo projeto.
      </p>

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th>Dossiê</th>
              <th>Etapa</th>
              <th>Falta para avançar</th>
              <th>Atenção</th>
              <th>Papéis</th>
              <th>Drive</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(
              ({ projeto, falta, semAssinatura, soTrabalho, total, pasta }) => (
                <tr key={projeto.id}>
                  <td className="forte">
                    <a href={`/documentos/${projeto.id}`}>{projeto.titulo}</a>
                    {projeto.situacao === "concluido" && (
                      <span className="pilula sev-info">concluído</span>
                    )}
                  </td>
                  <td className="fraco">{projeto.etapa.nome}</td>
                  <td>
                    {falta.length === 0 ? (
                      <span className="pilula sev-info">em dia</span>
                    ) : (
                      falta.map((e) => (
                        <span key={e.tipo} className="pilula sev-critico">
                          {ROTULO[e.tipo] ?? e.tipo}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    {soTrabalho.map((e) => (
                      <span key={`t-${e.tipo}`} className="pilula sev-atencao">
                        {ROTULO[e.tipo] ?? e.tipo}: só o arquivo de trabalho
                      </span>
                    ))}
                    {semAssinatura.map((e) => (
                      <span key={`a-${e.tipo}`} className="pilula sev-atencao">
                        {ROTULO[e.tipo] ?? e.tipo}: falta assinar
                      </span>
                    ))}
                    {soTrabalho.length === 0 && semAssinatura.length === 0 && (
                      <span className="fraco">—</span>
                    )}
                  </td>
                  <td className="fraco">{total}</td>
                  <td>
                    {pasta ? (
                      <a href={pasta} target="_blank" rel="noreferrer">
                        abrir
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {filtradas.length === 0 && (
        <div className="vazio">
          <p>Nenhum dossiê bate com esse filtro.</p>
        </div>
      )}
    </main>
  );
}

function montar(params: Record<string, string>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const q = p.toString();
  return `/documentos${q ? `?${q}` : ""}`;
}

function Filtro({
  atual,
  valor,
  busca,
  etapa,
  perigo,
  children,
}: {
  atual: string;
  valor: string;
  busca: string;
  etapa: string;
  perigo?: boolean;
  children: React.ReactNode;
}) {
  const ativo = atual === valor;
  return (
    <a
      href={montar({ busca, filtro: valor, etapa })}
      className={`filtro${ativo ? " ativo" : ""}${perigo ? " perigo" : ""}`}
      aria-current={ativo ? "page" : undefined}
    >
      {children}
    </a>
  );
}

function FiltroEtapa({
  atual,
  valor,
  busca,
  filtro,
  children,
}: {
  atual: string;
  valor: string;
  busca: string;
  filtro: string;
  children: React.ReactNode;
}) {
  const ativo = atual === valor;
  return (
    <a
      href={montar({ busca, filtro, etapa: valor })}
      className={`filtro${ativo ? " ativo" : ""}`}
      aria-current={ativo ? "page" : undefined}
    >
      {children}
    </a>
  );
}
