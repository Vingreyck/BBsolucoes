import { and, asc, eq } from "drizzle-orm";
import {
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileWarning,
  FolderOpen,
  KanbanSquare,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ehUuid } from "@/app-movel/http";
import { exigirAcessoDocumentos } from "@/auth/permissao";
import { db, schema } from "@/db";
import { linkWhatsapp, mensagemDeCobranca, numeroWhatsapp, tiposEntregues } from "@/documentos/cobranca";
import { driveConfigurado } from "@/documentos/drive";
import { filaDeCobranca } from "@/documentos/fila-cobranca";
import { COBRAR_NO_CARTAO, ORIGEM_AUTOMATICA, ROTULO_DOCUMENTO } from "@/documentos/rotulos";
import { pacoteDeEnvio } from "@/energisa/envio-pacote";

import { Cabecalho, Caminho, Cartao, Vazio } from "../../_ui";
import { BotaoCobrar } from "../cobranca/botao-cobrar";
import { EnvioDocumento } from "./envio";
import { AbrirNoPortal, CopiarValor, JaEnviei } from "./envio-energisa";

export const dynamic = "force-dynamic";

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
  // O que vem no endereço é palpite de quem digita: id malformado é 404, não erro.
  if (!ehUuid(id)) notFound();

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
      where: and(eq(schema.etapa.empresaId, usuario.empresaId), eq(schema.etapa.ativa, true)),
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
  const presentes = tiposEntregues(
    naPasta,
    new Set(todasExigencias.filter((e) => e.exigeAssinatura).map((e) => e.tipo)),
  );
  // O protocolo é fato que o sistema já sabe (ver `DOCUMENTOS_DE_FATO`).
  const naEnergisa = await db.query.energisaProjeto.findFirst({
    where: and(eq(schema.energisaProjeto.empresaId, usuario.empresaId), eq(schema.energisaProjeto.projetoId, projeto.id)),
    columns: { numero: true },
  });
  if (naEnergisa || projeto.protocoloConcessionaria) presentes.add("protocolo");

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

  // Na etapa Projeto, o engenheiro junta o pedido de acesso e manda pelo portal.
  const envio =
    projeto.etapa.slug === "projeto" && projeto.situacao === "em_andamento" && acesso.pode("protocolo")
      ? await pacoteDeEnvio(usuario.empresaId, projeto.id)
      : null;

  // O que falta e é do cliente mandar: vira o botão do WhatsApp no cabeçalho.
  const [cobranca] = await filaDeCobranca(usuario.empresaId, { pode: acesso.pode, projetoId: projeto.id });
  const empresa = await db.query.empresa.findFirst({
    where: eq(schema.empresa.id, usuario.empresaId),
    columns: { nome: true },
  });
  const whatsCliente = numeroWhatsapp(projeto.cliente.telefone);
  // Quais tipos já foram cobrados deste dossiê: a 2ª mensagem diz "passando para lembrar".
  const cobrados = new Set(
    (
      await db
        .select({ tipos: schema.cobrancaDocumento.tipos })
        .from(schema.cobrancaDocumento)
        .where(eq(schema.cobrancaDocumento.projetoId, projeto.id))
    ).flatMap((c) => c.tipos),
  );

  /**
   * Um cartão de documento que falta.
   *
   * - O que chega sozinho (foto do padrão, conta de luz, protocolo) diz de onde
   *   vem, e o envio à mão fica dobrado, só para quando o automático falhar.
   * - O que é do cliente mandar (documento, contrato, recibo) tem o botão de
   *   cobrar no WhatsApp, com a mensagem pedindo só aquele documento.
   */
  const cartaoDoDocumento = (e: (typeof exigencias)[number], comEtapa: boolean) => {
    const auto = ORIGEM_AUTOMATICA[e.tipo];
    const cobrar = COBRAR_NO_CARTAO.has(e.tipo) && acesso.pode(e.tipo);
    const envio = (
      <EnvioDocumento projetoId={projeto.id} tipo={e.tipo} exigeAssinatura={e.exigeAssinatura} desabilitado={semDrive} />
    );
    return (
      <div key={e.tipo} className="cartao cartao-documento">
        <h3>
          {ROTULO_DOCUMENTO[e.tipo] ?? e.tipo}
          {comEtapa && <span className="fraco"> · {e.etapa.nome}</span>}
        </h3>
        <p className="fraco">{e.observacao}</p>
        {auto && (
          <p className="cartao-documento-auto">
            <Sparkles size={13} aria-hidden /> {auto}
          </p>
        )}
        {e.tipo === "contrato" && (
          <p className="cartao-documento-auto">
            <Sparkles size={13} aria-hidden /> O Selebi gera o contrato na etapa Contrato. Aqui entra a via assinada que o
            cliente devolver — com ela, a esteira anda sozinha.
          </p>
        )}
        {cobrar &&
          (whatsCliente ? (
            <BotaoCobrar
              projetoId={projeto.id}
              tipo={e.tipo}
              rotulo={cobrados.has(e.tipo) ? "Lembrar no WhatsApp" : "Cobrar no WhatsApp"}
              link={linkWhatsapp(
                whatsCliente,
                mensagemDeCobranca({
                  cliente: projeto.cliente.nome,
                  empresa: empresa?.nome ?? "nossa empresa",
                  tipos: [e.tipo],
                  jaCobrado: cobrados.has(e.tipo),
                }),
              )}
            />
          ) : (
            <p className="nota">
              Sem um telefone válido no cadastro do cliente.{" "}
              <Link href={`/projeto/${projeto.id}`}>Corrigir no projeto</Link>
            </p>
          ))}
        {auto ? (
          <details className="dobra-limpa">
            <summary>Enviar à mão</summary>
            {envio}
          </details>
        ) : (
          envio
        )}
      </div>
    );
  };

  // Quanto do que já devia existir está na pasta: a régua do dossiê.
  const devidos = ordenadas.filter((e) => e.obrigatorio && e.etapa.ordem <= atual);
  const entregues = devidos.filter((e) => presentes.has(e.tipo)).length;
  const indiceEtapa = etapas.findIndex((e) => e.id === projeto.etapaId);

  return (
    <main>
      <Cabecalho
        trilha={[
          { href: "/documentos", rotulo: "Dossiês" },
          { href: `/projeto/${projeto.id}`, rotulo: projeto.cliente.nome },
        ]}
        titulo={`Dossiê · ${projeto.cliente.nome}`}
        selos={
          <>
            <span className="ui-selo ui-selo-marca">{projeto.etapa.nome}</span>
            {projeto.situacao === "concluido" && <span className="pilula sev-info">concluído</span>}
            {pendentes.length > 0 && <span className="pilula sev-atencao">{pendentes.length} faltando nesta etapa</span>}
          </>
        }
        meta={
          <>
            <span>{projeto.titulo}</span>
            {projeto.observacoes && <span className="fraco">{projeto.observacoes}</span>}
          </>
        }
        acoes={
          <>
            {cobranca?.whatsapp && (
              <BotaoCobrar
                projetoId={projeto.id}
                rotulo={cobranca.vezes > 0 ? "Lembrar no WhatsApp" : "Cobrar no WhatsApp"}
                link={linkWhatsapp(
                  cobranca.whatsapp,
                  mensagemDeCobranca({
                    cliente: projeto.cliente.nome,
                    empresa: empresa?.nome ?? "nossa empresa",
                    tipos: cobranca.tipos,
                    jaCobrado: cobranca.vezes > 0,
                  }),
                )}
              />
            )}
            <Link href={`/projeto/${projeto.id}`} className="botao secundario">
              <KanbanSquare size={15} aria-hidden /> Ver o projeto
            </Link>
          </>
        }
      />

      {indiceEtapa >= 0 && (
        <div className="faixa-caminho">
          <Caminho etapas={etapas} atual={indiceEtapa} compacto />
        </div>
      )}

      {semDrive && (
        <p className="aviso">
          <strong>O Drive ainda não está conectado neste servidor.</strong> Dá para ver o dossiê e abrir o link do
          Drive, mas enviar e baixar pelo Selebi só funciona depois de rodar <code>npm run drive:autorizar</code> e
          colocar as três variáveis do Google no <code>.env</code>. As instruções estão no cabeçalho de{" "}
          <code>src/documentos/autorizar-drive.ts</code>.
        </p>
      )}

      <div className="pagina-corpo pilha">
        {devidos.length > 0 && (
          <div className="regua-dossie">
            <span>
              <strong>
                {entregues} de {devidos.length}
              </strong>{" "}
              documentos exigidos até {projeto.etapa.nome.toLowerCase()}
            </span>
            <span className="progresso progresso-largo">
              <span style={{ width: `${Math.round((entregues / devidos.length) * 100)}%` }} />
            </span>
          </div>
        )}

        {envio && (
          <Cartao
            id="energisa"
            titulo="Enviar à Energisa"
            icone={<Send size={16} />}
            destaque
            ajuda="O pedido de acesso é feito pelo engenheiro, no portal da Energisa, logado com o CPF dele. O Selebi junta os documentos e os dados; a extensão mostra tudo ao lado do formulário; o clique de enviar é no portal."
          >
            <ol className="envio-energisa-passos">
              <li>Confira se os documentos do pedido estão na pasta. O que faltar, suba em “Falta nesta etapa”, logo abaixo.</li>
              <li>Entre no portal da Energisa (CPF e código do SMS) e clique em <strong>Abrir o painel no portal</strong>: os dados e os documentos aparecem ao lado do formulário.</li>
              <li>Confira e envie pelo portal. Depois, volte aqui e digite o número que o portal deu.</li>
            </ol>
            <div className="envio-energisa">
              <div>
                <h3 className="envio-energisa-titulo">Documentos do pedido</h3>
                <ul className="lista-limpa envio-energisa-docs">
                  {envio.itens.map((i) => (
                    <li key={i.tipo} className={i.tem ? "tem" : i.quando ? "talvez" : "falta"}>
                      <span className="envio-energisa-marca" aria-hidden>
                        {i.tem ? <CheckCircle2 size={15} /> : <FileWarning size={15} />}
                      </span>
                      <span className="envio-energisa-nome">
                        {i.rotulo}
                        {i.quando && <small>só {i.quando}</small>}
                      </span>
                      {i.documentoId ? (
                        <a href={`/documentos/arquivo/${i.documentoId}`} className="link-acao" title={i.nomeArquivo ?? undefined}>
                          <Download size={13} aria-hidden /> baixar
                        </a>
                      ) : i.quando ? (
                        <span className="fraco">—</span>
                      ) : (
                        <span className="pilula sev-atencao">falta</span>
                      )}
                    </li>
                  ))}
                </ul>
                {envio.faltam.length > 0 && (
                  <p className="nota">
                    Falta{envio.faltam.length > 1 ? "m" : ""} {envio.faltam.join(", ")}. Dá para enviar sem, se o
                    documento estiver com você, mas o Selebi não terá a cópia.
                  </p>
                )}
              </div>
              <div>
                <h3 className="envio-energisa-titulo">Dados do formulário</h3>
                {envio.campos.length ? (
                  <dl className="dados envio-energisa-dados">
                    {envio.campos.map((c) => (
                      <div key={c.chave}>
                        <dt>{c.rotulo}</dt>
                        <dd>
                          <span>{c.valor}</span>
                          <CopiarValor valor={c.valor} rotulo={c.rotulo} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="nota">O cadastro do cliente e o kit ainda estão em branco.</p>
                )}
              </div>
            </div>
            <div className="envio-energisa-acoes">
              <AbrirNoPortal projetoId={projeto.id} />
              <JaEnviei projetoId={projeto.id} numero={envio.protocolo} />
            </div>
          </Cartao>
        )}

        <Cartao
          titulo="Falta nesta etapa"
          icone={<FileWarning size={16} />}
          contador={pendentes.length || undefined}
          destaque={pendentes.length > 0}
        >
          {pendentes.length === 0 ? (
            <Vazio icone={<CheckCircle2 size={20} />} titulo={`Nada falta para ${projeto.etapa.nome.toLowerCase()}`} />
          ) : (
            <div className="cartoes cartoes-no-cartao">
              {pendentes.map((e) => cartaoDoDocumento(e, false))}
            </div>
          )}
        </Cartao>

        <Cartao titulo="Na pasta" icone={<FolderOpen size={16} />} contador={visiveis.length}>
          {ocultos > 0 && (
            <p className="nota">
              Outros {ocultos} documentos deste dossiê são de outras etapas e não aparecem para o seu perfil. Documento de
              cliente guarda CNH, CPF e conta de luz — cada um enxerga o que precisa para trabalhar.
            </p>
          )}
          {visiveis.length === 0 ? (
            <Vazio icone={<FolderOpen size={20} />} titulo="Nenhum documento ainda" />
          ) : (
            <div className="tabela-wrap tabela-no-cartao">
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
                      <td className="forte">{ROTULO_DOCUMENTO[d.tipo] ?? d.tipo}</td>
                      {/* `title` porque o nome é cortado: os do Drive passam de 80
                          caracteres e sem isto a informação some de vez. */}
                      <td className="fraco nome-arquivo" title={d.nomeArquivo}>
                        {d.nomeArquivo}
                      </td>
                      <td>
                        {STATUS_ROTULO[d.status] ? (
                          <span className={`pilula ${d.status === "assinado" ? "sev-info" : "sev-atencao"}`}>
                            {STATUS_ROTULO[d.status]}
                          </span>
                        ) : (
                          <span className="fraco">—</span>
                        )}
                      </td>
                      <td className="fraco">{d.versao > 1 ? `v${d.versao}` : "—"}</td>
                      <td className="fraco">{d.daVenda ? "desta venda" : "da pessoa"}</td>
                      <td className="fraco">{d.enviadoPor ?? "importado do Drive"}</td>
                      <td>
                        {semDrive ? (
                          d.linkDrive ? (
                            <a href={d.linkDrive} target="_blank" rel="noreferrer" className="link-acao">
                              <ExternalLink size={13} aria-hidden /> abrir no Google
                            </a>
                          ) : (
                            "—"
                          )
                        ) : (
                          <a href={`/documentos/arquivo/${d.id}`} className="link-acao">
                            <Download size={13} aria-hidden /> baixar
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>

        {futuras.length > 0 && (
          <Cartao
            titulo="Ainda não é hora"
            icone={<Clock size={16} />}
            contador={futuras.length}
            ajuda="Estes documentos passam a ser cobrados mais adiante na esteira. Se já tiver em mãos, pode subir agora — não faz mal adiantar."
          >
            <div className="cartoes cartoes-no-cartao">
              {futuras.map((e) => cartaoDoDocumento(e, true))}
            </div>
          </Cartao>
        )}
      </div>
    </main>
  );
}
