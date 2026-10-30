// O Next transforma o JSX sem precisar do React no escopo; o tsx (dos scripts
// de teste) usa a transformação clássica, que precisa. Importar serve aos dois.
import React from "react";

import type { DadosRelatorio } from "./dados";
import { FAIXA_SERGIPE, FRACAO_ABAIXO, FRASE_DA_FAIXA, mesLegivel, numeroBr } from "./relatorio-mensal";

type ReactPdf = typeof import("@react-pdf/renderer");

/**
 * O relatório mensal de geração em PDF — uma página, para o cliente abrir no
 * celular: quanto gerou, se está bem, o gráfico do mês e o que aconteceu.
 *
 * Gerado na hora, como o da OS, com as fontes padrão do PDF (cobrem o
 * português e não dependem de arquivo no servidor).
 */

const COR = {
  tinta: "#12171c",
  tinta2: "#4b5560",
  tinta3: "#6e7a85",
  linha: "#d9dee4",
  fundo: "#f3f5f7",
  destaque: "#a8521f",
  barra: "#e0902f",
  semDado: "#c9d0d7",
  faixa: "#2c6e49",
  ok: "#2c6e49",
  ruim: "#9b2c2c",
};

const FABRICANTE: Record<string, string> = {
  growatt: "Growatt",
  foxess: "FoxESS",
  solis: "Solis",
  hoymiles: "Hoymiles",
  huawei: "Huawei FusionSolar",
  solarportal_plus: "SolarPortal+",
  nep: "NEP",
};

const LARGURA = 523;
const ALTURA = 150;

function montar(R: ReactPdf) {
  const { Document, Line, Page, Rect, StyleSheet, Svg, Text, View } = R;

  const s = StyleSheet.create({
    pagina: { padding: 36, fontFamily: "Helvetica", fontSize: 9.5, color: COR.tinta },
    topo: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      borderBottomWidth: 2,
      borderBottomColor: COR.destaque,
      paddingBottom: 8,
      marginBottom: 12,
    },
    empresa: { fontFamily: "Helvetica-Bold", fontSize: 15, color: COR.destaque },
    subtitulo: { fontSize: 9, color: COR.tinta2, marginTop: 2 },
    mes: { fontFamily: "Helvetica-Bold", fontSize: 13, textAlign: "right" },
    quem: { marginBottom: 12 },
    cliente: { fontFamily: "Helvetica-Bold", fontSize: 12 },
    detalhe: { color: COR.tinta2, marginTop: 2 },
    numeros: { flexDirection: "row", gap: 8, marginBottom: 14 },
    numero: { flex: 1, backgroundColor: COR.fundo, borderRadius: 4, padding: 9 },
    numeroRotulo: { fontSize: 7.5, color: COR.tinta3, textTransform: "uppercase", letterSpacing: 0.6 },
    numeroValor: { fontFamily: "Helvetica-Bold", fontSize: 16, marginTop: 4 },
    numeroNota: { fontSize: 7.5, color: COR.tinta2, marginTop: 2 },
    secao: {
      fontFamily: "Helvetica-Bold",
      fontSize: 10.5,
      marginBottom: 6,
      paddingBottom: 3,
      borderBottomWidth: 1,
      borderBottomColor: COR.linha,
    },
    eixo: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
    eixoTexto: { fontSize: 6.5, color: COR.tinta3 },
    legenda: { flexDirection: "row", gap: 12, marginTop: 5, marginBottom: 14 },
    legendaItem: { flexDirection: "row", alignItems: "center", gap: 4, fontSize: 7.5, color: COR.tinta2 },
    quadrado: { width: 7, height: 7 },
    paragrafo: { color: COR.tinta2, lineHeight: 1.3, marginBottom: 5 },
    rodape: {
      position: "absolute",
      bottom: 22,
      left: 36,
      right: 36,
      borderTopWidth: 0.5,
      borderTopColor: COR.linha,
      paddingTop: 5,
      fontSize: 7.5,
      color: COR.tinta3,
    },
  });

  function Numero({ rotulo, valor, nota, cor }: { rotulo: string; valor: string; nota?: string; cor?: string }) {
    return (
      <View style={s.numero}>
        <Text style={s.numeroRotulo}>{rotulo}</Text>
        <Text style={[s.numeroValor, cor ? { color: cor } : {}]}>{valor}</Text>
        {nota ? <Text style={s.numeroNota}>{nota}</Text> : null}
      </View>
    );
  }

  /** As barras do mês, uma por dia. Faixa verde = o esperado para o tamanho da usina. */
  function Grafico({ d }: { d: DadosRelatorio }) {
    const serie = d.resumo.serie;
    // A faixa das usinas vizinhas no mês (de 75% a 125% da mediana), no tamanho desta.
    const ref = d.resumo.referencia;
    const faixa =
      d.potenciaKwp && d.resumo.faixa !== "suspeita"
        ? ref
          ? { min: ref * FRACAO_ABAIXO * d.potenciaKwp, max: ref * (2 - FRACAO_ABAIXO) * d.potenciaKwp }
          : { min: FAIXA_SERGIPE.min * d.potenciaKwp, max: FAIXA_SERGIPE.max * d.potenciaKwp }
        : null;
    const topo = Math.max(1, ...serie.map((v) => v ?? 0), faixa ? faixa.max * 1.1 : 0);
    const passo = LARGURA / serie.length;
    const largura = Math.max(2, passo * 0.7);
    const y = (v: number) => ALTURA - (v / topo) * ALTURA;
    return (
      <View>
        <Svg width={LARGURA} height={ALTURA}>
          {faixa ? (
            <Rect x={0} y={y(faixa.max)} width={LARGURA} height={y(faixa.min) - y(faixa.max)} fill={COR.faixa} fillOpacity={0.1} />
          ) : null}
          {serie.map((v, i) => {
            const x = i * passo + (passo - largura) / 2;
            return v === null ? (
              <Rect key={i} x={x} y={ALTURA - 3} width={largura} height={3} fill={COR.semDado} />
            ) : (
              <Rect key={i} x={x} y={y(v)} width={largura} height={Math.max(0.5, ALTURA - y(v))} fill={COR.barra} />
            );
          })}
          <Line x1={0} y1={ALTURA} x2={LARGURA} y2={ALTURA} stroke={COR.linha} strokeWidth={1} />
        </Svg>
        <View style={s.eixo}>
          {serie.map((_, i) => (
            <Text key={i} style={[s.eixoTexto, { width: passo, textAlign: "center" }]}>
              {i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : ""}
            </Text>
          ))}
        </View>
        <View style={s.legenda}>
          <View style={s.legendaItem}>
            <View style={[s.quadrado, { backgroundColor: COR.barra }]} />
            <Text>kWh gerados no dia</Text>
          </View>
          {faixa ? (
            <View style={s.legendaItem}>
              <View style={[s.quadrado, { backgroundColor: COR.faixa, opacity: 0.25 }]} />
              <Text>faixa esperada para esta usina</Text>
            </View>
          ) : null}
          {d.resumo.diasSemDado > 0 ? (
            <View style={s.legendaItem}>
              <View style={[s.quadrado, { backgroundColor: COR.semDado }]} />
              <Text>dia sem dado do portal</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  function RelatorioGeracao({ d }: { d: DadosRelatorio }) {
    const r = d.resumo;
    const variacao =
      d.totalMesAnterior && d.totalMesAnterior > 0 ? ((r.totalKwh - d.totalMesAnterior) / d.totalMesAnterior) * 100 : null;
    // "suspeita" é potência errada no cadastro: assunto interno, não do cliente.
    const avaliada = r.faixa === "abaixo" || r.faixa === "dentro" ? r.faixa : null;
    const corFaixa = avaliada === "abaixo" ? COR.ruim : avaliada ? COR.ok : undefined;
    const economia = d.tarifaKwh ? r.totalKwh * d.tarifaKwh : null;
    const alertasResolvidos = d.alertas.filter((a) => a.resolvidoEm).length;

    return (
      <Document title={`Relatório de geração - ${mesLegivel(d.mes)}`} author={d.empresa}>
        <Page size="A4" style={s.pagina}>
          <View style={s.topo}>
            <View>
              <Text style={s.empresa}>{d.empresa}</Text>
              <Text style={s.subtitulo}>Relatório mensal de geração solar</Text>
            </View>
            <Text style={s.mes}>{mesLegivel(d.mes)}</Text>
          </View>

          <View style={s.quem}>
            <Text style={s.cliente}>{d.cliente}</Text>
            <Text style={s.detalhe}>
              {[d.usina, d.potenciaKwp ? `${numeroBr(d.potenciaKwp, 2)} kWp` : null, d.cidade].filter(Boolean).join(" · ")}
            </Text>
          </View>

          <View style={s.numeros}>
            <Numero
              rotulo="Gerado no mês"
              valor={`${numeroBr(r.totalKwh)} kWh`}
              nota={
                variacao !== null
                  ? `${variacao >= 0 ? "+" : ""}${numeroBr(variacao, 0)}% em relação ao mês anterior`
                  : undefined
              }
            />
            <Numero
              rotulo="Média por dia"
              valor={r.mediaDiaKwh !== null ? `${numeroBr(r.mediaDiaKwh, 1)} kWh` : "-"}
              nota={r.melhorDia ? `Melhor dia: ${r.melhorDia.dia.slice(8, 10)}, com ${numeroBr(r.melhorDia.kwh, 1)} kWh` : undefined}
            />
            {avaliada ? (
              <Numero
                rotulo="Desempenho"
                valor={avaliada === "abaixo" ? "Abaixo" : "Normal"}
                nota={`${numeroBr(r.kwhPorKwpDia ?? 0, 1)} kWh por kWp por dia${
                  r.referencia ? `; as usinas da região fizeram ${numeroBr(r.referencia, 1)}` : ` — ${FRASE_DA_FAIXA[avaliada]}`
                }`}
                cor={corFaixa}
              />
            ) : null}
            {economia !== null ? (
              <Numero
                rotulo="Economia estimada"
                valor={`R$ ${numeroBr(economia, 2)}`}
                nota={`Pela tarifa de R$ ${numeroBr(d.tarifaKwh ?? 0, 2)} por kWh`}
              />
            ) : null}
          </View>

          <Text style={s.secao}>Geração dia a dia</Text>
          <Grafico d={d} />

          <Text style={s.secao}>Como foi o mês</Text>
          <Text style={s.paragrafo}>
            {avaliada === "abaixo"
              ? "A geração ficou abaixo do que as usinas da região fizeram no mesmo mês, para o tamanho desta. A nossa equipe vai verificar a causa — sujeira nos painéis, sombra nova ou falha de equipamento."
              : avaliada
                ? "A usina gerou o esperado para o tamanho dela, em linha com as usinas da região no mesmo mês."
                : r.faixa === "suspeita"
                  ? "Acompanhamos a geração da usina dia a dia; o gráfico acima mostra o mês."
                  : "Este mês ainda não tem dias suficientes para avaliar o desempenho da usina."}
          </Text>
          {r.diasSemDado > 0 ? (
            <Text style={s.paragrafo}>
              Em {r.diasSemDado} {r.diasSemDado === 1 ? "dia" : "dias"} o portal do fabricante não enviou dados —
              geralmente é a internet do inversor. A média e o desempenho consideram só os dias com dado.
            </Text>
          ) : null}
          {d.alertas.length > 0 ? (
            <Text style={s.paragrafo}>
              {d.alertas.length === 1
                ? `Houve 1 ocorrência registrada pelo monitoramento no mês${alertasResolvidos ? ", já resolvida" : ""}.`
                : `Houve ${d.alertas.length} ocorrências registradas pelo monitoramento no mês${
                    alertasResolvidos === d.alertas.length
                      ? ", todas resolvidas"
                      : alertasResolvidos
                        ? `, ${alertasResolvidos} já resolvidas`
                        : ""
                  }.`}
            </Text>
          ) : (
            <Text style={s.paragrafo}>Nenhuma ocorrência registrada pelo monitoramento no mês.</Text>
          )}

          <Text style={s.rodape} fixed>
            Dados coletados automaticamente
            {d.fabricantes.length ? ` do portal ${d.fabricantes.map((f) => FABRICANTE[f] ?? f).join(" e ")}` : ""} e
            acompanhados pela {d.empresa}.
          </Text>
        </Page>
      </Document>
    );
  }

  return { RelatorioGeracao, renderToBuffer: R.renderToBuffer };
}

let montado: ReturnType<typeof montar> | null = null;

async function biblioteca() {
  montado ??= montar(await import("@react-pdf/renderer"));
  return montado;
}

export async function gerarRelatorioGeracao(d: DadosRelatorio): Promise<Buffer> {
  const { RelatorioGeracao, renderToBuffer } = await biblioteca();
  return renderToBuffer(<RelatorioGeracao d={d} />);
}
