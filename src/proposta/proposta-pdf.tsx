// O Next transforma o JSX sem precisar do React no escopo; o tsx (dos scripts
// de teste) usa a transformação clássica, que precisa. Importar serve aos dois.
import path from "node:path";

import React from "react";

import { kwhTexto, kwpTexto, MESES, moeda, rotuloDoPayback } from "./calculo";
import type { DadosProposta } from "./proposta";

type ReactPdf = typeof import("@react-pdf/renderer");

/**
 * A proposta comercial em PDF, no modelo das 7 páginas que a BB Soluções já usa
 * (a proposta da Evelyn dos Santos, nº 209): capa, passo a passo, detalhamento
 * e garantias, geração e finanças, monitoramento, investimento e pós-venda.
 *
 * Desenhada aqui mesmo, em vetor: a cena da capa, a casa do passo a passo e o
 * celular do monitoramento são formas, não imagens, para o PDF sair leve e
 * nítido em qualquer tela. A fonte é a Montserrat, a mesma da proposta deles
 * (licença OFL, em `fontes/`).
 *
 * Gerado na hora a partir de `proposta.dados` (a fotografia do dia em que foi
 * gerada), nunca guardado: o mesmo link devolve sempre a mesma proposta.
 */

export interface VisualDaProposta {
  /** O logo da empresa (data URL), de Administração → Dados da empresa. */
  logo: string | null;
  /** A foto da capa (data URL), de Administração → Proposta comercial. Sem ela, a capa desenhada. */
  capa?: string | null;
}

const COR = {
  navy: "#0e1a36",
  azul: "#2459b3",
  azulVivo: "#3b7be0",
  azulFundo: "#e9f0fb",
  azulGelo: "#f4f7fc",
  tinta: "#1e293b",
  fraca: "#5f6b7d",
  apagada: "#94a0b2",
  linha: "#e3e8ef",
  cinzaBarra: "#c5cdd8",
  laranja: "#f07c2c",
  laranjaFundo: "#fff3e8",
  amarelo: "#f5b31c",
  verde: "#1f9d61",
  vermelho: "#dc4a3d",
  passos: ["#16a2b8", "#2fac66", "#f2b630", "#f0862c", "#e2452f"],
};

const PAG = { w: 595.28, h: 841.89 };
const MARGEM = 44;
const LARGURA = PAG.w - MARGEM * 2;

const ESTADOS: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

/** "Itabaiana, Sergipe". */
function cidadeDoCliente(c: DadosProposta["cliente"]): string {
  return c.uf ? `${c.cidade}, ${ESTADOS[c.uf] ?? c.uf}` : c.cidade;
}

function cnpjBonito(c: string | null | undefined): string | null {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : null;
}

const numero = (n: number, casas = 0) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

// ------------------------------------------------------------------ geometria

type Ponto = [number, number];

/**
 * A transformação projetiva que leva o quadrado unitário ao quadrilátero dado
 * (Heckbert, 1989). É o que dá perspectiva de verdade aos módulos da capa: os de
 * longe encolhem e se juntam no horizonte, como na foto.
 */
function perspectiva(q00: Ponto, q10: Ponto, q11: Ponto, q01: Ponto): (u: number, v: number) => Ponto {
  const [x0, y0] = q00;
  const [x1, y1] = q10;
  const [x2, y2] = q11;
  const [x3, y3] = q01;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

const p = ([x, y]: Ponto) => `${x.toFixed(1)} ${y.toFixed(1)}`;

function misturar(a: string, b: string, t: number): string {
  const n = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const k = Math.max(0, Math.min(1, t));
  return `#${[0, 1, 2].map((i) => Math.round(n(a, i) + (n(b, i) - n(a, i)) * k).toString(16).padStart(2, "0")).join("")}`;
}

/** Retângulo só com os cantos de cima arredondados (as barras dos gráficos). */
function barra(x: number, y: number, w: number, h: number, r: number): string {
  const raio = Math.max(0, Math.min(r, w / 2, h));
  return `M${x} ${y + h} V${y + raio} Q${x} ${y} ${x + raio} ${y} H${x + w - raio} Q${x + w} ${y} ${x + w} ${y + raio} V${y + h} Z`;
}

function eixoBonito(max: number, passos = 5): { topo: number; passo: number } {
  const bruto = Math.max(max, 1) / passos;
  const grandeza = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * grandeza).find((v) => v >= bruto) ?? bruto;
  return { topo: Math.ceil(max / passo) * passo, passo };
}

/** O arco da página de pós-venda: as fases ficam sobre ele, o logo no centro. */
const ARCO = { x: 18, y: 246, r: 312 };

function noArco(graus: number): Ponto {
  const a = (graus * Math.PI) / 180;
  return [ARCO.x + Math.cos(a) * ARCO.r, ARCO.y + Math.sin(a) * ARCO.r];
}

function arcoDe(de: number, ate: number): string {
  return `M${p(noArco(de))} A${ARCO.r} ${ARCO.r} 0 0 1 ${p(noArco(ate))}`;
}

// --------------------------------------------------------------------- fontes

let fontesProntas = false;

function registrarFontes(R: ReactPdf) {
  if (fontesProntas) return;
  const pasta = path.join(process.cwd(), "src", "proposta", "fontes");
  const arq = (nome: string) => path.join(pasta, `Montserrat_${nome}.ttf`);
  R.Font.register({
    family: "Montserrat",
    fonts: [
      { src: arq("400Regular"), fontWeight: 400 },
      { src: arq("400Regular_Italic"), fontWeight: 400, fontStyle: "italic" },
      { src: arq("500Medium"), fontWeight: 500 },
      { src: arq("600SemiBold"), fontWeight: 600 },
      { src: arq("700Bold"), fontWeight: 700 },
      { src: arq("800ExtraBold"), fontWeight: 800 },
    ],
  });
  // Palavra inteira na linha de baixo, sem hífen no meio de "fotovoltaico".
  R.Font.registerHyphenationCallback((palavra) => [palavra]);
  fontesProntas = true;
}

function montar(R: ReactPdf) {
  const { Circle, ClipPath, Defs, Document, Ellipse, G, Image, Line, LinearGradient, Page, Path, RadialGradient, Rect, Stop, Svg, Text, View } = R;

  registrarFontes(R);

  /** Estilo de texto: peso, tamanho e cor (a família é a da página). */
  const t = (peso: number, tamanho: number, cor: string = COR.tinta, extra: Record<string, unknown> = {}) => ({
    fontWeight: peso,
    fontSize: tamanho,
    color: cor,
    ...extra,
  });
  /** O mesmo para texto dentro de desenho (Svg), que não herda a família. */
  const ts = (peso: number, tamanho: number) => ({ fontFamily: "Montserrat", fontWeight: peso, fontSize: tamanho });

  // ------------------------------------------------------------------ ícones

  type Glifo =
    | "raio" | "painel" | "inversor" | "sol" | "area" | "telhado" | "grafico" | "casa" | "caminhao" | "ferramenta"
    | "documento" | "escudo" | "pin" | "pessoa" | "calendario" | "check" | "lupa" | "joia" | "moeda" | "sino"
    | "celular" | "estrutura" | "porquinho" | "relogio";

  function Glifos({ tipo, cor, largura = 1.7 }: { tipo: Glifo; cor: string; largura?: number }) {
    const tr = { stroke: cor, strokeWidth: largura, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    switch (tipo) {
      case "raio":
        return <Path d="M13 2 L5 13.5 H11 L10 22 L19 9.5 H13 Z" {...tr} />;
      case "painel":
        return (
          <G>
            <Path d="M4 5 H20 L18 15 H6 Z" {...tr} />
            <Path d="M9.3 5 L8.6 15 M14.7 5 L15.4 15 M5 10 H19" {...tr} />
            <Path d="M12 15 V20 M8.5 20 H15.5" {...tr} />
          </G>
        );
      case "inversor":
        return (
          <G>
            <Rect x="5.5" y="3" width="13" height="18" rx="2" {...tr} />
            <Path d="M8.5 9.5 q1.75 -3 3.5 0 t3.5 0" {...tr} />
            <Path d="M9 16 H15" {...tr} />
          </G>
        );
      case "sol":
        return (
          <G>
            <Circle cx="12" cy="12" r="4" {...tr} />
            <Path d="M12 2.5 V5 M12 19 V21.5 M2.5 12 H5 M19 12 H21.5 M5.3 5.3 L7 7 M17 17 L18.7 18.7 M5.3 18.7 L7 17 M17 7 L18.7 5.3" {...tr} />
          </G>
        );
      case "area":
        return (
          <G>
            <Rect x="4" y="4" width="16" height="16" rx="1.5" {...tr} strokeDasharray="2.6 2.4" />
            <Path d="M8.5 15.5 L15.5 8.5 M11.5 8.5 H15.5 V12.5" {...tr} />
          </G>
        );
      case "telhado":
      case "casa":
        return (
          <G>
            <Path d="M3 11.5 L12 4 L21 11.5" {...tr} />
            <Path d="M5.5 10 V20 H18.5 V10" {...tr} />
            {tipo === "casa" ? <Path d="M13 9 L10.3 14 H13.7 L11 18.5" {...tr} /> : <Path d="M10 20 V14.5 H14 V20" {...tr} />}
          </G>
        );
      case "estrutura":
        return (
          <G>
            <Path d="M3 18 L21 9" {...tr} />
            <Path d="M6 16.5 V21 M12 13.5 V21 M18 10.5 V21 M3 21 H21" {...tr} />
          </G>
        );
      case "grafico":
        return <Path d="M3.5 18 L9 12.5 L13 16 L20.5 7 M15.5 7 H20.5 V12" {...tr} />;
      case "caminhao":
        return (
          <G>
            <Path d="M2 6 H14 V16 H2 Z M14 9.5 H18.5 L22 13 V16 H14" {...tr} />
            <Circle cx="7" cy="17.5" r="2" {...tr} />
            <Circle cx="17.5" cy="17.5" r="2" {...tr} />
          </G>
        );
      case "ferramenta":
        return <Path d="M14.5 6.5 a4 4 0 0 0 4.8 5 L11 19.8 a2.2 2.2 0 0 1 -3.1 -3.1 L16.2 8.4 a4 4 0 0 0 -1.7 -1.9 Z" {...tr} />;
      case "documento":
        return (
          <G>
            <Path d="M6 3 H15 L19 7 V21 H6 Z M15 3 V7 H19" {...tr} />
            <Path d="M9 12 H16 M9 15.5 H16 M9 8.5 H12" {...tr} />
          </G>
        );
      case "escudo":
        return (
          <G>
            <Path d="M12 3 L20 6 V12 C20 16.5 16.5 19.8 12 21 C7.5 19.8 4 16.5 4 12 V6 Z" {...tr} />
            <Path d="M8.5 12 L11 14.5 L15.5 9.5" {...tr} />
          </G>
        );
      case "pin":
        return (
          <G>
            <Path d="M12 21.5 C12 21.5 5 14.5 5 9.5 a7 7 0 0 1 14 0 C19 14.5 12 21.5 12 21.5 Z" {...tr} />
            <Circle cx="12" cy="9.5" r="2.6" {...tr} />
          </G>
        );
      case "pessoa":
        return (
          <G>
            <Circle cx="12" cy="8" r="4" {...tr} />
            <Path d="M4.5 21 C5.5 16.5 8.5 14.5 12 14.5 C15.5 14.5 18.5 16.5 19.5 21" {...tr} />
          </G>
        );
      case "calendario":
        return (
          <G>
            <Rect x="3.5" y="5" width="17" height="15.5" rx="2" {...tr} />
            <Path d="M3.5 10 H20.5 M8 3 V7 M16 3 V7" {...tr} />
            <Path d="M8 14 H10 M14 14 H16 M8 17 H10" {...tr} />
          </G>
        );
      case "check":
        return <Path d="M5 12.5 L10 17.5 L19 7" {...tr} />;
      case "lupa":
        return (
          <G>
            <Circle cx="10.5" cy="10.5" r="6" {...tr} />
            <Path d="M15 15 L20.5 20.5" {...tr} />
          </G>
        );
      case "joia":
        return (
          <G>
            <Path d="M7 10.5 V20.5 H4 V10.5 Z" {...tr} />
            <Path d="M7 19.5 H16.5 C17.6 19.5 18.4 18.8 18.6 17.8 L19.9 12.3 C20.2 11.1 19.3 10 18.1 10 H13.5 L14.3 6.2 C14.5 5 13.7 3.8 12.5 3.6 L7 10.5" {...tr} />
          </G>
        );
      case "moeda":
        return (
          <G>
            <Circle cx="12" cy="12" r="9" {...tr} />
            <Path d="M14.8 8.6 C14.2 7.8 13.2 7.4 12 7.4 C10.3 7.4 9.2 8.3 9.2 9.6 C9.2 12.6 15 11.2 15 14.3 C15 15.7 13.7 16.6 12 16.6 C10.7 16.6 9.6 16.1 9 15.2 M12 5.6 V7.4 M12 16.6 V18.4" {...tr} />
          </G>
        );
      case "sino":
        return (
          <G>
            <Path d="M6 16.5 V11 a6 6 0 0 1 12 0 V16.5 L19.5 18 H4.5 Z" {...tr} />
            <Path d="M10 20.5 a2 2 0 0 0 4 0" {...tr} />
          </G>
        );
      case "celular":
        return (
          <G>
            <Rect x="6.5" y="2.5" width="11" height="19" rx="2.2" {...tr} />
            <Path d="M10.5 18.5 H13.5" {...tr} />
          </G>
        );
      case "porquinho":
        return (
          <G>
            <Path d="M5 11.5 C5 8 8.5 6 12.5 6 C14.5 6 16.3 6.5 17.6 7.5 L20 6.5 L19.4 9.6 C20.1 10.4 20.5 11.4 20.5 12.5 C20.5 14.2 19.5 15.6 18 16.5 V19.5 H15.5 L15 18 H10.5 L10 19.5 H7.5 V16.7 C6 15.8 5 14.3 5 12.5" {...tr} />
            <Path d="M5 11.5 C3.8 11.5 3 10.8 3 9.8 M10.5 8.6 H14" {...tr} />
          </G>
        );
      case "relogio":
        return (
          <G>
            <Circle cx="12" cy="12" r="9" {...tr} />
            <Path d="M12 7 V12 L15.5 14" {...tr} />
          </G>
        );
    }
  }

  /** Quadradinho azul com o glifo branco, como nas linhas do detalhamento deles. */
  function Icone({ tipo, tamanho = 28, fundo = COR.azul }: { tipo: Glifo; tamanho?: number; fundo?: string }) {
    return (
      <Svg width={tamanho} height={tamanho} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id={`ic-${fundo}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={misturar(fundo, "#ffffff", 0.18)} />
            <Stop offset="1" stopColor={fundo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="24" height="24" rx="5.5" fill={`url(#ic-${fundo})`} />
        <G transform="translate(4 4) scale(0.667)">
          <Glifos tipo={tipo} cor="#ffffff" largura={1.9} />
        </G>
      </Svg>
    );
  }

  /** Bolha clara com o glifo na cor, nos cartões de números e nas listas. */
  function Bolha({ tipo, tamanho = 30, cor = COR.azul, fundo = COR.azulFundo }: { tipo: Glifo; tamanho?: number; cor?: string; fundo?: string }) {
    return (
      <Svg width={tamanho} height={tamanho} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="12" fill={fundo} />
        <G transform="translate(5.4 5.4) scale(0.55)">
          <Glifos tipo={tipo} cor={cor} largura={1.9} />
        </G>
      </Svg>
    );
  }

  // -------------------------------------------------------------- a moldura

  function Pagina({
    n,
    d,
    sobre,
    titulo,
    nota,
    children,
  }: {
    n: number;
    d: DadosProposta;
    sobre: string;
    titulo: string;
    nota?: string[];
    children: React.ReactNode;
  }) {
    return (
      <Page size="A4" style={{ fontFamily: "Montserrat", fontSize: 9.5, color: COR.tinta, paddingTop: 50, paddingBottom: 64, paddingHorizontal: MARGEM }}>
        {/* Os acentos azuis nos cantos, a marca das páginas deles. */}
        <View fixed style={{ position: "absolute", top: 20, left: 84, width: 4.5, height: 40, borderRadius: 2.25, backgroundColor: COR.azul }} />
        <View fixed style={{ position: "absolute", top: 18, right: 0, width: 11, height: 44, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: COR.azul }} />
        <View fixed style={{ position: "absolute", bottom: 0, left: 0, width: 11, height: 70, borderTopRightRadius: 4, backgroundColor: COR.azul }} />
        <View fixed style={{ position: "absolute", bottom: 0, right: 0, width: 11, height: 44, borderTopLeftRadius: 4, backgroundColor: COR.azul }} />

        <View style={{ alignItems: "center", marginBottom: 20 }}>
          <Text style={t(700, 7.5, COR.laranja, { letterSpacing: 2.2, textTransform: "uppercase", marginBottom: 5 })}>{sobre}</Text>
          <Text style={t(800, 20, COR.azul, { textTransform: "uppercase", letterSpacing: 0.3, textAlign: "center" })}>{titulo}</Text>
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <View style={{ width: 26, height: 3, borderRadius: 1.5, backgroundColor: COR.azul }} />
            <View style={{ width: 8, height: 3, borderRadius: 1.5, backgroundColor: COR.laranja, marginLeft: 3 }} />
          </View>
        </View>

        {children}

        {nota && (
          <View style={{ position: "absolute", bottom: 46, left: MARGEM, right: MARGEM + 30 }}>
            {nota.map((linha) => (
              <Text key={linha} style={t(400, 6.8, COR.fraca, { lineHeight: 1.4 })}>
                {linha}
              </Text>
            ))}
          </View>
        )}

        <View fixed style={{ position: "absolute", bottom: 22, left: MARGEM, right: MARGEM, flexDirection: "row", alignItems: "center" }}>
          <Text style={t(600, 7, COR.apagada, { flex: 1, letterSpacing: 0.3 })}>
            {`${d.empresa.nome}  ·  Proposta nº ${d.numero}  ·  ${d.cliente.nome}`}
          </Text>
          <Text style={t(800, 10, COR.azul)}>{String(n).padStart(2, "0")}</Text>
        </View>
      </Page>
    );
  }

  /** "GARANTIAS ———" como o separador deles, com o traço azul. */
  function Secao({ titulo, topo = 0 }: { titulo: string; topo?: number }) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: topo, marginBottom: 11 }}>
        <Text style={t(700, 8.5, COR.navy, { textTransform: "uppercase", letterSpacing: 1.4, marginRight: 12 })}>{titulo}</Text>
        <View style={{ flex: 1, height: 2.5, borderRadius: 1.25, backgroundColor: COR.azul }} />
      </View>
    );
  }

  // ------------------------------------------------------------------- capa

  /**
   * A cena da capa, quando a empresa não subiu foto: um campo de módulos em
   * perspectiva sob o céu do fim de tarde, com o sol baixo à direita — a mesma
   * composição da foto da proposta deles, em vetor.
   */
  function CenaDaCapa() {
    const W = PAG.w;
    const H = PAG.h;
    // o campo de módulos: a borda de cima corre para o sol, à direita; a de
    // baixo some fora da página, à esquerda — um telhado visto de lado e de baixo
    const campo = perspectiva([20, 292], [720, 598], [720, 676], [-980, 1210]);
    const fileiras: [number, number][] = [
      [0.0, 0.3],
      [0.34, 0.64],
      [0.68, 0.98],
    ];
    const colunas = 18;
    const modulos: React.ReactNode[] = [];
    fileiras.forEach(([v0, v1], fi) => {
      for (let lin = 0; lin < 2; lin++) {
        const va = v0 + ((v1 - v0) / 2) * lin;
        const vb = va + (v1 - v0) / 2;
        for (let c = 0; c < colunas; c++) {
          const ua = c / colunas;
          const ub = (c + 1) / colunas;
          const gu = 0.0035;
          const gv = 0.006;
          const q = [campo(ua + gu, va + gv), campo(ub - gu, va + gv), campo(ub - gu, vb - gv), campo(ua + gu, vb - gv)];
          // longe = reflexo quente do sol; perto = o azul-escuro da célula
          const longe = Math.pow(ub, 0.75);
          const cor = misturar(misturar("#1d2740", "#3a3550", fi * 0.25), "#d18a5c", longe * 0.95);
          modulos.push(<Path key={`m${fi}${lin}${c}`} d={`M${p(q[0])} L${p(q[1])} L${p(q[2])} L${p(q[3])} Z`} fill={cor} />);
          // as células: linhas finas, mais apagadas quanto mais longe
          const linhas: string[] = [];
          for (let k = 1; k < 6; k++) {
            const u = ua + gu + ((ub - ua - 2 * gu) * k) / 6;
            linhas.push(`M${p(campo(u, va + gv))} L${p(campo(u, vb - gv))}`);
          }
          for (let k = 1; k < 3; k++) {
            const v = va + gv + ((vb - va - 2 * gv) * k) / 3;
            linhas.push(`M${p(campo(ua + gu, v))} L${p(campo(ub - gu, v))}`);
          }
          modulos.push(
            <Path key={`c${fi}${lin}${c}`} d={linhas.join(" ")} stroke="#ffffff" strokeOpacity={0.13 * (1 - longe * 0.6)} strokeWidth={0.6} fill="none" />,
          );
        }
      }
    });
    // os trilhos entre as fileiras: a faixa mais escura que separa um painel do outro
    const trilhos = fileiras.slice(1).map(([v0], i) => {
      const a = fileiras[i][1];
      return (
        <Path
          key={`t${i}`}
          d={`M${p(campo(0, a))} L${p(campo(1, a))} L${p(campo(1, v0))} L${p(campo(0, v0))} Z`}
          fill="#2a2030"
          fillOpacity={0.55}
        />
      );
    });

    return (
      <Svg width={W} height={H - 2} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", top: 0, left: 0 }}>
        <Defs>
          <LinearGradient id="ceu" x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor="#7d93a9" />
            <Stop offset="0.3" stopColor="#aab7bf" />
            <Stop offset="0.55" stopColor="#dfd3bd" />
            <Stop offset="0.75" stopColor="#f2c48f" />
            <Stop offset="1" stopColor="#f5a660" />
          </LinearGradient>
          <RadialGradient id="sol" cx="0.93" cy="0.69" r="0.62" fx="0.93" fy="0.69">
            <Stop offset="0" stopColor="#fffaf0" stopOpacity={1} />
            <Stop offset="0.08" stopColor="#ffe2a8" stopOpacity={0.95} />
            <Stop offset="0.3" stopColor="#ffb25e" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#ff9a40" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="sombra" x1="0" y1="1" x2="0.6" y2="0.3">
            <Stop offset="0" stopColor="#120c18" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#120c18" stopOpacity={0} />
          </LinearGradient>
          <ClipPath id="moldura">
            <Path d={`M0 ${H} V175 Q0 56 118 56 H${W} V${H} Z`} />
          </ClipPath>
        </Defs>
        <G clipPath="url(#moldura)">
          <Rect x="0" y="0" width={W} height={H} fill="url(#ceu)" />
          {/* o chão por baixo dos módulos aparece nas frestas, claro de alumínio */}
          <Path d={`M${p(campo(0, 0))} L${p(campo(1, 0))} L${p(campo(1, 1))} L${p(campo(0, 1))} Z`} fill="#cdb7a3" />
          {modulos}
          {trilhos}
          <Rect x="0" y="0" width={W} height={H} fill="url(#sombra)" />
          <Rect x="0" y="0" width={W} height={H} fill="url(#sol)" />
        </G>
        {/* a linha fina que contorna a foto, como na capa deles */}
        <Path d={`M30 ${H} V128 Q30 6 152 6 H${W}`} stroke="#5b6b85" strokeWidth={1.3} fill="none" />
      </Svg>
    );
  }

  function Capa({ d, visual }: { d: DadosProposta; visual: VisualDaProposta }) {
    const X = 302;
    const L = PAG.w - X - 12;
    const sombra = { position: "absolute" as const, left: X + 1.5, width: L, borderRadius: 11, backgroundColor: "#1a1020", opacity: 0.12 };
    const cartao = { position: "absolute" as const, left: X, width: L, borderRadius: 11, backgroundColor: "#ffffff", paddingHorizontal: 16 };
    const blocos: { topo: number; altura: number; conteudo: React.ReactNode }[] = [
      {
        topo: 282,
        altura: 150,
        conteudo: (
          <View style={{ paddingTop: 14 }}>
            <Text style={t(500, 9.5, COR.fraca)}>
              <Text style={t(700, 9.5, COR.azul)}>Proposta: </Text>
              {String(d.numero)}
            </Text>
            <Text style={t(800, 29, COR.navy, { lineHeight: 1.0, marginTop: 6, letterSpacing: 0.2 })}>PROPOSTA</Text>
            <Text style={t(800, 29, COR.navy, { lineHeight: 1.0, letterSpacing: 0.2 })}>COMERCIAL</Text>
            <Text style={t(700, 10.5, COR.navy, { marginTop: 12 })}>{d.cliente.nome}</Text>
            <View style={{ flexDirection: "row", marginTop: 6 }}>
              <View style={{ backgroundColor: COR.laranjaFundo, borderRadius: 9, paddingVertical: 3, paddingHorizontal: 9 }}>
                <Text style={t(800, 12, COR.laranja)}>{kwpTexto(d.sistema.kwp)}</Text>
              </View>
            </View>
          </View>
        ),
      },
      {
        topo: 442,
        altura: 46,
        conteudo: (
          <View style={{ flexDirection: "row", alignItems: "center", height: 46 }}>
            <Bolha tipo="pin" tamanho={22} />
            <Text style={t(600, 10, COR.navy, { marginLeft: 9 })}>{cidadeDoCliente(d.cliente)}</Text>
          </View>
        ),
      },
      {
        topo: 498,
        altura: 58,
        conteudo: (
          <View style={{ flexDirection: "row", alignItems: "center", height: 58 }}>
            <Bolha tipo="pessoa" tamanho={22} />
            <View style={{ marginLeft: 9, flex: 1 }}>
              <Text style={t(700, 10.5, COR.navy)}>Responsável Comercial</Text>
              <Text style={t(500, 9, COR.fraca, { marginTop: 2 })}>
                {d.responsavel ? (d.responsavel.contato ? `${d.responsavel.nome}  ·  ${d.responsavel.contato}` : d.responsavel.nome) : d.empresa.nome}
              </Text>
            </View>
          </View>
        ),
      },
      {
        topo: 566,
        altura: 58,
        conteudo: (
          <View style={{ flexDirection: "row", alignItems: "center", height: 58 }}>
            <Bolha tipo="calendario" tamanho={22} />
            <View style={{ marginLeft: 9 }}>
              <Text style={t(500, 9, COR.navy)}>
                <Text style={t(700, 9, COR.navy)}>Proposta criada em: </Text>
                {d.criadaEm}
              </Text>
              <Text style={t(500, 9, COR.navy, { marginTop: 3 })}>
                <Text style={t(700, 9, COR.navy)}>Proposta válida até: </Text>
                {d.validaAte}
              </Text>
            </View>
          </View>
        ),
      },
    ];

    return (
      <Page size="A4" style={{ fontFamily: "Montserrat", backgroundColor: "#ffffff" }}>
        {visual.capa ? (
          <>
            <Image src={visual.capa} style={{ position: "absolute", top: 56, left: 0, width: PAG.w, height: PAG.h - 58, objectFit: "cover" }} />
            {/* o canto arredondado da foto e o véu claro atrás do logo */}
            <Svg width={PAG.w} height={PAG.h - 2} viewBox={`0 0 ${PAG.w} ${PAG.h}`} preserveAspectRatio="none" style={{ position: "absolute", top: 0, left: 0 }}>
              <Defs>
                <LinearGradient id="veu" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#ffffff" stopOpacity={0.55} />
                  <Stop offset="0.35" stopColor="#ffffff" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="56" width={PAG.w} height={PAG.h} fill="url(#veu)" />
              <Path d={`M0 0 H${PAG.w} V56 H118 Q0 56 0 175 Z`} fill="#ffffff" />
              <Path d={`M30 ${PAG.h} V128 Q30 6 152 6 H${PAG.w}`} stroke="#5b6b85" strokeWidth={1.3} fill="none" />
            </Svg>
          </>
        ) : (
          <CenaDaCapa />
        )}

        {/* o logo, sobre o céu claro */}
        <View style={{ position: "absolute", top: 92, left: X, width: L, height: 168, alignItems: "center", justifyContent: "center" }}>
          {visual.logo ? (
            <Image src={visual.logo} style={{ maxWidth: 210, maxHeight: 160, objectFit: "contain" }} />
          ) : (
            <Text style={t(800, 22, COR.navy, { textAlign: "center", lineHeight: 1.15 })}>{d.empresa.nome.toUpperCase()}</Text>
          )}
        </View>

        {blocos.map((b) => (
          <React.Fragment key={b.topo}>
            <View style={{ ...sombra, top: b.topo + 3, height: b.altura }} />
            <View style={{ ...cartao, top: b.topo, height: b.altura }}>{b.conteudo}</View>
          </React.Fragment>
        ))}
      </Page>
    );
  }

  // ------------------------------------------------------------ passo a passo

  const PASSOS: { texto: string; icone: Glifo }[] = [
    { icone: "documento", texto: "Fazemos o orçamento preliminar de acordo com o seu consumo médio mensal de energia e a irradiação solar local." },
    { icone: "joia", texto: "Fechamos a proposta ideal para você." },
    { icone: "lupa", texto: "Após aprovada a proposta, conduzimos a vistoria técnica do local para coletar requisitos técnicos do sistema." },
    { icone: "estrutura", texto: "Com os requisitos técnicos em mãos, elaboramos o projeto e solicitamos o acesso à rede de energia junto à concessionária local." },
    { icone: "ferramenta", texto: "Após o projeto ser aprovado pela concessionária de energia, realizamos a instalação do sistema e solicitamos a troca do relógio para o modelo bidirecional." },
  ];

  function PassoAPasso() {
    const passoY = 60;
    const r = 21;
    const centro = LARGURA / 2;
    const altura = passoY * 4 + r * 2 + 4;
    return (
      <View style={{ height: altura, position: "relative" }}>
        <Svg width={LARGURA} height={altura} viewBox={`0 0 ${LARGURA} ${altura}`} style={{ position: "absolute", top: 0, left: 0 }}>
          <Defs>
            {COR.passos.map((c, i) => (
              <LinearGradient key={c} id={`passo${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={misturar(c, "#ffffff", 0.22)} />
                <Stop offset="1" stopColor={c} />
              </LinearGradient>
            ))}
          </Defs>
          {PASSOS.slice(0, -1).map((_, i) => (
            <Rect key={i} x={centro - 4.5} y={r + i * passoY} width={9} height={passoY} fill={COR.passos[i]} />
          ))}
          {PASSOS.map((_, i) => {
            const cy = r + 2 + i * passoY;
            return (
              <G key={`c${i}`}>
                <Circle cx={centro} cy={cy + 1.5} r={r} fill="#000000" fillOpacity={0.08} />
                <Circle cx={centro} cy={cy} r={r} fill={`url(#passo${i})`} />
                <Circle cx={centro} cy={cy} r={r - 4} fill="none" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1.2} />
                <Text x={centro} y={cy + 8.5} fill="#ffffff" style={ts(800, 23)} textAnchor="middle">
                  {String(i + 1)}
                </Text>
              </G>
            );
          })}
        </Svg>
        {PASSOS.map((passo, i) => {
          const esquerda = i % 2 === 1;
          const cor = COR.passos[i];
          return (
            <View key={i} style={{ position: "absolute", top: i * passoY + 1, width: 196, ...(esquerda ? { right: centro + 34, alignItems: "flex-end" } : { left: centro + 34 }) }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
                <Svg width={13} height={13} viewBox="0 0 24 24">
                  <Rect x="0" y="0" width="24" height="24" rx="6" fill={cor} />
                  <G transform="translate(4.5 4.5) scale(0.625)">
                    <Glifos tipo={passo.icone} cor="#ffffff" largura={2.4} />
                  </G>
                </Svg>
                <Text style={t(700, 8.5, cor, { marginLeft: 5 })}>{`Passo ${i + 1}`}</Text>
              </View>
              <Text style={t(400, 8.4, COR.fraca, { lineHeight: 1.42, textAlign: esquerda ? "right" : "left" })}>{passo.texto}</Text>
            </View>
          );
        })}
      </View>
    );
  }

  /**
   * A casa com o sistema: o sol nos módulos, o inversor, o quadro, o medidor
   * bidirecional e o poste, com as setas coloridas do caminho da energia — a
   * ilustração da página 2 deles, desenhada em vetor.
   */
  function CasaDoSistema() {
    const W = LARGURA;
    const H = 304;
    const AMARELO = COR.amarelo;
    const VERDE = COR.verde;
    const ROXO = "#8b5cf6";
    const AZUL = "#2f80ed";
    const VERMELHO = COR.vermelho;

    // o telhado: vetor ao longo do beiral (u) e subindo a água (v)
    const beiral: Ponto = [92, 168];
    const u: Ponto = [214, 0];
    const v: Ponto = [30, -68];
    const noTelhado = (a: number, b: number): Ponto => [beiral[0] + u[0] * a + v[0] * b, beiral[1] + u[1] * a + v[1] * b];
    const paineis: React.ReactNode[] = [];
    const cols = 4;
    const lins = 2;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < lins; j++) {
        const a0 = 0.07 + (0.86 / cols) * i + 0.006;
        const a1 = 0.07 + (0.86 / cols) * (i + 1) - 0.006;
        const b0 = 0.14 + (0.74 / lins) * j + 0.02;
        const b1 = 0.14 + (0.74 / lins) * (j + 1) - 0.02;
        const q = [noTelhado(a0, b0), noTelhado(a1, b0), noTelhado(a1, b1), noTelhado(a0, b1)];
        const celulas: string[] = [];
        for (let k = 1; k < 4; k++) {
          const a = a0 + ((a1 - a0) * k) / 4;
          celulas.push(`M${p(noTelhado(a, b0))} L${p(noTelhado(a, b1))}`);
        }
        celulas.push(`M${p(noTelhado(a0, (b0 + b1) / 2))} L${p(noTelhado(a1, (b0 + b1) / 2))}`);
        paineis.push(
          <G key={`${i}${j}`}>
            <Path d={`M${p(q[0])} L${p(q[1])} L${p(q[2])} L${p(q[3])} Z`} fill="url(#painel)" stroke="#dbe5f3" strokeWidth={1.2} />
            <Path d={celulas.join(" ")} stroke="#9cc0f5" strokeOpacity={0.55} strokeWidth={0.5} />
          </G>,
        );
      }
    }
    const fimDoBeiral = noTelhado(1, 0);
    const cumeeira = noTelhado(1, 1);

    const seta = (x: number, y: number, ang: number, cor: string) => (
      <Path d="M0 0 L-6.5 -3.6 L-6.5 3.6 Z" fill={cor} transform={`translate(${x} ${y}) rotate(${ang})`} />
    );
    const rotulo = (x: number, y: number, texto: string[], ancora: "start" | "end" | "middle" = "start") =>
      texto.map((l, i) => (
        <Text key={l} x={x} y={y + i * 10} fill={COR.navy} style={ts(700, 8)} textAnchor={ancora}>
          {l}
        </Text>
      ));

    return (
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="painel" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#3b6fd0" />
            <Stop offset="1" stopColor="#173a7a" />
          </LinearGradient>
          <RadialGradient id="brilho" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#ffd666" stopOpacity={0.8} />
            <Stop offset="1" stopColor="#ffd666" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="parede" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" />
            <Stop offset="1" stopColor="#f1ece4" />
          </LinearGradient>
        </Defs>

        {/* o fundo: um círculo de céu claro e o chão */}
        <Circle cx={210} cy={150} r={128} fill={COR.azulGelo} />
        <Ellipse cx={248} cy={262} rx={236} ry={9} fill="#e7ecf2" />

        {/* sol e raios até os módulos */}
        <Circle cx={46} cy={46} r={42} fill="url(#brilho)" />
        <Circle cx={46} cy={46} r={19} fill={AMARELO} />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * Math.PI) / 6;
          return (
            <Line key={i} x1={46 + Math.cos(a) * 25} y1={46 + Math.sin(a) * 25} x2={46 + Math.cos(a) * 32} y2={46 + Math.sin(a) * 32} stroke={AMARELO} strokeWidth={2.4} strokeLinecap="round" />
          );
        })}
        {[0, 1, 2].map((i) => (
          <Path key={i} d={`M${70 + i * 8} ${66 + i * 2} L${112 + i * 30} ${118 + i * 4}`} stroke={AMARELO} strokeWidth={1.6} strokeDasharray="4 3" />
        ))}

        {/* a casa: parede da frente, lateral e o oitão */}
        <Rect x={104} y={168} width={196} height={92} fill="url(#parede)" />
        <Path d={`M300 168 L356 140 L356 232 L300 260 Z`} fill="#e8dfd2" />
        <Path d={`M${p(fimDoBeiral)} L${p(cumeeira)} L366 135 Z`} fill="#e3d8c8" />
        <Circle cx={330} cy={142} r={5} fill="#c9d8ee" stroke="#ffffff" strokeWidth={1.2} />
        {/* telhado */}
        <Path d={`M${p(noTelhado(0, 0))} L${p(fimDoBeiral)} L${p(cumeeira)} L${p(noTelhado(0, 1))} Z`} fill="#e8743b" />
        <Path d={`M${p(noTelhado(0, 1))} L${p(cumeeira)}`} stroke="#b9541f" strokeWidth={3} strokeLinecap="round" />
        <Path d={`M${p(cumeeira)} L366 135`} stroke="#b9541f" strokeWidth={3} strokeLinecap="round" />
        <Rect x={beiral[0] - 2} y={beiral[1] - 1} width={u[0] + 4} height={6} rx={1.5} fill="#c4561f" />
        {paineis}
        {/* porta e janela */}
        <Rect x={132} y={202} width={34} height={58} rx={2} fill={COR.azul} />
        <Circle cx={160} cy={233} r={1.8} fill="#ffffff" />
        <Rect x={196} y={190} width={64} height={38} rx={2} fill="#cfe1fb" stroke="#ffffff" strokeWidth={2.5} />
        <Line x1={228} y1={190} x2={228} y2={228} stroke="#ffffff" strokeWidth={2.5} />
        {/* lâmpada acesa dentro da casa: a energia consumida */}
        <Circle cx={212} cy={204} r={4.5} fill="#ffe08a" />
        {/* inversor e quadro na parede lateral */}
        <Rect x={309} y={176} width={20} height={27} rx={2.5} fill="#f8fafc" stroke="#64748b" strokeWidth={1.1} />
        <Rect x={313} y={181} width={12} height={6} rx={1} fill="#1e293b" />
        <Circle cx={319} cy={195} r={1.8} fill={VERDE} />
        <Rect x={318} y={212} width={18} height={22} rx={2} fill="#cbd5e1" stroke="#64748b" strokeWidth={1.1} />
        <Path d="M322 218 H332 M322 223 H332 M322 228 H332" stroke="#475569" strokeWidth={0.9} />

        {/* poste da rede e o medidor no muro */}
        <Rect x={466} y={44} width={7} height={218} rx={1.5} fill="#7b8797" />
        <Rect x={444} y={58} width={52} height={5} rx={1.5} fill="#7b8797" />
        {[449, 469.5, 490].map((x) => (
          <Circle key={x} cx={x} cy={56} r={2.6} fill="#a7b3c3" />
        ))}
        <Rect x={474} y={84} width={16} height={26} rx={3} fill="#94a3b8" />
        <Rect x={392} y={200} width={14} height={62} fill="#d6dde6" />
        <Rect x={385} y={180} width={28} height={30} rx={3} fill="#ffffff" stroke="#334155" strokeWidth={1.1} />
        <Circle cx={399} cy={193} r={6.5} fill="none" stroke="#334155" strokeWidth={0.9} />
        <Path d="M399 193 L402.5 189.5" stroke={VERMELHO} strokeWidth={1.1} />
        <Path d="M448 62 Q424 120 404 179" stroke="#475569" strokeWidth={1.1} fill="none" />

        {/* o caminho da energia */}
        <Path d="M282 150 L304 152 L314 172" stroke={AMARELO} strokeWidth={2.6} fill="none" strokeLinejoin="round" />
        {seta(316, 176, 62, AMARELO)}
        <Path d="M323 203 L325 207" stroke={VERDE} strokeWidth={2.6} />
        {seta(326, 211, 70, VERDE)}
        <Path d="M336 220 L378 220" stroke={VERDE} strokeWidth={2.6} />
        {seta(384, 220, 0, VERDE)}
        <Path d="M318 226 L270 214" stroke={ROXO} strokeWidth={2.6} />
        {seta(264, 212.5, 194, ROXO)}
        <Path d="M413 188 L455 188" stroke={AZUL} strokeWidth={2.6} />
        {seta(461, 188, 0, AZUL)}
        <Path d="M462 200 L420 200" stroke={VERMELHO} strokeWidth={2.6} />
        {seta(414, 200, 180, VERMELHO)}

        {/* os nomes */}
        <Line x1={196} y1={86} x2={196} y2={113} stroke={COR.apagada} strokeWidth={0.8} />
        {rotulo(196, 80, ["Módulos solares"], "middle")}
        <Line x1={329} y1={190} x2={372} y2={150} stroke={COR.apagada} strokeWidth={0.8} />
        {rotulo(376, 148, ["Inversor on-grid"])}
        <Line x1={326} y1={234} x2={318} y2={268} stroke={COR.apagada} strokeWidth={0.8} />
        {rotulo(322, 277, ["Quadro elétrico"], "end")}
        <Line x1={399} y1={262} x2={404} y2={268} stroke={COR.apagada} strokeWidth={0.8} />
        {rotulo(406, 277, ["Medidor bidirecional"], "middle")}
        {rotulo(W, 24, ["Rede da", "concessionária"], "end")}

        {/* legenda, numa linha embaixo */}
        <G transform={`translate(0 ${H - 5})`}>
          {(
            [
              [AMARELO, "Gerada (contínua)", 0],
              [VERDE, "Gerada (alternada)", 100],
              [ROXO, "Consumida na casa", 205],
              [AZUL, "Injetada na rede", 309],
              [VERMELHO, "Fornecida pela rede", 407],
            ] as const
          ).map(([cor, texto, x]) => (
            <G key={texto} transform={`translate(${x} 0)`}>
              <Rect x={0} y={-4} width={12} height={4} rx={2} fill={cor} />
              <Text x={16} y={0} fill={COR.fraca} style={ts(500, 6.6)}>
                {texto}
              </Text>
            </G>
          ))}
        </G>
      </Svg>
    );
  }

  // ------------------------------------------------------------------- gráficos

  function GraficoGeracao({ geracao, consumo }: { geracao: number[]; consumo: number }) {
    const W = LARGURA;
    const H = 178;
    const area = { x: 30, y: 16, w: W - 34, h: H - 38 };
    const { topo, passo } = eixoBonito(Math.max(...geracao, consumo) * 1.04, 7);
    const y = (v: number) => area.y + area.h - (v / topo) * area.h;
    const grupo = area.w / 12;
    const largura = grupo * 0.32;
    const grades: number[] = [];
    for (let v = 0; v <= topo + 0.001; v += passo) grades.push(v);
    return (
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="ger" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={COR.azulVivo} />
            <Stop offset="1" stopColor={COR.azul} />
          </LinearGradient>
        </Defs>
        {grades.map((v) => (
          <G key={v}>
            <Line x1={area.x} y1={y(v)} x2={area.x + area.w} y2={y(v)} stroke={COR.linha} strokeWidth={0.6} strokeDasharray={v === 0 ? undefined : "2 2"} />
            <Text x={area.x - 6} y={y(v) + 2.4} fill={COR.apagada} style={ts(500, 6.6)} textAnchor="end">
              {String(Math.round(v))}
            </Text>
          </G>
        ))}
        {geracao.map((v, i) => {
          const x0 = area.x + i * grupo + grupo * 0.15;
          const base = area.y + area.h;
          return (
            <G key={MESES[i]}>
              <Path d={barra(x0, y(v), largura, base - y(v), 2.5)} fill="url(#ger)" />
              <Path d={barra(x0 + largura + 1.5, y(consumo), largura, base - y(consumo), 2.5)} fill={COR.cinzaBarra} />
              <Text x={x0 + largura / 2} y={y(v) - 3.5} fill={COR.azul} style={ts(700, 5.8)} textAnchor="middle">
                {String(Math.round(v))}
              </Text>
              <Text x={area.x + i * grupo + grupo / 2} y={H - 12} fill={COR.fraca} style={ts(600, 7.2)} textAnchor="middle">
                {MESES[i]}
              </Text>
            </G>
          );
        })}
      </Svg>
    );
  }

  function GraficoCaixa({ fluxo, payback, largura, altura }: { fluxo: number[]; payback: number | null; largura: number; altura: number }) {
    const pontos = fluxo.map((v, ano) => ({ v, ano })).filter((ponto) => ponto.ano % 2 === 0);
    const area = { x: 44, y: 14, w: largura - 48, h: altura - 30 };
    const min = Math.min(0, ...pontos.map((ponto) => ponto.v));
    const maxV = Math.max(...pontos.map((ponto) => ponto.v));
    const { topo, passo } = eixoBonito(maxV - min, 4);
    const base = min < 0 ? -Math.ceil(-min / passo) * passo : 0;
    const escala = topo + (base < 0 ? -base : 0);
    const y = (v: number) => area.y + area.h - ((v - base) / escala) * area.h;
    const grupo = area.w / pontos.length;
    const grades: number[] = [];
    for (let v = base; v <= base + escala + 0.001; v += passo) grades.push(v);
    // a linha do retorno, entre as barras dos anos em volta
    const xDoAno = (ano: number) => area.x + (ano / 2) * grupo + grupo / 2;
    const anoRetorno = payback === null ? null : payback / 12;
    const kilo = (v: number) => (Math.abs(v) >= 1000 ? `${numero(v / 1000)} mil` : numero(v));
    return (
      <Svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`}>
        <Defs>
          <LinearGradient id="cx" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={COR.azulVivo} />
            <Stop offset="1" stopColor={COR.azul} />
          </LinearGradient>
        </Defs>
        {grades.map((v) => (
          <G key={v}>
            <Line x1={area.x} y1={y(v)} x2={area.x + area.w} y2={y(v)} stroke={v === 0 ? COR.apagada : COR.linha} strokeWidth={v === 0 ? 0.8 : 0.5} strokeDasharray={v === 0 ? undefined : "2 2"} />
            <Text x={area.x - 5} y={y(v) + 2.3} fill={COR.apagada} style={ts(500, 6.2)} textAnchor="end">
              {kilo(v)}
            </Text>
          </G>
        ))}
        {pontos.map((ponto, i) => {
          const topoBarra = Math.min(y(ponto.v), y(0));
          const alturaBarra = Math.max(Math.abs(y(ponto.v) - y(0)), 0.8);
          const x = area.x + i * grupo + grupo * 0.2;
          return (
            <G key={ponto.ano}>
              {ponto.v >= 0 ? (
                <Path d={barra(x, topoBarra, grupo * 0.6, alturaBarra, 2)} fill="url(#cx)" />
              ) : (
                <Rect x={x} y={topoBarra} width={grupo * 0.6} height={alturaBarra} fill={COR.laranja} />
              )}
              <Text x={area.x + i * grupo + grupo / 2} y={altura - 6} fill={COR.fraca} style={ts(600, 6.4)} textAnchor="middle">
                {String(ponto.ano)}
              </Text>
            </G>
          );
        })}
        {anoRetorno !== null && anoRetorno <= 24 && (
          <G>
            <Line x1={xDoAno(anoRetorno)} y1={area.y - 4} x2={xDoAno(anoRetorno)} y2={area.y + area.h} stroke={COR.laranja} strokeWidth={1} strokeDasharray="3 2" />
            <Rect x={xDoAno(anoRetorno) + 3} y={area.y - 10} width={60} height={13} rx={6.5} fill={COR.laranja} />
            <Text x={xDoAno(anoRetorno) + 33} y={area.y - 1.3} fill="#ffffff" style={ts(700, 6.4)} textAnchor="middle">
              Retorno aqui
            </Text>
          </G>
        )}
      </Svg>
    );
  }

  // ------------------------------------------------------------ monitoramento

  /** O celular com o relatório da usina, como o exemplo deles. */
  function Celular({ d, escala = 1 }: { d: DadosProposta; escala?: number }) {
    const W = 196;
    const H = 392;
    const e = d.energia;
    const instantaneo = Math.min(e.geracaoMedia * d.premissas.simultaneidade, e.consumoMedio);
    const injetada = e.geracaoMedia - instantaneo;
    const registrado = Math.max(e.consumoMedio - instantaneo, 0);
    const tela = { x: 10, y: 12, w: W - 20, h: H - 24 };
    const cx = tela.x + tela.w / 2;
    /** Um nó do fluxo, com o nome em cima (`acima`) ou embaixo. */
    const no = (x: number, y: number, tipo: Glifo, titulo: string, valor: string | null, acima: boolean) => (
      <G>
        <Circle cx={x} cy={y} r={14} fill={COR.azulFundo} />
        <G transform={`translate(${x - 8} ${y - 8}) scale(0.667)`}>
          <Glifos tipo={tipo} cor={COR.azul} largura={1.9} />
        </G>
        <Text x={x} y={acima ? y - (valor ? 27 : 20) : y + 24} fill={COR.navy} style={ts(700, 6.4)} textAnchor="middle">
          {titulo}
        </Text>
        {valor && (
          <Text x={x} y={acima ? y - 19 : y + 32.5} fill={COR.azul} style={ts(800, 7)} textAnchor="middle">
            {valor}
          </Text>
        )}
      </G>
    );
    const kwh = (n: number) => `${numero(n)} kWh`;
    const cartaoTela = (x: number, y: number, titulo: string, valor: string, cor: string) => (
      <G>
        <Rect x={x} y={y} width={74} height={36} rx={6} fill="#ffffff" stroke={COR.linha} strokeWidth={0.8} />
        <Text x={x + 37} y={y + 13} fill={COR.fraca} style={ts(500, 6)} textAnchor="middle">
          {titulo}
        </Text>
        <Text x={x + 37} y={y + 26} fill={cor} style={ts(800, 8.4)} textAnchor="middle">
          {valor}
        </Text>
      </G>
    );
    return (
      <Svg width={W * escala} height={H * escala} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="corpo" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2b3446" />
            <Stop offset="1" stopColor="#0d1320" />
          </LinearGradient>
          <LinearGradient id="topoApp" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={COR.azul} />
            <Stop offset="1" stopColor={COR.azulVivo} />
          </LinearGradient>
        </Defs>
        <Rect x={3} y={5} width={W - 6} height={H - 6} rx={30} fill="#000000" fillOpacity={0.1} />
        <Rect x={0} y={0} width={W - 4} height={H - 4} rx={30} fill="url(#corpo)" />
        <Rect x={tela.x - 2} y={tela.y} width={tela.w - 4} height={tela.h - 4} rx={22} fill="#f6f8fb" />
        {/* o topo do app */}
        <Path d={`M${tela.x - 2} ${tela.y + 22} Q${tela.x - 2} ${tela.y} ${tela.x + 20} ${tela.y} H${tela.x + tela.w - 28} Q${tela.x + tela.w - 6} ${tela.y} ${tela.x + tela.w - 6} ${tela.y + 22} V${tela.y + 62} H${tela.x - 2} Z`} fill="url(#topoApp)" />
        <Rect x={cx - 30} y={tela.y + 6} width={56} height={9} rx={4.5} fill="#0d1320" />
        <Text x={tela.x + 12} y={tela.y + 36} fill="#ffffff" style={ts(800, 9)}>
          Sua usina
        </Text>
        <Text x={tela.x + 12} y={tela.y + 49} fill="#dbe7fb" style={ts(500, 6.4)}>
          Resumo do mês · valores previstos
        </Text>
        {/* o fluxo: a casa e a rede em cima, a geração embaixo */}
        {(() => {
          const casa: Ponto = [tela.x + 36, tela.y + 112];
          const rede: Ponto = [tela.x + tela.w - 42, tela.y + 112];
          const ger: Ponto = [cx - 3, tela.y + 184];
          // as linhas param na borda dos círculos (raio 14 + folga)
          const ate = (a: Ponto, b: Ponto, folga = 17): [Ponto, Ponto] => {
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const n = Math.hypot(dx, dy);
            return [
              [a[0] + (dx / n) * folga, a[1] + (dy / n) * folga],
              [b[0] - (dx / n) * folga, b[1] - (dy / n) * folga],
            ];
          };
          const [r0, r1] = ate(rede, casa);
          const [g0, g1] = ate(ger, casa);
          const [h0, h1] = ate(ger, rede);
          const angulo = (a: Ponto, b: Ponto) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          const ponta = (a: Ponto, b: Ponto, cor: string) => (
            <Path d="M0 0 L-5 -2.8 L-5 2.8 Z" fill={cor} transform={`translate(${b[0]} ${b[1]}) rotate(${angulo(a, b)})`} />
          );
          return (
            <G>
              {no(casa[0], casa[1], "casa", "Unidade", kwh(e.consumoMedio), true)}
              {no(rede[0], rede[1], "raio", "Rede", null, true)}
              {no(ger[0], ger[1], "painel", "Geração", kwh(e.geracaoMedia), false)}
              <Line x1={r0[0]} y1={r0[1]} x2={r1[0]} y2={r1[1]} stroke={COR.vermelho} strokeWidth={1.2} />
              {ponta(r0, r1, COR.vermelho)}
              <Text x={cx - 3} y={casa[1] + 11} fill={COR.fraca} style={ts(500, 5.6)} textAnchor="middle">
                Da rede
              </Text>
              <Text x={cx - 3} y={casa[1] + 18.5} fill={COR.vermelho} style={ts(700, 6)} textAnchor="middle">
                {kwh(registrado)}
              </Text>
              <Line x1={g0[0]} y1={g0[1]} x2={g1[0]} y2={g1[1]} stroke={COR.verde} strokeWidth={1.2} />
              {ponta(g0, g1, COR.verde)}
              <Line x1={h0[0]} y1={h0[1]} x2={h1[0]} y2={h1[1]} stroke="#2f80ed" strokeWidth={1.2} />
              {ponta(h0, h1, "#2f80ed")}
              <Text x={tela.x + 14} y={tela.y + 156} fill={COR.fraca} style={ts(500, 5.6)}>
                Na hora
              </Text>
              <Text x={tela.x + 14} y={tela.y + 163.5} fill={COR.verde} style={ts(700, 6)}>
                {kwh(instantaneo)}
              </Text>
              <Text x={tela.x + tela.w - 16} y={tela.y + 156} fill={COR.fraca} style={ts(500, 5.6)} textAnchor="end">
                Injetada
              </Text>
              <Text x={tela.x + tela.w - 16} y={tela.y + 163.5} fill="#2f80ed" style={ts(700, 6)} textAnchor="end">
                {kwh(injetada)}
              </Text>
            </G>
          );
        })()}
        {/* os números */}
        {cartaoTela(tela.x + 6, tela.y + 232, "Geração", kwh(e.geracaoMedia), COR.navy)}
        {cartaoTela(tela.x + 86, tela.y + 232, "Economia", moeda(d.financeiro.economiaMes), COR.verde)}
        {cartaoTela(tela.x + 6, tela.y + 274, "Consumo total", kwh(e.consumoMedio), COR.navy)}
        {cartaoTela(tela.x + 86, tela.y + 274, "Conta com solar", moeda(d.financeiro.contaComMes), COR.azul)}
        <Rect x={tela.x + 6} y={tela.y + 318} width={154} height={22} rx={6} fill={COR.azulFundo} />
        <Text x={tela.x + 83} y={tela.y + 332} fill={COR.azul} style={ts(700, 6.6)} textAnchor="middle">
          {`Economia no ano: ${moeda(d.financeiro.economiaAno1)}`}
        </Text>
        <Rect x={cx - 26} y={H - 16} width={46} height={3} rx={1.5} fill="#cbd5e1" />
      </Svg>
    );
  }

  // ------------------------------------------------------------ peças soltas

  function CartaoNumero({ icone, rotulo, valor, largura }: { icone: Glifo; rotulo: string; valor: string; largura: number }) {
    return (
      <View style={{ width: largura, backgroundColor: COR.azulGelo, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 6, alignItems: "center", borderWidth: 0.8, borderColor: "#e6ecf5" }}>
        <Bolha tipo={icone} tamanho={28} />
        <Text style={t(600, 7.2, COR.fraca, { textAlign: "center", marginTop: 6, lineHeight: 1.25 })}>{rotulo}</Text>
        <Text style={t(800, 10, COR.navy, { textAlign: "center", marginTop: 3 })}>{valor}</Text>
      </View>
    );
  }

  const anos = (n: number) => `${n} ${n === 1 ? "ano" : "anos"}`;
  const percentual = (f: number, casas = 2) => `${(f * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

  // ------------------------------------------------------------- o documento

  function Proposta({ d, visual }: { d: DadosProposta; visual: VisualDaProposta }) {
    const f = d.financeiro;
    const e = d.energia;
    const g = d.garantias;
    const pr = d.premissas;
    const semCatalogo = !d.sistema.modulos && !d.sistema.inversores;
    const cnpj = cnpjBonito(d.empresa.cnpj);
    const usinas = d.empresa.usinas ?? 0;

    return (
      <Document title={`Proposta ${d.numero} - ${d.cliente.nome}`} author={d.empresa.nome} creator="Selebi" producer="Selebi">
        <Capa d={d} visual={visual} />

        {/* ------------------------------------------------ 2. passo a passo */}
        <Pagina n={2} d={d} sobre="Como funciona" titulo="Passo a passo">
          {visual.logo && (
            <Image src={visual.logo} style={{ position: "absolute", top: 210, left: MARGEM + 40, width: LARGURA - 80, height: 200, objectFit: "contain", opacity: 0.05 }} />
          )}
          <PassoAPasso />
          <View style={{ marginTop: 26, alignItems: "center" }}>
            <Text style={t(700, 10.5, COR.navy)}>O caminho da energia na sua casa</Text>
          </View>
          <View style={{ marginTop: 6 }}>
            <CasaDoSistema />
          </View>
        </Pagina>

        {/* ------------------------------------ 3. detalhamento e garantias */}
        <Pagina
          n={3}
          d={d}
          sobre="Seu sistema"
          titulo="Detalhamento do sistema"
          nota={[
            "*Garantia dos equipamentos é fornecida pelos seus fabricantes conforme suas especificações.",
            "*O kit gerador está sujeito a alteração de acordo com a disponibilidade do equipamento junto ao fornecedor até a assinatura do contrato.",
          ]}
        >
          {/* os três números do sistema */}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            {(
              [
                ["raio", "Potência do sistema", kwpTexto(d.sistema.kwp)],
                ["sol", "Geração estimada", `${kwhTexto(e.geracaoMedia)}/mês`],
                ["area", "Área mínima necessária", `${d.sistema.areaM2} m²`],
              ] as [Glifo, string, string][]
            ).map(([icone, rotulo, valor], i) => (
              <View key={rotulo} style={{ width: (LARGURA - 20) / 3, borderRadius: 12, overflow: "hidden" }}>
                <Svg width={(LARGURA - 20) / 3} height={92} viewBox={`0 0 ${(LARGURA - 20) / 3} 92`} style={{ position: "absolute", top: 0, left: 0 }}>
                  <Defs>
                    <LinearGradient id={`hero${i}`} x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor={i === 1 ? "#1d4ea0" : COR.azul} />
                      <Stop offset="1" stopColor={i === 1 ? COR.navy : "#1a417f"} />
                    </LinearGradient>
                  </Defs>
                  <Rect x="0" y="0" width={(LARGURA - 20) / 3} height={92} fill={`url(#hero${i})`} />
                  <Circle cx={(LARGURA - 20) / 3 - 8} cy={8} r={34} fill="#ffffff" fillOpacity={0.06} />
                </Svg>
                <View style={{ height: 92, paddingHorizontal: 14, paddingVertical: 14, justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Svg width={14} height={14} viewBox="0 0 24 24">
                      <Glifos tipo={icone} cor={COR.amarelo} largura={2.2} />
                    </Svg>
                    <Text style={t(600, 7.4, "#cfe0fb", { marginLeft: 5 })}>{rotulo}</Text>
                  </View>
                  <Text style={t(800, 16, "#ffffff")}>{valor}</Text>
                </View>
              </View>
            ))}
          </View>

          <Secao titulo="Equipamentos" topo={30} />
          {(
            [
              ["painel", "Módulos fotovoltaicos", d.sistema.modulos],
              ["inversor", "Inversor", d.sistema.inversores],
              ["painel", "Kit gerador", semCatalogo ? d.sistema.equipamentosTexto : null],
              ["telhado", "Tipo de estrutura", d.sistema.estrutura],
            ] as [Glifo, string, string | null][]
          )
            .filter(([, , valor]) => Boolean(valor))
            .map(([icone, rotulo, valor]) => (
              <View key={rotulo} style={{ flexDirection: "row", alignItems: "center", marginBottom: 9 }}>
                <Icone tipo={icone} tamanho={30} />
                <View style={{ flex: 1, marginLeft: -3, backgroundColor: COR.azulGelo, borderTopRightRadius: 8, borderBottomRightRadius: 8, paddingVertical: 8, paddingLeft: 14, paddingRight: 10 }}>
                  <Text style={t(600, 6.6, COR.apagada, { textTransform: "uppercase", letterSpacing: 0.8 })}>{rotulo}</Text>
                  <Text style={t(700, 9.6, COR.navy, { marginTop: 1.5 })}>{valor}</Text>
                </View>
              </View>
            ))}

          <Secao titulo="Garantias" topo={26} />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            {(
              [
                ["inversor", "Inversor", g.inversor],
                ["painel", "Placas", g.placas],
                ["estrutura", "Estrutura", g.estrutura],
                ["grafico", "Eficiência", g.eficiencia],
              ] as [Glifo, string, number][]
            ).map(([icone, rotulo, n]) => (
              <View key={rotulo} style={{ width: (LARGURA - 27) / 4, borderRadius: 12, borderWidth: 1, borderColor: "#e3e9f2", paddingVertical: 15, alignItems: "center" }}>
                <Icone tipo={icone} tamanho={26} />
                <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 7 }}>
                  <Text style={t(800, 22, COR.azul, { lineHeight: 1 })}>{String(n)}</Text>
                  <Text style={t(700, 8.5, COR.azul, { marginLeft: 3, marginBottom: 2 })}>{n === 1 ? "ano" : "anos"}</Text>
                </View>
                <Text style={t(700, 7, COR.navy, { textTransform: "uppercase", letterSpacing: 1, marginTop: 4 })}>{rotulo}</Text>
              </View>
            ))}
          </View>

          <Secao titulo="Está tudo incluído" topo={26} />
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {[
              "Projeto elétrico e ART",
              "Equipamentos e frete até a obra",
              "Instalação completa",
              "Homologação na concessionária",
              "Troca do relógio pelo bidirecional",
              "Monitoramento e pós-venda",
            ].map((item) => (
              <View key={item} style={{ width: LARGURA / 2, flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                <Bolha tipo="check" tamanho={15} cor={COR.verde} fundo="#e3f5ec" />
                <Text style={t(600, 8.6, COR.tinta, { marginLeft: 7 })}>{item}</Text>
              </View>
            ))}
          </View>
        </Pagina>

        {/* ------------------------------------ 4. geração, consumo e finanças */}
        <Pagina
          n={4}
          d={d}
          sobre="Sua economia"
          titulo="Geração e consumo"
          nota={[
            `*Estimativa com tarifa de ${moeda(pr.tarifaKwh)}/kWh, reajuste de ${percentual(pr.reajusteAnual, 0)} ao ano, desempenho do sistema de ${percentual(pr.desempenho, 0)}, perda de ${percentual(pr.degradacaoAnual, 1)} ao ano nos módulos e Fio B de ${percentual(pr.fioBPercentual, 0)} (Lei 14.300), com ${percentual(pr.simultaneidade, 0)} do consumo atendido na hora.`,
            "A geração e a economia reais variam com o clima, o consumo e a tarifa da distribuidora.",
          ]}
        >
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: -6, marginBottom: 2 }}>
            {(
              [
                ["url", "Geração prevista (kWh)"],
                [COR.cinzaBarra, "Consumo (kWh)"],
              ] as const
            ).map(([cor, texto]) => (
              <View key={texto} style={{ flexDirection: "row", alignItems: "center", marginLeft: 14 }}>
                <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: cor === "url" ? COR.azul : cor, marginRight: 5 }} />
                <Text style={t(600, 7.2, COR.fraca)}>{texto}</Text>
              </View>
            ))}
          </View>
          <GraficoGeracao geracao={e.geracaoMes} consumo={e.consumoMedio} />

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            {(
              [
                ["casa", "Consumo médio mensal", kwhTexto(e.consumoMedio)],
                ["porquinho", "Economia mensal", moeda(f.economiaMes)],
                ["sol", "Geração média mensal", kwhTexto(e.geracaoMedia)],
                ["painel", "Produção média anual", kwhTexto(e.producaoAno)],
                ["sol", "Irradiação local", `${numero(e.irradiacaoDia, 2)} kWh/m²·dia`],
              ] as [Glifo, string, string][]
            ).map(([icone, rotulo, valor]) => (
              <CartaoNumero key={rotulo} icone={icone} rotulo={rotulo} valor={valor} largura={(LARGURA - 4 * 7) / 5} />
            ))}
          </View>

          <View style={{ alignItems: "center", marginTop: 20, marginBottom: 12 }}>
            <Text style={t(800, 15, COR.azul, { textTransform: "uppercase", letterSpacing: 0.3 })}>Informações financeiras</Text>
          </View>
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 168 }}>
              {(
                [
                  ["relogio", "Payback", rotuloDoPayback(f.paybackMeses), COR.laranja],
                  ["porquinho", "Economia em 5 anos", moeda(f.economia5), COR.azul],
                  ["grafico", "Economia em 25 anos", moeda(f.economia25), COR.verde],
                ] as [Glifo, string, string, string][]
              ).map(([icone, rotulo, valor, cor]) => (
                <View key={rotulo} style={{ flexDirection: "row", alignItems: "center", marginBottom: 9, backgroundColor: COR.azulGelo, borderRadius: 10, padding: 8, borderLeftWidth: 3, borderLeftColor: cor }}>
                  <Bolha tipo={icone} tamanho={26} cor={cor} fundo="#ffffff" />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={t(600, 7.2, COR.fraca)}>{rotulo}</Text>
                    <Text style={t(800, 11, COR.navy, { marginTop: 1 })}>{valor}</Text>
                  </View>
                </View>
              ))}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <GraficoCaixa fluxo={f.fluxo} payback={f.paybackMeses} largura={LARGURA - 180} altura={136} />
              <Text style={t(500, 6.6, COR.apagada, { textAlign: "center", marginTop: 1 })}>Fluxo de caixa acumulado por ano (R$)</Text>
            </View>
          </View>

          <View style={{ marginTop: 12, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#dfe6f0" }}>
            <View style={{ flexDirection: "row", backgroundColor: COR.navy, paddingVertical: 7 }}>
              <Text style={{ width: 56 }} />
              {["Conta sem solar", "Conta com solar", "Economia com solar"].map((txt) => (
                <Text key={txt} style={t(700, 7.6, "#ffffff", { flex: 1, textAlign: "center", letterSpacing: 0.3 })}>
                  {txt}
                </Text>
              ))}
            </View>
            {(
              [
                ["mês", f.contaSemMes, f.contaComMes, f.economiaMes, "#ffffff"],
                ["ano", f.contaSemMes * 12, f.contaComMes * 12, f.economiaAno1, COR.azulGelo],
              ] as [string, number, number, number, string][]
            ).map(([rotulo, a, b, c, fundo]) => (
              <View key={rotulo} style={{ flexDirection: "row", paddingVertical: 7, backgroundColor: fundo, alignItems: "center" }}>
                <Text style={t(700, 8, COR.fraca, { width: 56, paddingLeft: 14, textTransform: "uppercase" })}>{rotulo}</Text>
                <Text style={t(700, 10.5, COR.fraca, { flex: 1, textAlign: "center" })}>{moeda(a)}</Text>
                <Text style={t(700, 10.5, COR.azul, { flex: 1, textAlign: "center" })}>{moeda(b)}</Text>
                <Text style={t(800, 10.5, COR.verde, { flex: 1, textAlign: "center" })}>{moeda(c)}</Text>
              </View>
            ))}
          </View>
        </Pagina>

        {/* -------------------------------------------- 5. monitoramento 24h */}
        <Pagina n={5} d={d} sobre="Tranquilidade" titulo="Monitoramos o seu sistema 24h">
          <Text style={t(500, 9.6, COR.fraca, { textAlign: "center", lineHeight: 1.5, marginHorizontal: 34, marginTop: -4, marginBottom: 20 })}>
            Depois da instalação, a sua usina não fica sozinha: a nossa equipe acompanha a geração todos os dias e age quando algo sai do normal.
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: 232, alignItems: "center" }}>
              <Celular d={d} escala={1.16} />
            </View>
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={t(800, 12.5, COR.azul, { textTransform: "uppercase", lineHeight: 1.25, marginBottom: 14 })}>
                Um exemplo dos nossos relatórios, direto no seu celular
              </Text>
              {(
                [
                  ["sol", "Acompanhamento diário", "Conferimos a geração da sua usina todos os dias, comparando com o que ela deveria produzir."],
                  ["sino", "Agimos antes de você perceber", "Se a usina para de gerar, abrimos o atendimento técnico sozinhos — sem esperar a conta de luz chegar alta."],
                  ["celular", "Relatório mensal no WhatsApp", "Todo mês você recebe quanto a usina gerou e quanto você economizou."],
                ] as [Glifo, string, string][]
              ).map(([icone, titulo, texto]) => (
                <View key={titulo} style={{ flexDirection: "row", marginBottom: 14 }}>
                  <Icone tipo={icone} tamanho={28} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={t(700, 9.6, COR.navy)}>{titulo}</Text>
                    <Text style={t(400, 8.4, COR.fraca, { lineHeight: 1.45, marginTop: 2 })}>{texto}</Text>
                  </View>
                </View>
              ))}
              <Text style={t(400, 6.8, COR.apagada, { fontStyle: "italic", marginTop: 2 })}>
                Os números do celular são os previstos para o seu sistema. No relatório de cada mês entram os reais.
              </Text>
            </View>
          </View>
          {usinas >= 20 && (
            <View style={{ marginTop: 26, borderRadius: 12, overflow: "hidden" }}>
              <Svg width={LARGURA} height={58} viewBox={`0 0 ${LARGURA} 58`} style={{ position: "absolute", top: 0, left: 0 }}>
                <Defs>
                  <LinearGradient id="faixa" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor={COR.navy} />
                    <Stop offset="1" stopColor={COR.azul} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width={LARGURA} height={58} fill="url(#faixa)" />
              </Svg>
              <View style={{ height: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: 20 }}>
                <Text style={t(800, 24, COR.amarelo)}>{numero(usinas)}</Text>
                <Text style={t(600, 9.5, "#ffffff", { marginLeft: 12, flex: 1, lineHeight: 1.35 })}>
                  {`usinas solares acompanhadas hoje pela ${d.empresa.nome}${d.cliente.uf ? ` em ${ESTADOS[d.cliente.uf] ?? d.cliente.uf}` : ""}.`}
                </Text>
              </View>
            </View>
          )}
        </Pagina>

        {/* ---------------------------------------------- 6. o investimento */}
        <Pagina n={6} d={d} sobre="Investimento" titulo="Valor do seu investimento">
          <View style={{ borderRadius: 16, overflow: "hidden" }}>
            <Svg width={LARGURA} height={112} viewBox={`0 0 ${LARGURA} 112`} style={{ position: "absolute", top: 0, left: 0 }}>
              <Defs>
                <LinearGradient id="valor" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={COR.navy} />
                  <Stop offset="0.65" stopColor="#1b448f" />
                  <Stop offset="1" stopColor={COR.azul} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width={LARGURA} height={112} fill="url(#valor)" />
              <Circle cx={LARGURA - 40} cy={-10} r={90} fill="#ffffff" fillOpacity={0.05} />
              <Circle cx={LARGURA - 10} cy={112} r={60} fill={COR.laranja} fillOpacity={0.14} />
            </Svg>
            <View style={{ height: 112, paddingHorizontal: 24, justifyContent: "center" }}>
              <Text style={t(600, 9, "#bcd2f5", { letterSpacing: 1.2, textTransform: "uppercase" })}>Valor total</Text>
              <Text style={t(800, 30, "#ffffff", { marginTop: 4 })}>{moeda(f.investimento)}</Text>
              <Text style={t(500, 8.6, "#dbe7fb", { marginTop: 5 })}>
                {`Sistema de ${kwpTexto(d.sistema.kwp)} instalado, homologado e monitorado.`}
              </Text>
            </View>
            {f.paybackMeses !== null && (
              <View style={{ position: "absolute", right: 20, top: 40, backgroundColor: COR.laranja, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, alignItems: "center" }}>
                <Text style={t(600, 6.8, "#ffffff")}>Retorno em</Text>
                <Text style={t(800, 10, "#ffffff")}>{rotuloDoPayback(f.paybackMeses)}</Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
            {[
              ["Economia mensal", moeda(f.economiaMes)],
              ["Economia no primeiro ano", moeda(f.economiaAno1)],
            ].map(([rotulo, valor]) => (
              <View key={rotulo} style={{ width: LARGURA / 2 - 6, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#dfe6f0" }}>
                <Text style={t(700, 9, COR.fraca, { textAlign: "center", paddingVertical: 6, backgroundColor: COR.azulGelo })}>{rotulo}</Text>
                <Text style={t(800, 13, "#ffffff", { textAlign: "center", paddingVertical: 7, backgroundColor: COR.azul })}>{valor}</Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 18, backgroundColor: COR.laranjaFundo, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: COR.laranja, paddingVertical: 12, paddingHorizontal: 16 }}>
            <Text style={t(700, 9.6, COR.navy, { lineHeight: 1.45, textAlign: "center" })}>
              {`"Essa proposta é válida apenas até ${d.validaAte} e está sujeita à alteração conforme disponibilidade de equipamentos."`}
            </Text>
            <Text style={t(800, 9.6, COR.laranja, { textAlign: "center", marginTop: 6 })}>Aproveite agora essa condição exclusiva para garantir sua economia!</Text>
          </View>

          <View style={{ alignItems: "center", marginTop: 30, marginBottom: 16 }}>
            <Text style={t(800, 15, COR.azul, { textTransform: "uppercase", letterSpacing: 0.3 })}>Escolha a forma de pagamento</Text>
          </View>
          <View>
            {(
              [
                ["cartao", "Cartão de crédito", `Divida seu sistema em até ${d.pagamento.parcelas}x no cartão e comece a economizar, com taxas a partir de ${percentual(d.pagamento.taxaMes)} ao mês.`],
                ["pix", "PIX", "Desconto exclusivo para pagamento à vista! Com PIX, você garante o menor preço e sua instalação mais rápida."],
                ["banco", "Financiamento", `Troque a sua conta de energia por parcelas fixas e acessíveis. Simples e sem burocracia, com até ${d.pagamento.carenciaDias} dias para começar a pagar!`],
              ] as const
            ).map(([tipo, titulo, texto]) => (
              <View key={titulo} style={{ flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#e3e9f2", paddingVertical: 14, paddingHorizontal: 18, marginBottom: 11 }}>
                <Svg width={52} height={52} viewBox="0 0 50 50">
                  <Circle cx="25" cy="25" r="25" fill={tipo === "pix" ? "#e2f6f3" : COR.azulFundo} />
                  {tipo === "cartao" && (
                    <G>
                      <Rect x="10" y="15" width="30" height="20" rx="3.5" fill={COR.azul} />
                      <Rect x="10" y="19.5" width="30" height="4" fill={COR.navy} />
                      <Rect x="14" y="27.5" width="9" height="3" rx="1" fill={COR.amarelo} />
                    </G>
                  )}
                  {tipo === "pix" && (
                    <G>
                      <Path d="M25 11 L39 25 L25 39 L11 25 Z" fill="#32bcad" />
                      <Path d="M25 18 L32 25 L25 32 L18 25 Z" fill="#e2f6f3" />
                    </G>
                  )}
                  {tipo === "banco" && (
                    <G>
                      <Path d="M25 11 L39 18.5 H11 Z" fill={COR.azul} />
                      <Rect x="14" y="21" width="3.6" height="11" fill={COR.azul} />
                      <Rect x="23.2" y="21" width="3.6" height="11" fill={COR.azul} />
                      <Rect x="32.4" y="21" width="3.6" height="11" fill={COR.azul} />
                      <Rect x="11" y="34" width="28" height="4" rx="1" fill={COR.navy} />
                    </G>
                  )}
                </Svg>
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <Text style={t(800, 10.5, COR.navy, { textTransform: "uppercase", letterSpacing: 0.4 })}>{titulo}</Text>
                  <Text style={t(400, 8.8, COR.fraca, { lineHeight: 1.45, marginTop: 3 })}>{texto}</Text>
                </View>
              </View>
            ))}
          </View>
        </Pagina>

        {/* ---------------------------------------------- 7. pós-venda */}
        <Pagina n={7} d={d} sobre="Depois da venda" titulo="Pós-venda e fases do projeto">
          <View style={{ height: 492, position: "relative", marginTop: 6 }}>
            {/* o arco que liga as fases (círculo de centro ARCO e raio ARCO.r), com o logo no meio dele */}
            <Svg width={LARGURA} height={492} viewBox={`0 0 ${LARGURA} 492`} style={{ position: "absolute", top: 0, left: 0 }}>
              <Path d={arcoDe(-50, 50)} stroke={COR.azulFundo} strokeWidth={12} fill="none" strokeLinecap="round" />
              <Path d={arcoDe(-50, 50)} stroke={COR.azul} strokeWidth={1.2} fill="none" strokeDasharray="3 4" />
            </Svg>
            <View style={{ position: "absolute", left: 0, top: ARCO.y - 75, width: 190, height: 150, alignItems: "center", justifyContent: "center" }}>
              {visual.logo ? (
                <Image src={visual.logo} style={{ maxWidth: 170, maxHeight: 130, objectFit: "contain" }} />
              ) : (
                <Text style={t(800, 18, COR.navy, { textAlign: "center" })}>{d.empresa.nome.toUpperCase()}</Text>
              )}
            </View>
            {(
              [
                ["documento", "Projeto", "Seu projeto será desenvolvido pela nossa equipe de engenheiros e atenderá todas as normas de exigência."],
                ["caminhao", "Frete", "Levamos seus equipamentos até o local de instalação."],
                ["ferramenta", "Instalação", "Agendaremos a instalação para um momento conveniente à sua rotina."],
                ["casa", "Homologação", "Seu projeto será homologado na concessionária de energia local para que sua economia seja real."],
                ["escudo", "Pós-venda", "Após a conclusão da sua instalação, nosso setor de pós-venda entra em ação para garantir o perfeito funcionamento do sistema."],
              ] as [Glifo, string, string][]
            ).map(([icone, titulo, texto], i) => {
              // os pontos sobre o mesmo arco, de -44° a 44°
              const [x, y] = noArco(-44 + i * 22);
              return (
                <View key={titulo} style={{ position: "absolute", left: x - 27, top: y - 27, flexDirection: "row", alignItems: "center", width: LARGURA - x + 27 }}>
                  <Svg width={54} height={54} viewBox="0 0 54 54">
                    <Circle cx="27" cy="28.5" r="25" fill="#000000" fillOpacity={0.07} />
                    <Circle cx="27" cy="27" r="25" fill="#ffffff" stroke={COR.azul} strokeWidth={2.4} />
                    <G transform="translate(15 15)">
                      <Glifos tipo={icone} cor={COR.azul} largura={1.7} />
                    </G>
                  </Svg>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={t(800, 10.5, COR.navy)}>{titulo}</Text>
                    <Text style={t(400, 8.2, COR.fraca, { lineHeight: 1.4, marginTop: 1.5 })}>{texto}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* o fechamento: com quem falar */}
          <View style={{ marginTop: 22, borderRadius: 14, backgroundColor: COR.azulGelo, borderWidth: 1, borderColor: "#e3e9f2", padding: 16, flexDirection: "row", alignItems: "center" }}>
            <Bolha tipo="pessoa" tamanho={40} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={t(800, 11, COR.navy)}>Ficou com alguma dúvida?</Text>
              <Text style={t(500, 8.6, COR.fraca, { marginTop: 3, lineHeight: 1.4 })}>
                {d.responsavel
                  ? `Fale com ${d.responsavel.nome}${d.responsavel.contato ? ` pelo ${d.responsavel.contato}` : ""}: a gente explica cada número desta proposta.`
                  : "Fale com a gente: explicamos cada número desta proposta."}
              </Text>
            </View>
          </View>
          {(cnpj || d.empresa.email || d.empresa.endereco) && (
            <Text style={t(500, 7, COR.apagada, { textAlign: "center", marginTop: 12, lineHeight: 1.5 })}>
              {[d.empresa.razaoSocial ?? d.empresa.nome, cnpj ? `CNPJ ${cnpj}` : null, d.empresa.endereco, d.empresa.email].filter(Boolean).join("  ·  ")}
            </Text>
          )}
        </Pagina>
      </Document>
    );
  }

  return { Proposta, renderToBuffer: R.renderToBuffer };
}

let montado: ReturnType<typeof montar> | null = null;

async function biblioteca() {
  montado ??= montar(await import("@react-pdf/renderer"));
  return montado;
}

export async function gerarPropostaPdf(dados: DadosProposta, visual: VisualDaProposta): Promise<Buffer> {
  const { Proposta, renderToBuffer } = await biblioteca();
  return renderToBuffer(<Proposta d={dados} visual={visual} />);
}
