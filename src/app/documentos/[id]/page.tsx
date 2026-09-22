import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { exigirAcessoDocumentos } from "@/auth/permissao";
import { db, schema } from "@/db";
import { driveConfigurado } from "@/documentos/drive";

import { EnvioDocumento } from "./envio";

export const dynamic = "force-dynamic";

const ROTULO: Record<string, string> = {
  art: "ART",
  boleto_art: "Boleto da ART",
  contrato: "Contrato",
  memorial: "Memorial",
  procuracao: "Procuração",
  recibo: "Recibo",
  documento_pessoal: "Documento do titular",
  uc_geradora: "Conta de luz da geradora",
  projeto_eletrico: "Projeto elétrico",
  simulacao: "Simulação",
  uc_beneficiaria: "UCs beneficiárias",
  compensativo: "Compensativo",
  nota_fiscal: "Nota fiscal",
  ficha_cadastral: "Ficha cadastral",
  datasheet: "Datasheet e Inmetro",
  comprovante: "Comprovante",
  declaracao: "Declaração",
  orcamento: "Orçamento",
  foto_padrao: "Foto do padrão",
  protocolo: "Protocolo Energisa",
  outro: "Outro",
};

const STATUS_ROTULO: Record<string, string> = {
  indefinido: "",
  trabalho: "arquivo de trabalho",
  aguardando_assinatura: "falta assinar",
  assinado: "assinado",
};

/**
 * O dossiê por dentro: o que tem, o que falta, e onde subir o que falta.
 *
 * É aqui que a adivinhação por nome de arquivo acaba. Cada documento que falta
 * vira um campo de envio com o tipo já definido — a pessoa não batiza arquivo,
 * escolhe a gaveta. O que a importação teve de deduzir de 2.788 nomes, daqui
 * para a frente vem sabido.
 */
export default async function Dossie({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const acesso = await exigirAcessoDocumentos();
  const usuario = acesso.usuario;
  const { id } = await params;

  const projeto = await db.query.projeto.findFirst({
    where: and(
      eq(schema.projeto.id, id),
      eq(schema.projeto.empresaId, usuario.empresaId),
    ),
    with: {
      cliente: true,
      etapa: true,
      documentos: { with: { enviadoPor: { columns: { nome: true } } } },
    },
  });
  if (!projeto) notFound();

  const [todasExigencias, etapas, pessoais] = await Promise.all([
    db.query.exigenciaDocumento.findMany({
      where: eq(schema.exigenciaDocumento.empresaId, usuario.empresaId),
      with: { etapa: true },
    }),
    db.query.etapa.findMany({
      where: eq(schema.etapa.empresaId, usuario.empresaId),
      orderBy: asc(schema.etapa.ordem),
    }),
    // Documentos da pessoa: valem para qualquer dossiê dela.
    db.query.documento.findMany({
      where: and(
        eq(schema.documento.clienteId, projeto.clienteId),
        eq(schema.documento.empresaId, usuario.empresaId),
      ),
      columns: {
        id: true,
        tipo: true,
        status: true,
        versao: true,
        nomeArquivo: true,
        projetoId: true,
        linkDrive: true,
      },
    }),
  ]);

  /**
   * O que este papel cuida. Para o técnico, a tela inteira encolhe para a foto
   * do padrão: ele sobe o que fotografou e não vê a CNH nem o contrato.
   *
   * `presentes` é calculado com **todos** os documentos, e não só com os
   * visíveis — senão o técnico veria "falta conta de luz" num dossiê que tem a
   * conta de luz, só que fora do alcance dele.
   */
  const exigencias = acesso.tudo
    ? todasExigencias
    : todasExigencias.filter((e) => acesso.pode(e.tipo));

  const daPessoa = pessoais.filter((d) => !d.projetoId);
  const noDossie = projeto.documentos;

  /**
   * Uma lista só para a tabela.
   *
   * Os dois lados vêm de consultas diferentes — o do dossiê traz quem enviou,
   * o da pessoa é uma consulta enxuta — e juntar sem normalizar dá um tipo
   * união em que `enviadoPor` não existe de um dos lados.
   */
  const naPasta = [
    ...noDossie.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      status: d.status,
      versao: d.versao,
      nomeArquivo: d.nomeArquivo,
      linkDrive: d.linkDrive,
      daVenda: true,
      enviadoPor: d.enviadoPor?.nome ?? null,
    })),
    ...daPessoa.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      status: d.status,
      versao: d.versao,
      nomeArquivo: d.nomeArquivo,
      linkDrive: d.linkDrive,
      daVenda: false,
      enviadoPor: null,
    })),
  ].sort((a, b) => a.tipo.localeCompare(b.tipo) || b.versao - a.versao);

  /**
   * Tudo que conta como entregue: do dossiê ou da pessoa, menos os de trabalho.
   *
   * Sobre a lista **inteira**, antes de esconder o que não é deste papel. Se
   * fosse calculado sobre o visível, o técnico veria o dossiê pedindo um
   * documento que já está lá.
   */
  const presentes = new Set<string>(
    naPasta.filter((d) => d.status !== "trabalho").map((d) => d.tipo),
  );

  /** O que aparece na tabela: só o que este papel pode abrir. */
  const visiveis = naPasta.filter((d) => acesso.pode(d.tipo));
  const ocultos = naPasta.length - visiveis.length;

  const ordenadas = [...exigencias].sort((a, b) => a.etapa.ordem - b.etapa.ordem);
  const atual = projeto.etapa.ordem;

  const pendentes = ordenadas.filter(
    (e) => e.obrigatorio && e.etapa.ordem <= atual && !presentes.has(e.tipo),
  );
  const futuras = ordenadas.filter(
    (e) => e.obrigatorio && e.etapa.ordem > atual && !presentes.has(e.tipo),
  );

  const semDrive = !driveConfigurado();

  return (
    <main>
      <header className="topo">
        <h1>{projeto.titulo}</h1>
        <span className="sub">{projeto.etapa.nome}</span>
        {projeto.situacao === "concluido" && (
          <span className="pilula sev-info">concluído</span>
        )}
        {pendentes.length > 0 && (
          <span className="alerta">{pendentes.length} para esta etapa</span>
        )}
      </header>

      <p className="aviso">
        <a href="/documentos">← Todos os dossiês</a>
        {projeto.observacoes && (
          <>
            {" · "}
            <span className="fraco">{projeto.observacoes}</span>
          </>
        )}
      </p>

      {semDrive && (
        <p className="aviso">
          <strong>O Drive ainda não está conectado neste servidor.</strong> Dá
          para ver o dossiê e abrir o link do Drive, mas enviar e baixar pelo
          Selebi só funciona depois de rodar{" "}
          <code>npm run drive:autorizar</code> e colocar as três variáveis do
          Google no <code>.env</code>. As instruções estão no cabeçalho de{" "}
          <code>src/documentos/autorizar-drive.ts</code>.
        </p>
      )}

      <h2 className="secao">Falta nesta etapa</h2>
      {pendentes.length === 0 ? (
        <p className="aviso">Nada falta para {projeto.etapa.nome.toLowerCase()}.</p>
      ) : (
        <div className="cartoes">
          {pendentes.map((e) => (
            <div key={e.tipo} className="cartao">
              <h3>{ROTULO[e.tipo] ?? e.tipo}</h3>
              <p className="fraco">{e.observacao}</p>
              <EnvioDocumento
                projetoId={projeto.id}
                tipo={e.tipo}
                exigeAssinatura={e.exigeAssinatura}
                desabilitado={semDrive}
              />
            </div>
          ))}
        </div>
      )}

      <h2 className="secao">Na pasta ({visiveis.length})</h2>
      {ocultos > 0 && (
        <p className="aviso">
          Outros {ocultos} documentos deste dossiê são de outras etapas e não
          aparecem para o seu perfil. Documento de cliente guarda CNH, CPF e
          conta de luz — cada um enxerga o que precisa para trabalhar.
        </p>
      )}
      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Arquivo</th>
              <th>Situação</th>
              <th>Versão</th>
              <th>De</th>
              <th>Quem enviou</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((d) => (
              <tr key={d.id}>
                <td className="forte">{ROTULO[d.tipo] ?? d.tipo}</td>
                {/* `title` porque o nome é cortado: os do Drive passam de 80
                    caracteres e sem isto a informação some de vez. */}
                <td className="fraco nome-arquivo" title={d.nomeArquivo}>
                  {d.nomeArquivo}
                </td>
                <td>
                  {STATUS_ROTULO[d.status] ? (
                    <span
                      className={`pilula ${
                        d.status === "assinado" ? "sev-info" : "sev-atencao"
                      }`}
                    >
                      {STATUS_ROTULO[d.status]}
                    </span>
                  ) : (
                    <span className="fraco">—</span>
                  )}
                </td>
                <td className="fraco">{d.versao > 1 ? `v${d.versao}` : "—"}</td>
                <td className="fraco">{d.daVenda ? "desta venda" : "da pessoa"}</td>
                <td className="fraco">
                  {d.enviadoPor ?? "importado do Drive"}
                </td>
                <td>
                  {semDrive ? (
                    d.linkDrive ? (
                      <a href={d.linkDrive} target="_blank" rel="noreferrer">
                        abrir no Google
                      </a>
                    ) : (
                      "—"
                    )
                  ) : (
                    <a href={`/documentos/arquivo/${d.id}`}>baixar</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {futuras.length > 0 && (
        <>
          <h2 className="secao">Ainda não é hora</h2>
          <p className="aviso">
            Estes documentos passam a ser cobrados mais adiante na esteira. Se
            já tiver em mãos, pode subir agora — não faz mal adiantar.
          </p>
          <div className="cartoes">
            {futuras.map((e) => (
              <div key={e.tipo} className="cartao">
                <h3>
                  {ROTULO[e.tipo] ?? e.tipo}{" "}
                  <span className="fraco">· {e.etapa.nome}</span>
                </h3>
                <p className="fraco">{e.observacao}</p>
                <EnvioDocumento
                  projetoId={projeto.id}
                  tipo={e.tipo}
                  exigeAssinatura={e.exigeAssinatura}
                  desabilitado={semDrive}
                />
              </div>
            ))}
          </div>
        </>
      )}

      <p className="aviso fraco">
        Esteira: {etapas.map((e) => e.nome).join(" → ")}
      </p>
    </main>
  );
}
