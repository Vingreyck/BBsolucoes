// O Next transforma o JSX sem precisar do React no escopo; o tsx (dos scripts
// de teste) usa a transformação clássica, que precisa. Importar serve aos dois.
import React from "react";

type ReactPdf = typeof import("@react-pdf/renderer");

import { bytesDoAnexo } from "./anexos";
import { numeroBr, textoDaResposta } from "./formatar";
import { tempoEmCampo, type OsCompleta } from "./consultas";
import {
  formatarDuracao,
  formatarInstante,
  formatarRelogio,
  relogioAgora,
} from "./relogio";
import {
  encerrada,
  numeroOs,
  RESULTADO_ROTULO,
  STATUS_ROTULO,
  TIPO_ROTULO,
} from "./tipos";

/**
 * O relatório da OS em PDF — o que o cliente recebe pelo WhatsApp e o que fica
 * de prova do serviço.
 *
 * Gerado na hora a partir do banco, nunca guardado: se alguém corrigir uma
 * resposta numa OS reaberta, o relatório seguinte já sai certo. As fotos vêm
 * do Drive no momento da geração.
 *
 * Só fontes padrão do PDF (Helvetica): cobrem o português inteiro, não
 * dependem de arquivo de fonte no servidor e deixam o PDF leve.
 */

const COR = {
  tinta: "#12171c",
  tinta2: "#4b5560",
  tinta3: "#6e7a85",
  linha: "#d9dee4",
  fundo: "#f3f5f7",
  destaque: "#a8521f",
  ok: "#2c6e49",
  ruim: "#9b2c2c",
};

type Fotos = Map<string, { data: Buffer; format: "jpg" | "png" }>;
type Item = OsCompleta["checklist"][number];

function enderecoDo(c: OsCompleta["cliente"]): string {
  const rua = [c.logradouro, c.numero].filter(Boolean).join(", ");
  return [rua, c.bairro].filter(Boolean).join(" - ") || "-";
}

/**
 * Os componentes do PDF, montados sobre a biblioteca já carregada.
 *
 * A biblioteca é só-ESM e vem por `import()` nativo, na hora do primeiro
 * relatório: assim ela carrega igual no servidor do Next e nos scripts
 * rodados com tsx (que a carregariam pelo caminho CommonJS e quebrariam), e o
 * site não paga o motor de PDF enquanto ninguém pede relatório.
 */
function montar(R: ReactPdf) {
  const { Document, Image, Link, Page, StyleSheet, Text, View } = R;

  const s = StyleSheet.create({
    pagina: {
      paddingTop: 36,
      paddingBottom: 48,
      paddingHorizontal: 36,
      fontFamily: "Helvetica",
      fontSize: 9.5,
      color: COR.tinta,
      // Sem lineHeight aqui: herdado da página, ele faz a biblioteca descartar
      // o número da página (texto dinâmico). Vai só no texto corrido.
    },
    topo: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      borderBottomWidth: 2,
      borderBottomColor: COR.destaque,
      paddingBottom: 8,
      marginBottom: 10,
    },
    empresa: { fontFamily: "Helvetica-Bold", fontSize: 15, color: COR.destaque },
    subtitulo: { fontSize: 9, color: COR.tinta2, marginTop: 2 },
    numero: { fontFamily: "Helvetica-Bold", fontSize: 14, textAlign: "right" },
    faixa: {
      flexDirection: "row",
      justifyContent: "space-between",
      backgroundColor: COR.fundo,
      paddingVertical: 5,
      paddingHorizontal: 8,
      borderRadius: 3,
      marginBottom: 10,
    },
    faixaTexto: { fontFamily: "Helvetica-Bold", fontSize: 9.5 },
    colunas: { flexDirection: "row", gap: 10, marginBottom: 10 },
    caixa: {
      flex: 1,
      borderWidth: 1,
      borderColor: COR.linha,
      borderRadius: 3,
      padding: 8,
    },
    caixaTitulo: {
      fontFamily: "Helvetica-Bold",
      fontSize: 7.5,
      color: COR.destaque,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 5,
    },
    campo: { flexDirection: "row", marginBottom: 2.5 },
    rotulo: { width: 70, color: COR.tinta3, fontSize: 8.5 },
    valor: { flex: 1 },
    secao: {
      fontFamily: "Helvetica-Bold",
      fontSize: 10.5,
      marginTop: 10,
      marginBottom: 5,
      paddingBottom: 3,
      borderBottomWidth: 1,
      borderBottomColor: COR.linha,
    },
    paragrafo: { color: COR.tinta2, marginBottom: 4, lineHeight: 1.4 },
    item: {
      borderBottomWidth: 0.5,
      borderBottomColor: COR.linha,
      paddingVertical: 5,
    },
    itemLinha: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
    itemNome: { flex: 1, fontFamily: "Helvetica-Bold" },
    itemResposta: { maxWidth: 220, textAlign: "right" },
    observacao: { color: COR.tinta2, fontFamily: "Helvetica-Oblique", marginTop: 2, lineHeight: 1.35 },
    fotos: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 },
    foto: { width: 256, height: 180, objectFit: "contain", backgroundColor: COR.fundo },
    legenda: { fontSize: 7, color: COR.tinta3, marginTop: 1.5, width: 256 },
    assinatura: { width: 200, height: 80, objectFit: "contain", marginTop: 4 },
    // Rodapé em três peças soltas e fixas, cada uma presa ao pé da página: o
    // bloco único com `render` dentro saía só na última página, e no topo.
    rodapeLinha: {
      position: "absolute",
      bottom: 34,
      left: 36,
      right: 36,
      borderTopWidth: 0.5,
      borderTopColor: COR.linha,
    },
    rodapeEsquerda: { position: "absolute", bottom: 20, left: 36, fontSize: 7.5, color: COR.tinta3 },
    // O número da página é texto dinâmico (`render`): medido antes de existir,
    // preso só pela direita ficaria sem largura. Largura cheia, alinhado à direita.
    rodapeDireita: {
      position: "absolute",
      bottom: 20,
      left: 36,
      right: 36,
      textAlign: "right",
      fontSize: 7.5,
      color: COR.tinta3,
    },
    aviso: { color: COR.ruim, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  });

  function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
    return (
      <View style={s.campo}>
        <Text style={s.rotulo}>{rotulo}</Text>
        <Text style={s.valor}>{children}</Text>
      </View>
    );
  }

  function GradeDeFotos({ anexos, fotos }: { anexos: { id: string; capturadoEm: Date | null }[]; fotos: Fotos }) {
    const comImagem = anexos.filter((a) => fotos.has(a.id));
    if (!comImagem.length) return null;
    return (
      <View style={s.fotos}>
        {comImagem.map((a) => (
          <View key={a.id} wrap={false}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf não tem alt */}
            <Image src={fotos.get(a.id)!} style={s.foto} />
            <Text style={s.legenda}>{a.capturadoEm ? `Tirada em ${formatarInstante(a.capturadoEm)}` : ""}</Text>
          </View>
        ))}
      </View>
    );
  }

  function RelatorioOs({ os, fotos }: { os: OsCompleta; fotos: Fotos }) {
    const tempo = tempoEmCampo(os.eventos);
    const chegada = os.eventos.find((e) => e.tipo === "iniciada");
    const saida = [...os.eventos].reverse().find((e) => e.tipo === "concluida");
    const assinatura = os.anexos.find((a) => a.categoria === "assinatura");
    const avulsas = os.anexos.filter((a) => a.categoria === "foto" && !a.checklistItemId);
    const parcial = !encerrada(os.status);

    // Itens agrupados por seção, na ordem do checklist.
    const secoes: { nome: string; itens: Item[] }[] = [];
    for (const item of os.checklist) {
      const nome = item.secao ?? "Checklist";
      const ultima = secoes[secoes.length - 1];
      if (ultima?.nome === nome) ultima.itens.push(item);
      else secoes.push({ nome, itens: [item] });
    }

    const mapa = (e: { latitude: string | null; longitude: string | null } | undefined) =>
      e?.latitude && e?.longitude ? `https://www.google.com/maps?q=${e.latitude},${e.longitude}` : null;
    const localChegada = mapa(chegada);

    return (
      <Document
        title={`${numeroOs(os.numero)} - ${os.cliente.nome}`}
        author={os.empresa.nome}
        creator="Selebi"
        producer="Selebi"
      >
        <Page size="A4" style={s.pagina}>
          <View style={s.topo} fixed>
            <View>
              <Text style={s.empresa}>{os.empresa.nome}</Text>
              <Text style={s.subtitulo}>Relatório de atendimento</Text>
            </View>
            <View>
              <Text style={s.numero}>OS {numeroOs(os.numero)}</Text>
              <Text style={[s.subtitulo, { textAlign: "right" }]}>{TIPO_ROTULO[os.tipo] ?? os.tipo}</Text>
            </View>
          </View>

          {parcial && (
            <Text style={s.aviso}>
              Relatório parcial: a OS ainda está &quot;{STATUS_ROTULO[os.status] ?? os.status}&quot;.
            </Text>
          )}

          <View style={s.faixa}>
            <Text style={s.faixaTexto}>
              {STATUS_ROTULO[os.status] ?? os.status}
              {os.resultado ? ` - ${RESULTADO_ROTULO[os.resultado] ?? os.resultado}` : ""}
            </Text>
            <Text>{os.concluidaEm ? `Concluída em ${formatarInstante(os.concluidaEm)}` : ""}</Text>
          </View>

          <View style={s.colunas}>
            <View style={s.caixa}>
              <Text style={s.caixaTitulo}>Cliente</Text>
              <Campo rotulo="Nome">{os.cliente.nome}</Campo>
              <Campo rotulo="Endereço">{enderecoDo(os.cliente)}</Campo>
              <Campo rotulo="Cidade">{[os.cliente.cidade, os.cliente.uf].filter(Boolean).join(" - ") || "-"}</Campo>
              {os.cliente.telefone ? <Campo rotulo="Telefone">{os.cliente.telefone}</Campo> : null}
              {os.usina ? (
                <Campo rotulo="Usina">
                  {os.usina.nome}
                  {os.usina.potenciaKwp ? ` - ${numeroBr(Number(os.usina.potenciaKwp))} kWp` : ""}
                </Campo>
              ) : null}
            </View>
            <View style={s.caixa}>
              <Text style={s.caixaTitulo}>Atendimento</Text>
              <Campo rotulo="Técnico">{os.responsavel?.nome ?? "-"}</Campo>
              <Campo rotulo="Agendada">{formatarRelogio(os.agendadaPara)}</Campo>
              <Campo rotulo="Chegada">{chegada ? formatarInstante(chegada.ocorridoEm) : "-"}</Campo>
              <Campo rotulo="Conclusão">{saida ? formatarInstante(saida.ocorridoEm) : "-"}</Campo>
              <Campo rotulo="Tempo">{tempo.ms ? formatarDuracao(tempo.ms) : "-"}</Campo>
              {localChegada ? (
                <View style={s.campo}>
                  <Text style={s.rotulo}>Local</Text>
                  <Link src={localChegada} style={[s.valor, { color: COR.destaque }]}>
                    ver no mapa
                  </Link>
                </View>
              ) : null}
            </View>
          </View>

          <Text style={s.secao}>Solicitação</Text>
          <Text style={s.paragrafo}>{os.descricao}</Text>

          {secoes.map((secao) => (
            <View key={secao.nome}>
              <Text style={s.secao}>{secao.nome}</Text>
              {secao.itens.map((item) => (
                <View key={item.id} style={s.item} wrap={item.anexos.length > 2}>
                  <View style={s.itemLinha}>
                    <Text style={s.itemNome}>{item.descricao}</Text>
                    <Text
                      style={[
                        s.itemResposta,
                        { color: item.concluido ? COR.tinta : item.obrigatorio ? COR.ruim : COR.tinta3 },
                      ]}
                    >
                      {textoDaResposta(item)}
                    </Text>
                  </View>
                  {item.observacao ? <Text style={s.observacao}>{item.observacao}</Text> : null}
                  <GradeDeFotos anexos={item.anexos} fotos={fotos} />
                </View>
              ))}
            </View>
          ))}

          {avulsas.length > 0 && (
            <View>
              <Text style={s.secao}>Outras fotos</Text>
              <GradeDeFotos anexos={avulsas} fotos={fotos} />
            </View>
          )}

          {os.laudo ? (
            <View wrap={false}>
              <Text style={s.secao}>Laudo técnico</Text>
              <Text style={s.paragrafo}>{os.laudo}</Text>
            </View>
          ) : null}

          {assinatura ? (
            <View wrap={false}>
              <Text style={s.secao}>Assinatura do cliente</Text>
              {fotos.has(assinatura.id) ? (
                // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf não tem alt
                <Image src={fotos.get(assinatura.id)!} style={s.assinatura} />
              ) : null}
              <Text style={s.paragrafo}>
                {os.assinaturaNome ?? "-"}
                {assinatura.capturadoEm ? ` - ${formatarInstante(assinatura.capturadoEm)}` : ""}
              </Text>
            </View>
          ) : null}

          <View style={s.rodapeLinha} fixed />
        <Text style={s.rodapeEsquerda} fixed>
          Gerado pelo Selebi em {formatarRelogio(relogioAgora(), false)} - OS {numeroOs(os.numero)}
        </Text>
        <Text
          style={s.rodapeDireita}
          fixed
          render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
        />
      </Page>
      </Document>
    );
  }

  return { RelatorioOs, renderToBuffer: R.renderToBuffer };
}

let montado: ReturnType<typeof montar> | null = null;

async function biblioteca() {
  montado ??= montar(await import("@react-pdf/renderer"));
  return montado;
}

/** Baixa as imagens do Drive, quatro de cada vez. Foto que falhar fica de fora. */
async function carregarFotos(os: OsCompleta): Promise<Fotos> {
  const anexos = os.anexos.filter((a) => a.mime === "image/jpeg" || a.mime === "image/png");
  const fotos: Fotos = new Map();
  for (let i = 0; i < anexos.length; i += 4) {
    const lote = anexos.slice(i, i + 4);
    const bytes = await Promise.all(lote.map((a) => bytesDoAnexo(a)));
    lote.forEach((a, j) => {
      const b = bytes[j];
      if (b) fotos.set(a.id, { data: Buffer.from(b), format: a.mime === "image/png" ? "png" : "jpg" });
    });
  }
  return fotos;
}

export async function gerarRelatorio(os: OsCompleta): Promise<Buffer> {
  return renderizarRelatorio(os, await carregarFotos(os));
}

/** O PDF com as imagens já em mãos — separado para o teste não depender do Drive. */
export async function renderizarRelatorio(os: OsCompleta, fotos: Fotos): Promise<Buffer> {
  const { RelatorioOs, renderToBuffer } = await biblioteca();
  return renderToBuffer(<RelatorioOs os={os} fotos={fotos} />);
}

/** "OS-0047-Maria-Souza.pdf" */
export function nomeDoRelatorio(os: { numero: number; cliente: { nome: string } }): string {
  const cliente = os.cliente.nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `OS-${String(os.numero).padStart(4, "0")}-${cliente}.pdf`;
}
